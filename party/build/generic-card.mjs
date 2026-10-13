import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { flagPathFor, validatePng, DEFAULT_FLAGS_DIR } from './fetch-flags.mjs';

const BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
const REG = '/System/Library/Fonts/Supplemental/Arial.ttf';
const GOLD = '0xFEB619';
const DURATION = 9.0;

// Matches the bespoke cards from the existing pipeline. Exact values from the task brief.
export const GEOMETRY = {
  '4x9': { width: 480, height: 1080, flagWidth: 400, flagY: 240, scrimTop: 640,
    nameY: 800, nameSize: 36, nameMaxChars: 17, ruleY: 852, ruleX: 170, ruleW: 140,
    goldY: 866, goldSize: 27, whiteY: 908, whiteSize: 20 },
  '8x9': { width: 960, height: 1080, flagWidth: 700, flagY: 120, scrimTop: 580,
    nameY: 700, nameSize: 68, nameMaxChars: 21, ruleY: 788, ruleX: 370, ruleW: 220,
    goldY: 808, goldSize: 50, whiteY: 874, whiteSize: 36 },
};

// Character budgets for the gold (hometown) and white (country) lines, beside the
// brief's table, not part of it. Derived from the name constants (usable width ~
// chars x px: 17x36 = 612 on 480, 21x68 = 1428 on 960), so the budget is
// round(width / size). Confirmed by rendering a 36-character hometown.
export const LINE_FIT = {
  '4x9': { goldMaxChars: 22, whiteMaxChars: 30 },
  '8x9': { goldMaxChars: 28, whiteMaxChars: 39 },
};

export function cardLines(player) {
  const name = (player.name || '').toUpperCase();
  const hometown = (player.hometown || '').toUpperCase();
  const country = (player.country || '').toUpperCase();
  return hometown
    ? { name, gold: hometown, white: country }
    : { name, gold: country, white: '' };
}

export function fitFontSize(text, baseSize, maxChars) {
  if (text.length <= maxChars) return baseSize;
  return Math.max(1, Math.floor((baseSize * maxChars) / text.length));
}

// drawtext text MUST go through a file with expansion=none. Passing it inline as
// text='...' breaks on a comma (filtergraph parse error) and on an apostrophe
// (the rest of the filter options get rendered as part of the string).
// The file is addressed by a bare relative name (ffmpeg runs with cwd = its own
// scratch dir), so no path character can reach the filtergraph parser.
function textFile(scratch, tag, value) {
  const name = `t-${tag}.txt`;
  writeFileSync(join(scratch, name), value, 'utf8');
  return name;
}

function drawtext({ font, file, size, colour, y, fadeAt }) {
  return `drawtext=fontfile='${font}':textfile='${file}':expansion=none:` +
    `fontcolor=${colour}:fontsize=${size}:x=(w-tw)/2:y=${y}:` +
    `alpha='min(max((t-${fadeAt})/0.45\\,0)\\,1)'`;
}

export function buildFilterGraph(g, lines, files, fit = LINE_FIT[g.width === 480 ? '4x9' : '8x9']) {
  const nameSize = fitFontSize(lines.name, g.nameSize, g.nameMaxChars);
  const goldSize = fitFontSize(lines.gold, g.goldSize, fit.goldMaxChars);
  const whiteSize = fitFontSize(lines.white, g.whiteSize, fit.whiteMaxChars);
  const steps = [
    `[0:v]split=2[a][b]`,
    `[a]scale=w=${g.width}:h=${g.height}:force_original_aspect_ratio=increase,` +
      `crop=${g.width}:${g.height},boxblur=24:2,eq=brightness=-0.22:saturation=0.55,` +
      `zoompan=z='min(1.0+0.0008*on,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
      `d=1:s=${g.width}x${g.height}:fps=30[bg]`,
    `[b]scale=${g.flagWidth}:-1,setsar=1[fg]`,
    `[bg][fg]overlay=x=(W-w)/2:y=${g.flagY}:shortest=1,fade=t=in:st=0:d=0.5[ph]`,
    `[ph]drawbox=x=0:y=${g.scrimTop}:w=${g.width}:h=${g.height - g.scrimTop}:color=black@0.74:t=fill[s0]`,
    `[s0]${drawtext({ font: BOLD, file: files.name, size: nameSize, colour: 'white', y: g.nameY, fadeAt: 0.7 })}[s1]`,
    `[s1]drawbox=x=${g.ruleX}:y=${g.ruleY}:w=${g.ruleW}:h=3:color=${GOLD}@0.9:t=fill:enable='gte(t,1.0)'[s2]`,
    `[s2]${drawtext({ font: BOLD, file: files.gold, size: goldSize, colour: GOLD, y: g.goldY, fadeAt: 1.1 })}[s3]`,
  ];
  if (files.white) {
    steps.push(`[s3]${drawtext({ font: REG, file: files.white, size: whiteSize, colour: 'white@0.88', y: g.whiteY, fadeAt: 1.35 })}[s4]`);
  } else {
    steps.push('[s3]null[s4]');
  }
  steps.push(`[s4]format=yuv420p[out]`);
  return steps.join(';');
}

export function buildArgs({ flag, graph, tmpOut }) {
  return ['-v', 'error', '-loop', '1', '-i', flag,
    '-filter_complex', graph, '-map', '[out]', '-t', String(DURATION), '-r', '30',
    '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-movflags', '+faststart',
    '-f', 'mp4', tmpOut, '-y'];
}

export async function buildGenericCard({ player, format, outPath, flagsDir = DEFAULT_FLAGS_DIR, workDir, timeoutMs = 180_000 }) {
  const who = `${player?.name ?? '(unnamed player)'} [${format}]`;
  const g = GEOMETRY[format];
  if (!g) throw new Error(`Cannot build card for ${who}: unknown card format "${format}" (use "4x9" or "8x9")`);

  let flag;
  try {
    flag = resolve(flagPathFor(player.country, flagsDir)); // ffmpeg runs in another cwd
  } catch (e) {
    throw new Error(`Cannot build card for ${who}: ${e.message}`);
  }
  if (!existsSync(flag)) {
    throw new Error(`Cannot build card for ${who}: flag file ${flag} is missing - run: npm run party:flags`);
  }
  // ffmpeg spins forever on a looped input that is not a real image, so check first.
  try {
    validatePng(readFileSync(flag), flag);
  } catch (e) {
    throw new Error(`Cannot build card for ${who}: ${e.message}`);
  }

  const lines = cardLines(player);
  mkdirSync(workDir || tmpdir(), { recursive: true });
  // A private scratch dir per call, so concurrent builds never share text files.
  const scratch = resolve(mkdtempSync(join(workDir || tmpdir(), 'genericcard-')));
  const tmpOut = join(resolve(dirname(outPath)), `.${basename(outPath)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    const files = {
      name: textFile(scratch, 'name', lines.name),
      gold: textFile(scratch, 'gold', lines.gold),
      white: lines.white ? textFile(scratch, 'white', lines.white) : null,
    };
    const args = buildArgs({ flag, graph: buildFilterGraph(g, lines, files), tmpOut });

    await new Promise((ok, fail) => {
      const p = spawn('ffmpeg', args, { cwd: scratch });
      let err = '';
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, timeoutMs);
      p.stderr.on('data', (d) => { err += d; });
      p.on('error', (e) => { clearTimeout(timer); fail(new Error(e.code === 'ENOENT'
        ? `Cannot build card for ${who}: ffmpeg was not found on PATH`
        : `Cannot build card for ${who}: could not start ffmpeg: ${e.message}`)); });
      p.on('close', (code) => { clearTimeout(timer); return code === 0
        ? ok()
        : timedOut
        ? fail(new Error(`ffmpeg timed out after ${timeoutMs}ms building card for ${who}`))
        : fail(new Error(`ffmpeg exited ${code} building card for ${who}\n${err.trim()}`)); });
    });
    renameSync(tmpOut, outPath); // only a finished render ever reaches outPath
    return outPath;
  } finally {
    rmSync(tmpOut, { force: true }); // our own temp file; no-op after a successful rename
    rmSync(scratch, { recursive: true, force: true });
  }
}

import { readFileSync } from 'node:fs';

export class RosterError extends Error {}

const PREFIX = { international: 'player-intl', usa: 'player-usa' };

export function loadRoster(detailsPath) {
  let raw;
  try {
    raw = readFileSync(detailsPath, 'utf8');
  } catch {
    throw new RosterError(
      `Cannot read ${detailsPath}. The party build needs contacts/player-details.json, ` +
      `which is gitignored - it is not in a fresh clone. Get it from Erik.`,
    );
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw new RosterError(`${detailsPath} is not valid JSON: ${e.message}`);
  }
  if (!doc.teams) throw new RosterError(`${detailsPath} has no "teams" key`);

  const players = [];
  for (const team of ['international', 'usa']) {
    const list = doc.teams[team];
    if (!Array.isArray(list)) throw new RosterError(`${detailsPath}: teams.${team} is not an array`);
    list.forEach((p, i) => {
      const name = (p.name || '').trim();
      if (!name) throw new RosterError(`${detailsPath}: teams.${team}[${i}] has no name`);
      players.push({
        id: `${PREFIX[team]}-${i + 1}`,
        team,
        name,
        country: (p.country || (team === 'usa' ? 'USA' : '')).trim(),
        hometown: (p.hometown || '').trim(),
        school: (p.school || '').trim(),
      });
    });
  }
  return players;
}

// Applies the console's decisions (console.mjs) to the page. The tested logic
// lives there; this file only draws and listens.
import {
  nameOf, syncLabel, describeProblems, slotLabel, createCommandClient, NEXT_LOCK_MS,
  matchCount, NEXT_FLIGHT_CAP_MS, recoveredBanner, loadUntilReady, LOGIN_PATH,
  pickerRows, jumpSections, screenRows, screensInSync, screensLabel, filmSections,
  fixSections,
  REVEAL_GAPS, revealGapFrom, sidesLeft, revealLabel, revealAllLabel, canRevealAll,
} from '/console.mjs';

const $ = (id) => document.getElementById(id);
let show = null;
let wire = null;
let showPicked = false;   // the picker's toggle, remembered until the page reloads
let noteTimer = null;
let lockTimer = null;
let repullTimer = null;
let capTimer = null;

const toLogin = () => location.replace(LOGIN_PATH);
const client = createCommandClient({
  fetch: (...a) => fetch(...a),
  onState: (state) => { wire = state; noticeShowRebuilt(state); render(); },
  onLogin: toLogin,
});

// A note is the hub telling the operator something reasonable. It stays quiet
// and fades; the console keeps working. A fault is loud and stays until the
// next command goes through.
function setNote(text) {
  clearTimeout(noteTimer);
  $('note').hidden = !text;
  $('note').textContent = text || '';
  if (text) noteTimer = setTimeout(() => setNote(''), 8000);
}

function setFault(text) {
  $('fault').hidden = !text;
  $('fault').textContent = text || '';
}

// --- Reveal all sides --------------------------------------------------------
//
// The first side now, the second after the gap. The timer lives in the console
// and nowhere else: the show's state is written to disk and read back on a
// restart, and a half-finished reveal is not a thing to find in a file. If this
// device goes away mid-pause nothing happens, which is the right way for it to
// fail - the operator taps Reveal and the night carries on.
const GAP_KEY = 'icup.revealGap';
// localStorage can throw outright in a private window, so the default stands if
// it does rather than the console refusing to boot over a preference.
function storedGap() {
  try { return revealGapFrom(localStorage.getItem(GAP_KEY)); } catch { return revealGapFrom(null); }
}
let gapSeconds = storedGap();

let revealTimer = null;      // the pending second side
let revealTick = null;       // repaints the countdown on the Reveal button
let revealDueAt = 0;
let revealForMatch = '';     // which match it belongs to, so it cannot fire on another

const matchKey = () => (wire && wire.slot ? `${wire.day}-${wire.slot.index}` : '');
const waitingSeconds = () => (revealDueAt ? Math.max(1, Math.ceil((revealDueAt - Date.now()) / 1000)) : 0);

function stopPacing() {
  const wasPending = revealDueAt !== 0;
  clearTimeout(revealTimer); revealTimer = null;
  clearInterval(revealTick); revealTick = null;
  revealDueAt = 0; revealForMatch = '';
  // The countdown is on a button; take it off straight away rather than leaving
  // it counting down to something that is no longer going to happen. A command
  // that then fails never repaints, which is exactly when this matters.
  if (wasPending) render();
}

// `pacing` marks the one command the pending reveal sends itself. Every other
// command cancels the pause - Next, a jump, a mode change, Undo, anything from
// the Fix dialog - because a reveal left armed would land on whatever match the
// operator had moved to by then. It is also what makes Reveal skip ahead: the
// operator taps it, the pause is dropped, and the side goes up now.
async function send(command, pacing = false) {
  if (!pacing) stopPacing();
  // Shut Next before anything is awaited: the page must not look live while a
  // request is in flight. The client's own lock is what actually decides.
  if (command.name === 'next') {
    if (!client.nextLocked()) {
      // If the hub never answers and nothing else repaints, the client frees
      // Next at the cap; this brings the button back on screen at the same moment.
      clearTimeout(capTimer);
      capTimer = setTimeout(render, NEXT_FLIGHT_CAP_MS + 50);
    }
    $('next').disabled = true;
  }
  const out = await client.send(command);
  if (out.kind === 'ok') {
    setFault('');
    setNote(typeof out.body.filled === 'number' ? `Filled ${out.body.filled} side(s) from AWS.` : '');
  } else if (out.kind === 'note') {
    setNote(out.message);
  } else if (out.kind === 'fault') {
    setFault(out.message);
  }
  if (command.name === 'next') {
    // Keep the button shut for the lock window, then open it again.
    render();
    clearTimeout(lockTimer);
    lockTimer = setTimeout(render, NEXT_LOCK_MS + 50);
  }
  return out;
}

function paintCountdown() {
  $('reveal').textContent = revealLabel(wire, waitingSeconds());
}

async function revealAll() {
  // Shut it before anything is awaited, so a second tap inside the round trip
  // cannot start a second pause. render() has the last word either way.
  $('reveal-all').disabled = true;
  const mine = matchKey();
  const out = await send({ name: 'reveal' });
  if (out.kind !== 'ok') { render(); return; }
  if (sidesLeft(wire) !== 1) { render(); return; }   // that was the last side
  const gap = gapSeconds * 1000;
  revealForMatch = mine;
  revealDueAt = Date.now() + gap;
  revealTimer = setTimeout(async () => {
    const due = revealForMatch;
    stopPacing();
    // The operator may have moved on, or revealed it by hand, in the meantime.
    if (matchKey() !== due || sidesLeft(wire) !== 1) { render(); return; }
    await send({ name: 'reveal' }, true);
  }, gap);
  revealTick = setInterval(paintCountdown, 250);
  render();
}

function renderPace() {
  $('pace-chips').replaceChildren(...REVEAL_GAPS.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn pace-chip${s === gapSeconds ? ' is-on' : ''}`;
    b.textContent = `${s}s`;
    b.onclick = () => {
      gapSeconds = revealGapFrom(s);
      try { localStorage.setItem(GAP_KEY, String(gapSeconds)); } catch { /* it just will not be remembered */ }
      renderPace();
    };
    return b;
  }));
}

function perSide() { return wire.day === 1 ? 2 : 1; }

// Opening a dialog is asynchronous now. A rejection belongs in the fault banner,
// where the operator can see it, not in a silent unhandled promise.
const guard = (promise) => promise.catch(() => setFault('Could not open that. Try again.'));

// Everything the picker and the Jump list know about the rest of the night. It
// is gated, so it cannot ride on the state stream the public stage reads, and it
// is fetched when a dialog opens rather than on every reveal.
//
// If it cannot be had, the dialogs still open on what the state stream carries:
// the match in play, and the right number of rows for every other one. A console
// that refuses to open its picker is worse than a picker that knows less.
function fallbackBoard() {
  const days = {};
  for (const d of ['1', '2']) {
    days[d] = Array.from({ length: matchCount(Number(d)) }, (_, i) => ({
      index: i + 1, intl: [], usa: [], done: false,
    }));
  }
  const here = days[String(wire.day)][wire.slot.index - 1];
  if (here) { here.intl = [...(wire.slot.intl || [])]; here.usa = [...(wire.slot.usa || [])]; }
  return { day: wire.day, current: { [wire.day]: wire.slot.index - 1 }, days };
}

async function loadBoard() {
  try {
    const res = await fetch('/api/board', { cache: 'no-store' });
    if (res.status === 401) { toLogin(); return null; }
    if (!res.ok) return fallbackBoard();
    const board = await res.json();
    return board && board.days ? board : fallbackBoard();
  } catch {
    return fallbackBoard();
  }
}

// `at` names a match other than the one in play - {day, index, number, intl,
// usa} - and is how the Fix dialog corrects a drawing without the room seeing
// it. Without it, the match on the screen, exactly as before.
async function openPicker(side, pos, at = null, after = null) {
  const dialog = $('picker');
  const list = $('picker-list');
  const filter = $('picker-filter');
  const toggle = $('picker-toggle');
  const day = at ? at.day : wire.day;
  const per = day === 1 ? 2 : 1;
  const number = at ? at.number : wire.slot.index;
  const held = at || wire.slot;
  const who = side === 'intl' ? 'International player' : 'USA player';
  $('picker-title').textContent = at ? `${who} \u2014 Day ${day} match ${number}` : who;

  const board = await loadBoard();
  if (!board) return;                       // the session went: loadBoard sent us to the login
  const holding = (held[side] || [])[pos] || '';

  const paint = () => {
    const { rows, hidden } = pickerRows(show, {
      side, board, day, holding, current: number,
      showPicked, query: filter.value,
    });
    toggle.textContent = showPicked
      ? 'Hide players already picked'
      : `Show ${hidden} already picked`;
    // Nothing to reveal and nothing hidden: the toggle would do nothing visible.
    toggle.hidden = !showPicked && hidden === 0;
    list.replaceChildren(...rows.map((row) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.textContent = row.name;
      if (row.picked || row.holding) {
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = row.holding ? ' · in this slot now' : ` · ${row.where}`;
        b.append(meta);
      }
      b.onclick = async () => {
        const players = [...(held[side] || [])];
        while (players.length < per) players.push('');
        players[pos] = row.id;
        dialog.close();
        await send(at ? { name: 'assign', side, players, day, index: at.index } : { name: 'assign', side, players });
        if (after) after();
      };
      li.append(b);
      return li;
    }));
  };

  filter.value = '';
  filter.oninput = paint;
  toggle.onclick = () => { showPicked = !showPicked; paint(); };
  paint();
  dialog.showModal();
}

// The one match list. On its own it is Jump to…, which moves the show to the
// match tapped. The Fix dialog borrows it to ask WHICH match, passing a `pick`
// that does something else entirely with the row - and then the suffixes change
// too, because "done, reopens it" describes jumping and nothing else.
async function openJumper({ title = 'Jump to match', pick = null, after = null } = {}) {
  const dialog = $('jumper');
  const list = $('jumper-list');
  $('jumper-title').textContent = title;
  const board = await loadBoard();
  if (!board) return;

  let here = null;
  list.replaceChildren(...jumpSections(show, board).map((section) => {
    const box = document.createElement('section');
    box.className = 'jump-day';
    const h = document.createElement('h4');
    h.textContent = section.title;
    const ul = document.createElement('ul');
    ul.replaceChildren(...section.rows.map((row) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = `jump${row.current ? ' is-here' : ''}`;
      const label = document.createElement('span');
      label.className = 'jump-label';
      label.textContent = row.label;
      if (row.current) label.textContent += ' · here now';
      else if (pick) { if (row.announced) label.textContent += ' · announced'; }
      else if (row.done) label.textContent += ' · done, reopens it';
      b.append(label);
      if (row.names) {
        const meta = document.createElement('span');
        meta.className = 'meta jump-names';
        meta.textContent = row.names;
        b.append(meta);
      }
      b.onclick = async () => {
        dialog.close();
        // reopen carries its own day; goto now takes one too, so jumping across
        // days stays a single command and a single Undo.
        if (pick) await pick(row);
        else await send(row.done
          ? { name: 'reopen', day: row.day, index: row.index }
          : { name: 'goto', day: row.day, index: row.index });
        if (after) after();
      };
      if (row.current) here = b;
      li.append(b);
      return li;
    }));
    box.append(h, ul);
    return box;
  }));
  dialog.showModal();
  // 39 matches over two days is a long list; open it where the operator is.
  if (here && here.scrollIntoView) here.scrollIntoView({ block: 'center' });
}

// Jump to a film…: one screen, one film. The command puts that screen on the
// films as well as choosing where to start, so a mirroring television becomes a
// film without a second tap. The dialog stays open over the Screens dialog and
// closes back onto it, so a mis-tap costs one tap, not the whole journey again.
function openFilms(screen, cued, after) {
  const dialog = $('films-dialog');
  const list = $('films-list');
  const filter = $('films-filter');
  $('films-title').textContent = screen === 'main' ? 'Jump to a film — main screen' : `Jump to a film — ${screen}`;

  const paint = () => {
    const sections = filmSections(show, { cued, query: filter.value });
    $('films-empty').hidden = sections.length > 0;
    list.replaceChildren(...sections.map((section) => {
      const box = document.createElement('section');
      box.className = 'jump-day';
      const h = document.createElement('h4');
      h.textContent = section.title;
      const ul = document.createElement('ul');
      ul.replaceChildren(...section.rows.map((row) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.className = `film${row.cued ? ' is-cued' : ''}`;
        b.type = 'button';
        b.textContent = row.name;
        if (row.cued) {
          const meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = ' · last jumped to';
          b.append(meta);
        }
        b.onclick = async () => {
          dialog.close();
          await send({ name: 'playFilm', screen, playerId: row.playerId });
          if (after) after();
        };
        li.append(b);
        return li;
      }));
      box.append(h, ul);
      return box;
    }));
  };

  filter.value = '';
  filter.oninput = paint;
  paint();
  dialog.showModal();
}

// Screens: which television is showing what, and one button to put them all
// back on the show. Roles are not show state, so nothing here is undoable.
function openScreens() {
  const dialog = $('screens-dialog');
  const list = $('screens-list');
  const sync = $('screens-sync');

  const paint = () => {
    sync.disabled = screensInSync(wire);
    sync.textContent = sync.disabled
      ? 'Every screen is on the show'
      : 'Put every screen back on the show';
    list.replaceChildren(...screenRows(wire).map((row) => {
      const box = document.createElement('section');
      box.className = 'screen-row';
      const h = document.createElement('h4');
      h.textContent = row.label;
      const roles = document.createElement('div');
      roles.className = 'screen-roles';
      roles.replaceChildren(...row.roles.map((r) => {
        const b = document.createElement('button');
        b.className = `btn screen-role${r.role === row.role ? ' is-on' : ''}`;
        b.type = 'button';
        b.textContent = r.label;
        b.title = r.hint;
        b.disabled = r.role === row.role;
        b.onclick = async () => {
          await send({ name: 'setScreen', screen: row.name, role: r.role });
          paint();
        };
        return b;
      }));
      box.append(h, roles);

      // Straight to one player's film. Enabled whatever the screen is doing now:
      // choosing a film is also how a screen is put on the films.
      const film = document.createElement('button');
      film.className = 'btn btn-quiet screen-film';
      film.type = 'button';
      film.textContent = 'Jump to a film…';
      const any = filmSections(show).length > 0;
      film.disabled = !any;
      film.title = any
        ? 'Start this screen at one player\u2019s film, then carry on from there.'
        : 'This show has no films.';
      film.onclick = () => openFilms(row.name, row.cue ? row.cue.playerId : '', paint);
      box.append(film);
      if (row.cue) {
        const said = document.createElement('p');
        said.className = 'screen-cue';
        said.textContent = `Last jumped to ${nameOf(show, row.cue.playerId)}`;
        box.append(said);
      }
      return box;
    }));
  };

  sync.onclick = async () => { await send({ name: 'syncScreens' }); paint(); };
  paint();
  dialog.showModal();
}

// --- Fix… -------------------------------------------------------------------
//
// The ways back that Undo cannot reach. What each row says, and which rows ask
// twice, is decided in console.mjs where the tests can reach it; this draws the
// rows and runs them.

// Two taps for the rows that swallow a stretch of the night: the first arms the
// button and tells it what it is about to do, the second does it. Not a browser
// confirm() - a modal alert blocks every event the page gets, which on the one
// device running the show is the worst thing that could sit between the operator
// and the room - and a button that changes under the finger is the same guard
// without adding anything to dismiss. It disarms itself after a few seconds, so
// a dialog left open and come back to is never half-way through something.
const ARMED_MS = 5000;
let armedKey = null;
let armedTimer = null;

function disarm() {
  clearTimeout(armedTimer);
  armedKey = null;
}

function fixButton(row, ctx) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn fix-row${row.tone === 'danger' ? ' btn-danger' : ''}`;
  b.disabled = Boolean(row.disabled);
  const label = document.createElement('span');
  label.className = 'fix-label';
  const detail = document.createElement('span');
  detail.className = 'meta fix-detail';
  b.append(label, detail);

  const draw = () => {
    const armed = armedKey === row.key;
    b.classList.toggle('is-armed', armed);
    // The label the operator was reading moves down into the detail line, so
    // the armed button still says which one it is.
    label.textContent = armed ? 'Tap again to be sure' : row.label;
    detail.textContent = armed ? row.label : row.detail;
  };
  ctx.draws.push(draw);
  draw();

  const act = async () => {
    if (row.edit) {
      // Three stacked dialogs is enough; this one goes four deep (fix, list,
      // match, picker), so the fix dialog stands down and comes back after.
      ctx.dialog.close();
      await guard(openJumper({
        title: row.pick,
        pick: (at) => guard(openEditor(at.day, at.index, () => guard(openFixer()))),
      }));
      return;
    }
    if (row.pick) {
      await guard(openJumper({
        title: row.pick,
        pick: (at) => send({ ...row.command, day: at.day, index: at.index }),
        after: ctx.repaint,
      }));
      return;
    }
    await send(row.command);
    await ctx.repaint();
  };

  b.onclick = () => {
    if (row.confirm && armedKey !== row.key) {
      disarm();
      armedKey = row.key;
      ctx.redraw();
      armedTimer = setTimeout(() => { disarm(); ctx.redraw(); }, ARMED_MS);
      return;
    }
    disarm();
    ctx.redraw();
    act();
  };
  return b;
}

async function openFixer() {
  const dialog = $('fixer');
  const list = $('fixer-list');
  disarm();

  // Repainted after every row that fires, because the labels carry counts -
  // "14 announced now" - and a count that has stopped being true is worse than
  // no count at all.
  const paint = async () => {
    const board = await loadBoard();
    if (!board) return false;
    const draws = [];
    const ctx = {
      dialog,
      draws,
      redraw: () => { for (const f of draws) f(); },
      repaint: () => paint(),
    };
    list.replaceChildren(...fixSections(show, wire, board).map((section) => {
      const box = document.createElement('section');
      box.className = 'fix-group';
      const h = document.createElement('h4');
      h.textContent = section.title;
      const hint = document.createElement('p');
      hint.className = 'hint fix-hint';
      hint.textContent = section.hint;
      box.append(h, hint, ...section.rows.map((row) => fixButton(row, ctx)));
      return box;
    }));
    return true;
  };

  if (!(await paint())) return;             // loadBoard sent us to the login
  if (!dialog.open) dialog.showModal();
}

// One match's own pickers, for a match that is not on the screen. The commands
// carry the day and the match, so nothing moves to it and the room goes on
// looking at whatever it was looking at.
async function openEditor(day, index, after = null) {
  const dialog = $('editor');
  const sides = $('editor-sides');
  let at = null;

  const load = async () => {
    const board = await loadBoard();
    if (!board) return false;
    const rows = board.days && Array.isArray(board.days[String(day)]) ? board.days[String(day)] : [];
    const m = rows[index] && typeof rows[index] === 'object' ? rows[index] : {};
    at = {
      day,
      index,
      number: Number.isInteger(m.index) ? m.index : index + 1,
      intl: Array.isArray(m.intl) ? [...m.intl] : [],
      usa: Array.isArray(m.usa) ? [...m.usa] : [],
      firstSide: m.firstSide === 'usa' ? 'usa' : 'intl',
    };
    return true;
  };

  const paint = () => {
    $('editor-title').textContent = `Change who is in Day ${at.day} match ${at.number}`;
    const per = at.day === 1 ? 2 : 1;
    sides.replaceChildren(...['intl', 'usa'].map((side) => {
      const box = document.createElement('div');
      box.className = `side${at.firstSide === side ? ' is-first' : ''}`;
      box.dataset.side = side;
      const h = document.createElement('h3');
      h.textContent = side === 'intl' ? 'International ' : 'USA ';
      const tag = document.createElement('span');
      tag.className = 'first-tag';
      tag.textContent = 'reveals first';
      h.append(tag);
      const picks = document.createElement('div');
      picks.className = 'picks';
      picks.replaceChildren(...Array.from({ length: per }, (_, pos) => {
        const id = at[side][pos] || '';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `pick${id ? '' : ' empty'}`;
        b.textContent = id ? nameOf(show, id) : 'Tap to pick';
        b.onclick = () => guard(openPicker(side, pos, at, async () => {
          if (await load()) paint();
        }));
        return b;
      }));
      box.append(h, picks);
      return box;
    }));
  };

  if (!(await load())) return;
  paint();
  $('editor-first').onclick = async () => {
    const out = await send({ name: 'setFirstSide', side: at.firstSide === 'intl' ? 'usa' : 'intl', day: at.day, index: at.index });
    if (out.kind === 'ok' && await load()) paint();
  };
  $('editor-cancel').onclick = () => { dialog.close(); if (after) after(); };
  dialog.showModal();
}

function renderSide(side) {
  const box = document.querySelector(`.side[data-side="${side}"]`);
  box.classList.toggle('is-first', wire.slot.firstSide === side);
  const revealed = wire.slot.shown === 'both'
    || (wire.slot.shown === 'first' && side === wire.slot.firstSide);
  const picks = box.querySelector('.picks');
  picks.replaceChildren(...Array.from({ length: perSide() }, (_, pos) => {
    const id = (wire.slot[side] || [])[pos] || '';
    const b = document.createElement('button');
    b.className = `pick${id ? '' : ' empty'}${revealed && id ? ' revealed' : ''}`;
    b.textContent = id ? nameOf(show, id) : 'Tap to pick';
    b.onclick = () => guard(openPicker(side, pos));
    return b;
  }));
}

function render() {
  if (!show || !wire) return;
  $('slot-label').textContent = slotLabel(wire) + (wire.rehearsal ? '  ·  REHEARSAL' : '');

  const sync = syncLabel(wire.sync);
  $('sync').textContent = sync.text;
  $('sync').dataset.tone = sync.tone;

  const problems = describeProblems(wire.slot.problems, show);
  const box = $('problems');
  box.hidden = problems.length === 0;
  const ul = document.createElement('ul');
  ul.replaceChildren(...problems.map((p) => { const li = document.createElement('li'); li.textContent = p; return li; }));
  box.replaceChildren(ul);

  renderSide('intl');
  renderSide('usa');

  const nextIds = [...(wire.next.intl || []), ...(wire.next.usa || [])].filter(Boolean);
  $('next-summary').textContent = nextIds.length
    ? nextIds.map((id) => nameOf(show, id)).join(' · ')
    : 'Last match of the day';

  const waiting = waitingSeconds();
  $('reveal').textContent = revealLabel(wire, waiting);
  $('reveal').disabled = sidesLeft(wire) === 0;
  $('reveal-all').textContent = revealAllLabel(wire, waiting);
  // Shut while a pause is running: it is already doing what it says. Reveal is
  // the one that brings the second side forward.
  $('reveal-all').disabled = !canRevealAll(wire) || waiting > 0;
  $('next').disabled = client.nextLocked();
  $('day1').disabled = wire.day === 1;
  $('day2').disabled = wire.day === 2;
  $('slideshow').textContent = wire.mode === 'slideshow' ? 'Back to live' : 'Slideshow';
  // Both of these are a toggle back to the show, so whichever one is on says
  // so and the other keeps its own name - two buttons reading "Back to live"
  // at once would be a choice where there is only one way out.
  $('photos').textContent = wire.mode === 'photos' ? 'Back to live' : 'Photos';
  $('screens').textContent = screensLabel(wire);
}

// Before the first load succeeds there is no state to act on. A tap then says so
// instead of throwing; the fault banner is already explaining the wait.
const ready = (fn) => () => {
  if (!wire || !show) { setNote('Still loading the show. One moment.'); return; }
  return fn();
};

$('reveal').onclick = ready(() => send({ name: 'reveal' }));
$('reveal-all').onclick = ready(() => revealAll());
$('next').onclick = ready(() => send({ name: 'next' }));
$('undo').onclick = ready(() => send({ name: 'undo' }));
$('day1').onclick = ready(() => send({ name: 'setDay', day: 1 }));
$('day2').onclick = ready(() => send({ name: 'setDay', day: 2 }));
$('jump').onclick = ready(() => guard(openJumper()));
$('refresh').onclick = ready(() => send({ name: 'refreshFromAws' }));
$('slideshow').onclick = ready(() => send({ name: 'setMode', mode: wire.mode === 'slideshow' ? 'live' : 'slideshow' }));
$('photos').onclick = ready(() => send({ name: 'setMode', mode: wire.mode === 'photos' ? 'live' : 'photos' }));
$('toggle-first').onclick = ready(() => send({ name: 'setFirstSide', side: wire.slot.firstSide === 'intl' ? 'usa' : 'intl' }));
$('screens').onclick = ready(() => openScreens());
$('fix').onclick = ready(() => guard(openFixer()));
$('fixer-cancel').onclick = () => { disarm(); $('fixer').close(); };
$('screens-cancel').onclick = () => $('screens-dialog').close();
$('films-cancel').onclick = () => $('films-dialog').close();
$('picker-cancel').onclick = () => $('picker').close();
$('jumper-cancel').onclick = () => $('jumper').close();

async function repull() {
  try {
    wire = await (await fetch('/api/state')).json();
    setFault('');
    // This is the path a hub restart actually takes: the stream drops, repull
    // brings the state back, and the stream may take its time reconnecting. If
    // the check only hung off the stream's frames, a console could sit on the
    // old roster for as long as the reconnect took.
    noticeShowRebuilt(wire);
    render();
  } catch { setFault('Lost the connection to the show. Retrying…'); }
}

// If the previous state file was unusable the show started from match 1. Say so.
async function checkRecovered() {
  try {
    const res = await fetch('/api/whoami');
    const who = await res.json();
    if (res.status === 401 && who.needPassword) return toLogin();
    const box = $('recovered');
    const banner = recoveredBanner(who);
    box.hidden = !banner;
    box.textContent = banner || '';
  } catch { /* the banner is a courtesy; the console works without it */ }
}

// Same as the stage: the roster, the cards and the films can all change under an
// open console when the show is rebuilt and the hub restarted. The frames carry
// the show's build stamp, so the console can tell and fetch the roster again
// instead of showing yesterday's players.
let refetching = false;
function noticeShowRebuilt(frame) {
  if (!show || !frame || typeof frame.built !== 'string' || frame.built === '') return;
  if (frame.built === show.built || refetching) return;
  refetching = true;
  fetch('/api/show', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((fresh) => {
      if (!fresh || !Array.isArray(fresh.players)) return;
      fresh.byId = Object.fromEntries(fresh.players.map((p) => [p.id, p]));
      show = fresh;
      setNote('The show was rebuilt — this console has reloaded the players.');
      render();
    })
    .catch(() => { /* the next frame tries again */ })
    .finally(() => { refetching = false; });
}

async function loadShow() {
  const shown = await (await fetch('/api/show')).json();
  // JSON loses the hub's byId index; nameOf copes, but index it anyway.
  shown.byId = Object.fromEntries(shown.players.map((p) => [p.id, p]));
  const state = await (await fetch('/api/state')).json();
  if (!state || !state.slot) throw new Error('no state');
  return { shown, state };
}

async function boot() {
  await loadUntilReady({
    load: loadShow,
    onReady: ({ shown, state }) => { show = shown; wire = state; setFault(''); },
    onFail: () => setFault('Could not load the show. Check the wifi — this page will keep trying.'),
    wait: () => new Promise((r) => setTimeout(r, 3000)),
  });
  render();
  renderPace();
  checkRecovered();

  const events = new EventSource('/events');
  events.addEventListener('state', (e) => {
    setFault('');
    wire = JSON.parse(e.data);
    noticeShowRebuilt(wire);
    render();
  });
  // Safari suspends a backgrounded tab. On reconnect, re-pull the whole state
  // instead of assuming nothing was missed while the iPad was asleep.
  events.onerror = () => {
    setFault('Lost the connection to the show. Retrying…');
    clearTimeout(repullTimer);
    repullTimer = setTimeout(repull, 1500);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') repull();
  });
}

boot();

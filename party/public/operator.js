// Applies the console's decisions (console.mjs) to the page. The tested logic
// lives there; this file only draws and listens.
import {
  rosterFor, nameOf, syncLabel, describeProblems, slotLabel, createCommandClient, NEXT_LOCK_MS,
} from '/console.mjs';

const $ = (id) => document.getElementById(id);
let show = null;
let wire = null;
let noteTimer = null;
let lockTimer = null;

const toLogin = () => location.replace('/operator');
const client = createCommandClient({
  fetch: (...a) => fetch(...a),
  onState: (state) => { wire = state; render(); },
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

async function send(command) {
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

function perSide() { return wire.day === 1 ? 2 : 1; }

function openPicker(side, pos) {
  const dialog = $('picker');
  const list = $('picker-list');
  const filter = $('picker-filter');
  $('picker-title').textContent = side === 'intl' ? 'International player' : 'USA player';

  const taken = new Set([...(wire.slot.intl || []), ...(wire.slot.usa || [])].filter(Boolean));

  const paint = () => {
    const q = filter.value.trim().toLowerCase();
    list.replaceChildren(...rosterFor(show, side)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((p) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.textContent = p.name;
        if (taken.has(p.id)) {
          const meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = ' · already in this match';
          b.append(meta);
        }
        b.onclick = async () => {
          const players = [...(wire.slot[side] || [])];
          while (players.length < perSide()) players.push('');
          players[pos] = p.id;
          dialog.close();
          await send({ name: 'assign', side, players });
        };
        li.append(b);
        return li;
      }));
  };

  filter.value = '';
  filter.oninput = paint;
  paint();
  dialog.showModal();
}

function openJumper() {
  const dialog = $('jumper');
  const total = wire.day === 1 ? 13 : 26;
  const list = $('jumper-list');
  list.replaceChildren(...Array.from({ length: total }, (_, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    // slot.index and completed[].index count from 1; the commands count from 0.
    const done = (wire.completed || []).some((c) => c.day === wire.day && c.index === i + 1);
    b.textContent = `Match ${i + 1}`;
    if (done) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = ' · done, reopens it';
      b.append(meta);
    }
    b.onclick = async () => {
      dialog.close();
      await send(done ? { name: 'reopen', day: wire.day, index: i } : { name: 'goto', index: i });
    };
    li.append(b);
    return li;
  }));
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
    b.onclick = () => openPicker(side, pos);
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

  $('reveal').textContent = wire.slot.shown === 'none' ? 'Reveal first side'
    : wire.slot.shown === 'first' ? 'Reveal second side' : 'Both revealed';
  $('reveal').disabled = wire.slot.shown === 'both';
  $('next').disabled = client.nextLocked();
  $('day1').disabled = wire.day === 1;
  $('day2').disabled = wire.day === 2;
  $('slideshow').textContent = wire.mode === 'slideshow' ? 'Back to live' : 'Slideshow';
}

$('reveal').onclick = () => send({ name: 'reveal' });
$('next').onclick = () => send({ name: 'next' });
$('undo').onclick = () => send({ name: 'undo' });
$('day1').onclick = () => send({ name: 'setDay', day: 1 });
$('day2').onclick = () => send({ name: 'setDay', day: 2 });
$('jump').onclick = () => openJumper();
$('refresh').onclick = () => send({ name: 'refreshFromAws' });
$('slideshow').onclick = () => send({ name: 'setMode', mode: wire.mode === 'slideshow' ? 'live' : 'slideshow' });
$('toggle-first').onclick = () => send({ name: 'setFirstSide', side: wire.slot.firstSide === 'intl' ? 'usa' : 'intl' });
$('picker-cancel').onclick = () => $('picker').close();
$('jumper-cancel').onclick = () => $('jumper').close();

async function repull() {
  try {
    wire = await (await fetch('/api/state')).json();
    setFault('');
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
    box.hidden = !who.recovered;
    box.textContent = who.recovered
      ? `The show started over from Day 1, match 1 because the saved state could not be read${who.recoveredReason ? ` (${who.recoveredReason})` : ''}. If you were part-way through, use Jump to… to get back.`
      : '';
  } catch { /* the banner is a courtesy; the console works without it */ }
}

async function boot() {
  show = await (await fetch('/api/show')).json();
  // JSON loses the hub's byId index; nameOf copes, but index it anyway.
  show.byId = Object.fromEntries(show.players.map((p) => [p.id, p]));
  wire = await (await fetch('/api/state')).json();
  render();
  checkRecovered();

  const events = new EventSource('/events');
  events.addEventListener('state', (e) => { setFault(''); wire = JSON.parse(e.data); render(); });
  // Safari suspends a backgrounded tab. On reconnect, re-pull the whole state
  // instead of assuming nothing was missed while the iPad was asleep.
  events.onerror = () => {
    setFault('Lost the connection to the show. Retrying…');
    setTimeout(repull, 1500);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') repull();
  });
}

boot();

// Applies the plan from panels.mjs to the DOM. The decisions live there and are
// tested; this file only does what the plan says.
import {
  screenPlan, panelsForMatch, preloadSrcs, slideshowEntry, panelsToLoad, srcAfterError,
} from '/panels.mjs';

const layers = { a: document.getElementById('layer-a'), b: document.getElementById('layer-b') };
const preloadBox = document.getElementById('preload');
const cover = document.getElementById('cover');

let show = null;
let wire = null;
let live = 'a';            // which layer is on screen
let primed = false;        // has the operator clicked once
let slideTimer = null;
let slidePosition = 0;
let slideEntry = null;

const other = (k) => (k === 'a' ? 'b' : 'a');
const report = (e) => { try { console.error('[stage]', e); } catch { /* nothing to do */ } };

function clearSlideTimer() {
  if (slideTimer) { clearTimeout(slideTimer); slideTimer = null; }
}

function makePanelEl() {
  const el = document.createElement('div');
  el.className = 'panel';
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.loop = false;      // play once and hold the last frame: it is the information panel
  video.controls = false;
  const name = document.createElement('div');
  name.className = 'fallback-name';
  el.append(video, name);

  // A clip that will not play: its flag card, once. If that fails too, show the name.
  video.addEventListener('error', () => {
    if (!video.getAttribute('src')) return;
    const next = el.dataset.triedFallback === '1' ? null : srcAfterError(el._panel, video.currentSrc || video.getAttribute('src'));
    if (next) {
      el.dataset.triedFallback = '1';
      video.src = `/${next}`;
      video.load();
      delete el.dataset.started;
      playIfDue(el);
    } else {
      el.classList.add('text-only');
    }
  });
  return el;
}

function playIfDue(el) {
  const video = el.firstChild;
  const panel = el._panel;
  if (!panel || !panel.visible || !panel.src || !primed || el.dataset.started === '1') return;
  el.dataset.started = '1';
  const p = video.play();
  if (p && p.catch) p.catch(() => { delete el.dataset.started; });   // retried on the next render
}

function loadPanel(el, panel) {
  const video = el.firstChild;
  el.classList.remove('text-only');
  delete el.dataset.triedFallback;
  delete el.dataset.started;
  if (panel.src) {
    video.src = `/${panel.src}`;
  } else {
    video.removeAttribute('src');
  }
  video.load();
}

function applyPlan(container, plan, { force = false } = {}) {
  if (container.dataset.fmt !== plan.fmt || container.children.length !== plan.panels.length) {
    container.replaceChildren(...plan.panels.map(makePanelEl));
    container.dataset.fmt = plan.fmt;
    container._applied = [];
  }
  const toLoad = new Set(force ? plan.panels.map((_, i) => i) : panelsToLoad(container._applied, plan.panels));
  plan.panels.forEach((panel, i) => {
    const el = container.children[i];
    el._panel = panel;
    if (el.lastChild.textContent !== panel.name) el.lastChild.textContent = panel.name;

    // Only a panel whose player changed is touched. Re-assigning src to the clip
    // already in a box reloads it and flashes the held frame to black mid-reveal.
    if (toLoad.has(i)) {
      loadPanel(el, panel);
      container._applied[i] = panel.playerId;
    }

    el.classList.toggle('shown', panel.visible);
    if (panel.visible && !panel.src) {
      el.classList.add('text-only');
    } else if (!panel.visible && el.dataset.started === '1') {
      // Hidden again (undo): rewind so the next reveal plays rather than showing the end.
      const video = el.firstChild;
      video.pause();
      try { video.currentTime = 0; } catch { /* not loaded yet */ }
      delete el.dataset.started;
    }
    playIfDue(el);
  });
}

function applyPreload() {
  const want = preloadSrcs(wire, show);
  const have = [...preloadBox.children].map((v) => v.dataset.rel);
  if (want.join('|') === have.join('|')) return;
  preloadBox.replaceChildren(...want.map((rel) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.dataset.rel = rel;
    v.src = `/${rel}`;
    return v;
  }));
}

function showLayer(key) {
  document.body.classList.remove('idle');
  layers[key].classList.add('live');
  layers[other(key)].classList.remove('live');
}

function renderLive(plan) {
  clearSlideTimer();
  applyPlan(layers[live], plan);
  showLayer(live);
  applyPreload();
}

function renderIdle() {
  clearSlideTimer();
  document.body.classList.add('idle');
  layers.a.classList.remove('live');
  layers.b.classList.remove('live');
}

function renderSlideshow() {
  clearSlideTimer();
  slideEntry = slideshowEntry({ completed: wire.completed, slideshow: { position: slidePosition } });
  if (!slideEntry) { renderIdle(); return; }
  const back = other(live);
  applyPlan(layers[back], panelsForMatch(slideEntry, show), { force: true });
  showLayer(back);
  live = back;
  const dwell = Number(wire.slideshow && wire.slideshow.dwellSeconds) || 12;
  slideTimer = setTimeout(() => {
    slidePosition += 1;
    try { renderSlideshow(); } catch (e) { report(e); }
  }, dwell * 1000 + 600);
}

function render(prev) {
  if (!show || !wire) return;
  // panels.mjs owns the gate: this only carries out what it says.
  const { screen, plan } = screenPlan(wire, show);
  if (screen === 'slideshow') {
    const pos = (wire.slideshow && wire.slideshow.position) || 0;
    const prevPos = prev && prev.slideshow ? prev.slideshow.position : undefined;
    if (!prev || prev.mode !== 'slideshow' || pos !== prevPos || !slideTimer) {
      slidePosition = pos;
      renderSlideshow();
    } else if (slideEntry) {
      applyPlan(layers[live], panelsForMatch(slideEntry, show));   // start anything now due; reloads nothing
    }
  } else if (screen === 'live') {
    renderLive(plan);
  } else {
    renderIdle();
  }
}

// One click at setup, then never again. The click is also the user activation that
// lets play() run; anything revealed before it is started here, not lost.
cover.addEventListener('click', () => {
  primed = true;
  cover.classList.add('gone');
  try { render(wire); } catch (e) { report(e); }
});

async function loadShow() {
  for (;;) {
    try {
      const res = await fetch('/api/show', { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch { /* hub not up yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function boot() {
  show = await loadShow();
  // The hub sends a full snapshot on every (re)connect, and EventSource reconnects by itself.
  const events = new EventSource('/events');
  events.addEventListener('state', (e) => {
    try {
      const prev = wire;
      wire = JSON.parse(e.data);
      render(prev);
    } catch (err) { report(err); }   // a bad frame must never blank the screen
  });
}

boot().catch(report);

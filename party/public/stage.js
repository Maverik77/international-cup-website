// Applies the plan from panels.mjs to the DOM. The decisions live there and are
// tested; this file only does what the plan says.
import {
  screenPlan, panelsForMatch, preloadSrcs, slideshowEntry, panelsToLoad, srcAfterError, startOffset,
  screenNameFrom, flagRow, nobodyDrawn, WAITING_LINE, TITLE_LINE, TITLE_YEAR,
} from '/panels.mjs';

// Which screen this is: /stage is "main", /stage?screen=bar is "bar". Read once,
// because it is also what this page tells the hub when it connects.
const MY_SCREEN = screenNameFrom(new URLSearchParams(location.search).get('screen'));

const layers = { a: document.getElementById('layer-a'), b: document.getElementById('layer-b') };
const preloadBox = document.getElementById('preload');
const cover = document.getElementById('cover');
const drawList = document.getElementById('draw-list');
const drawRows = drawList.querySelector('.rows');
const filmEls = [...document.getElementById('films').querySelectorAll('video')];
const photoBox = document.getElementById('photos');
const photoEls = [...photoBox.querySelectorAll('.shot')];
const title = document.getElementById('match-title');
const titleDay = title.querySelector('.day');
const titleNum = title.querySelector('.num');

let show = null;
let wire = null;
let live = 'a';            // which layer is on screen
let primed = false;        // has the operator clicked once
let slideTimer = null;
let slidePosition = 0;
let slideEntry = null;
let filmSrcs = [];         // the films this screen is playing, in order
let filmIndex = 0;         // which of them is on screen
let filmShowing = -1;      // which of the two elements it is in; -1 = none yet
let filmSkip = null;
let filmCueSeen = 0;       // the last Jump to a film… this screen has carried out
let photoTimer = null;
let photoSrcs = [];        // the photographs this screen is showing, in order
let photoIndex = 0;        // which of them is on screen
let photoShowing = -1;     // which of the two frames it is in; -1 = none yet
let photoKey = '';         // the list we last built the frames from
let photoSkip = null;
let photoPreload = null;   // decoding the next photograph, once the fade is over
let photoNone = null;      // the "nothing to show" notice, made once if ever needed

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

// A layer holds a flex row of panels and, over it, the glyphs that sit in the
// gaps between them. Keeping them in separate boxes means rebuilding the panels
// for a new format never disturbs the glyphs, and vice versa.
function partsOf(container) {
  let panels = container.querySelector('.panels');
  if (!panels) {
    panels = document.createElement('div');
    panels.className = 'panels';
    const joins = document.createElement('div');
    joins.className = 'joins';
    container.replaceChildren(panels, joins);
  }
  return { panels, joins: container.querySelector('.joins') };
}

// Gap g lies between panel g and panel g+1, so it belongs at (g+1)/panels across.
// The base class is written only when it changes: rewriting className every frame
// would drop and re-add `shown` and restart the fade on a glyph already up.
function applyJoins(box, plan) {
  const joins = Array.isArray(plan.joins) ? plan.joins : [];
  if (box.children.length !== joins.length) {
    box.replaceChildren(...joins.map(() => document.createElement('div')));
  }
  joins.forEach((join, i) => {
    const el = box.children[i];
    const base = `join ${join.kind}`;
    if (el.dataset.base !== base) { el.className = base; el.dataset.base = base; }
    if (el.textContent !== join.glyph) el.textContent = join.glyph;
    el.style.left = `${((join.at + 1) / plan.panels.length) * 100}%`;
    el.classList.toggle('shown', Boolean(join.visible));
  });
}

// The match number: full screen while nothing is revealed - that is the screen
// that used to be black between Next and the first Reveal - then docked at the
// top by the `big` class coming off. Empty text means no title at all.
function applyTitle(match) {
  const m = match && typeof match === 'object' ? match : { day: '', match: '', big: false };
  if (titleDay.textContent !== m.day) titleDay.textContent = m.day;
  if (titleNum.textContent !== m.match) titleNum.textContent = m.match;
  title.classList.toggle('on', Boolean(m.match));
  title.classList.toggle('big', Boolean(m.big));
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
  const parts = partsOf(container);
  const box = parts.panels;
  if (container.dataset.fmt !== plan.fmt || box.children.length !== plan.panels.length) {
    box.replaceChildren(...plan.panels.map(makePanelEl));
    container.dataset.fmt = plan.fmt;
    container._applied = [];
  }
  const toLoad = new Set(force ? plan.panels.map((_, i) => i) : panelsToLoad(container._applied, plan.panels));
  plan.panels.forEach((panel, i) => {
    const el = box.children[i];
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
  applyJoins(parts.joins, plan);
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
  // Nobody drawn into this match yet: the room is waiting on the hat, not on a
  // reveal, so it gets the title card and its line rather than a black screen.
  // A match that IS drawn but unrevealed stays black - that is the reveal.
  if (nobodyDrawn(plan)) { renderIdle(); return; }
  stopPhotos();
  clearSlideTimer();
  stopFilms();
  document.body.classList.remove('list');
  applyPlan(layers[live], plan);
  applyTitle(plan.match);
  showLayer(live);
  applyPreload();
}

// The title card is painted once, from the show, and then left alone: it is the
// screen the room looks at longest and the one nothing must ever flicker on.
// Called again when the show is rebuilt, because the roster - and so the row of
// flags - can change under an open stage.
function paintTitleCard() {
  const card = document.querySelector('#idle .card');
  if (!card) return;
  card.querySelector('.words').textContent = TITLE_LINE;
  card.querySelector('.year').textContent = TITLE_YEAR;
  card.querySelector('.waiting').textContent = WAITING_LINE;
  const flags = flagRow(show);
  card.querySelector('.flags').replaceChildren(...flags.map((f) => {
    const img = document.createElement('img');
    img.alt = '';
    img.src = `/${f.src}`;
    // A flag that will not load leaves a gap, never a broken-image glyph on a
    // television: the row is decoration and the title card has to stand without it.
    img.onerror = () => img.remove();
    return img;
  }));
}

function renderIdle() {
  stopPhotos();
  clearSlideTimer();
  stopFilms();
  applyTitle(null);
  document.body.classList.remove('list');
  document.body.classList.add('idle');
  layers.a.classList.remove('live');
  layers.b.classList.remove('live');
}

// A screen set to `list`: the draw so far, as text. An empty draw says so rather
// than going black, for the same reason the holding screen exists.
function renderList(plan) {
  stopPhotos();
  clearSlideTimer();
  stopFilms();
  applyTitle(null);
  document.body.classList.remove('idle');
  document.body.classList.add('list');
  layers.a.classList.remove('live');
  layers.b.classList.remove('live');
  drawRows.dataset.columns = String(plan.columns);
  if (plan.rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nothing drawn yet.';
    drawRows.replaceChildren(p);
    return;
  }
  let day = null;
  const out = [];
  for (const row of plan.rows) {
    if (row.day !== day) {
      day = row.day;
      const h = document.createElement('h3');
      h.textContent = `Day ${day}`;
      out.push(h);
    }
    const line = document.createElement('div');
    line.className = 'row';
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = row.label;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${row.intl || '—'}  v  ${row.usa || '—'}`;
    line.append(n, who);
    out.push(line);
  }
  drawRows.replaceChildren(...out);
}

// --- player films ------------------------------------------------------------
// A screen set to `films` plays every long-form film back to back and starts
// again at the top. It is driven by the films' own `ended` events, NOT by state
// frames: the show carries on behind this screen, and a reveal arriving in the
// middle of a film must not restart it.

function loadFilm(el, src) {
  if (el.dataset.rel === src) return;    // already the one we want: leave it decoded
  el.dataset.rel = src;
  el.src = `/${src}`;
  el.load();
}

// Step over a film that will not play. Through a timer, not a call: if several
// in a row are broken this paces itself instead of recursing down the whole
// list, and one bad file costs a beat rather than the evening.
function skipFilm() {
  if (filmSkip) return;
  filmSkip = setTimeout(() => {
    filmSkip = null;
    if (!document.body.classList.contains('films')) return;
    try { playFilm(filmIndex + 1); } catch (e) { report(e); }
  }, 400);
}

// Put film `i` on the screen, in whichever element is not already showing - the
// one that has been quietly loading it since the last change - and set the one
// after it loading in the element that just came off.
function playFilm(i) {
  const n = filmSrcs.length;
  if (n === 0) { renderIdle(); return; }
  filmIndex = ((i % n) + n) % n;
  const which = filmShowing === 0 ? 1 : 0;
  const el = filmEls[which];
  const off = filmShowing === -1 ? null : filmEls[filmShowing];
  loadFilm(el, filmSrcs[filmIndex]);
  el.loop = n === 1;         // one film and nothing to cut to: let it run round
  el.classList.add('live');
  if (off && off !== el) {
    off.classList.remove('live');
    off.pause();
    try { off.currentTime = 0; } catch { /* not loaded */ }
  }
  filmShowing = which;
  // The one after it starts loading now, in the element that just came off, so
  // the cut at the end of this film is instant rather than a black gap while
  // 13MB arrives. Before the play attempt, because that attempt may not happen.
  if (n > 1) loadFilm(filmEls[which === 0 ? 1 : 0], filmSrcs[(filmIndex + 1) % n]);
  if (el.error) { skipFilm(); return; }
  if (!primed) return;       // the cover has not been tapped yet; render() starts it then
  const p = el.play();
  if (p && p.catch) p.catch(() => { if (el.error) skipFilm(); });
}

function renderFilms(plan) {
  clearSlideTimer();
  stopPhotos();
  applyTitle(null);
  document.body.classList.remove('idle');
  document.body.classList.remove('list');
  layers.a.classList.remove('live');
  layers.b.classList.remove('live');
  const srcs = plan.films.map((f) => f.src);
  // No films at all: the title card, for the same reason the holding screen exists.
  if (srcs.length === 0) { renderIdle(); return; }
  document.body.classList.add('films');
  // Jump to a film…: a cue is carried out once and its number remembered, so the
  // next forty state frames do not each restart the same film. A fresh page has
  // seen nothing, so a screen reloaded mid-evening starts at the film the
  // operator last asked for rather than back at the top of the loop.
  const cue = plan.cue && plan.cue.seq > filmCueSeen ? plan.cue : null;
  if (cue) filmCueSeen = cue.seq;
  if (srcs.join('|') !== filmSrcs.join('|')) {
    filmSrcs = srcs;
    filmShowing = -1;
    for (const el of filmEls) { el.classList.remove('live'); delete el.dataset.rel; el.removeAttribute('src'); }
    // Not film 0: where THIS screen starts, so a second television is not
    // playing the same film at the same moment. Read once, here, at the start
    // of the loop - never on a later frame, or opening a screen in the bar
    // would make the main screen jump.
    playFilm(cue ? cue.index : startOffset(wire, MY_SCREEN, srcs.length));
    return;
  }
  // The operator asked for this one now: start it, even if it is the film
  // already on screen - "jump to Rizzo" half way through Rizzo means from the
  // top. From here the loop carries on from the new position on its own.
  if (cue) { playFilm(cue.index); return; }
  // Already running, so the film itself is left alone - touching it here is what
  // would restart it mid-flight. The classes are not: leaving the films and
  // coming back goes through stopFilms(), which takes `live` off both elements,
  // and a resume that only called play() would run the film behind a black
  // screen. Say which element is on screen every time, like every other render.
  const el = filmShowing === -1 ? null : filmEls[filmShowing];
  if (!el) { playFilm(filmIndex); return; }
  el.classList.add('live');
  for (const other of filmEls) if (other !== el) other.classList.remove('live');
  if (primed && el.paused) {
    const p = el.play();
    if (p && p.catch) p.catch(() => { if (el.error) skipFilm(); });
  }
}

// Off the films: pause what is playing, but keep the sources. Coming back to
// them should pick up where it was, not re-fetch 13MB over the venue wifi.
function stopFilms() {
  if (filmSkip) { clearTimeout(filmSkip); filmSkip = null; }
  if (!document.body.classList.contains('films') && filmShowing === -1) return;
  document.body.classList.remove('films');
  for (const el of filmEls) {
    el.classList.remove('live');
    if (!el.paused) el.pause();
  }
}

for (const el of filmEls) {
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.controls = false;
  el.addEventListener('ended', () => {
    if (!document.body.classList.contains('films') || filmEls[filmShowing] !== el) return;
    if (filmSkip) { clearTimeout(filmSkip); filmSkip = null; }
    try { playFilm(filmIndex + 1); } catch (e) { report(e); }
  });
  // A film that will not load: step over it. An element that is only preloading
  // is left alone - the loop reaches it in its own time, and skips it then.
  el.addEventListener('error', () => {
    if (!document.body.classList.contains('films')) return;
    if (!el.getAttribute('src') || filmEls[filmShowing] !== el) return;
    report(`film will not play: ${el.dataset.rel}`);
    skipFilm();
  });
}

// --- photographs of years gone by --------------------------------------------
// A screen set to `photos` shows the tournaments gone by, one picture at a time
// and then round again. Driven by its OWN clock, not by state frames, for the
// same reason the films are driven by their own `ended` events: the draw
// carries on behind this screen, and a reveal arriving half way through a
// photograph must not jump it.

const PHOTO_DWELL_MS = 7000;
// Must match the `transition` on #photos .shot in stage.css. The outgoing frame
// is still on screen for this long after it loses `live`.
const PHOTO_FADE_MS = 900;

function clearPhotoTimer() {
  if (photoTimer) { clearTimeout(photoTimer); photoTimer = null; }
}

// The picture goes in twice: once as a background, blown up and blurred to fill
// a 16:9 television behind a photograph taken upright, and once whole in front.
// Both come off the same file, so the second costs no fetch.
function loadPhoto(shot, photo) {
  const img = shot.querySelector('img');
  if (img.dataset.rel === photo.src) return;   // already the one we want: leave it decoded
  img.dataset.rel = photo.src;
  img.src = `/${photo.src}`;
  shot.querySelector('.back').style.backgroundImage = `url("/${encodeURI(photo.src)}")`;
  shot.querySelector('.year').textContent = photo.year || '';
}

// Step over a picture that will not load. Through a timer, not a call, so a run
// of broken files paces itself instead of recursing through the whole album.
function skipPhoto() {
  if (photoSkip) return;
  photoSkip = setTimeout(() => {
    photoSkip = null;
    if (!document.body.classList.contains('photos')) return;
    try { showPhoto(photoIndex + 1); } catch (e) { report(e); }
  }, 400);
}

// Put photograph `i` on the screen, in whichever frame is not already showing -
// the one that has been quietly decoding it since the last change - and set the
// one after it loading in the frame that just came off.
function showPhoto(i) {
  const n = photoSrcs.length;
  if (n === 0) return;
  photoIndex = ((i % n) + n) % n;
  const which = photoShowing === 0 ? 1 : 0;
  const shot = photoEls[which];
  const off = photoShowing === -1 ? null : photoEls[photoShowing];
  loadPhoto(shot, photoSrcs[photoIndex]);
  // Taking `live` off and putting it back is what restarts the slow drift: the
  // animation hangs off `.shot.live img`, so it begins again each time a frame
  // comes round rather than carrying on from where it left off.
  shot.classList.add('live');
  if (off && off !== shot) off.classList.remove('live');
  photoShowing = which;
  // Get the one after this decoded in advance - but NOT yet. The only frame
  // free to load into is the one that just lost `live`, and it is still on the
  // screen, at nearly full opacity, for the whole 900ms cross-fade. Loading
  // into it now swaps the outgoing picture for a completely different one
  // mid-fade: the viewer sees the photograph after next flash past for under a
  // second, then the real next one. Wait for the fade to finish; that still
  // leaves six seconds of the dwell to decode in.
  if (photoPreload) { clearTimeout(photoPreload); photoPreload = null; }
  if (n > 1) {
    const spare = photoEls[which === 0 ? 1 : 0];
    const next = photoSrcs[(photoIndex + 1) % n];
    photoPreload = setTimeout(() => {
      photoPreload = null;
      // Gone off the photographs, or moved on again, while we waited.
      if (!document.body.classList.contains('photos')) return;
      if (photoEls[photoShowing] === spare) return;
      loadPhoto(spare, next);
    }, PHOTO_FADE_MS + 100);
  }
  clearPhotoTimer();
  photoTimer = setTimeout(() => {
    photoTimer = null;
    try { showPhoto(photoIndex + 1); } catch (e) { report(e); }
  }, PHOTO_DWELL_MS);
}

// Nobody has put any photographs on the laptop. Say so: a black television
// looks broken, and an operator who pressed Photos deserves to know why
// nothing happened. Same reason the holding screen exists.
function renderNoPhotos() {
  clearPhotoTimer();
  if (photoPreload) { clearTimeout(photoPreload); photoPreload = null; }
  photoShowing = -1;
  photoKey = '';
  photoSrcs = [];
  for (const shot of photoEls) shot.classList.remove('live');
  if (!photoNone) {
    photoNone = document.createElement('div');
    photoNone.className = 'none';
    photoNone.textContent = 'No photographs loaded';
  }
  if (!photoNone.isConnected) photoBox.append(photoNone);
  document.body.classList.add('photos');
}

function renderPhotos(plan) {
  clearSlideTimer();
  stopFilms();
  applyTitle(null);
  document.body.classList.remove('idle');
  document.body.classList.remove('list');
  layers.a.classList.remove('live');
  layers.b.classList.remove('live');
  const list = Array.isArray(plan && plan.photos) ? plan.photos : [];
  if (list.length === 0) { renderNoPhotos(); return; }
  if (photoNone && photoNone.isConnected) photoNone.remove();
  document.body.classList.add('photos');
  const key = list.map((p) => p.src).join('|');
  if (key !== photoKey) {
    photoKey = key;
    photoSrcs = list;
    photoShowing = -1;
    for (const shot of photoEls) {
      shot.classList.remove('live');
      const img = shot.querySelector('img');
      delete img.dataset.rel;
      img.removeAttribute('src');
    }
    showPhoto(startOffset(wire, MY_SCREEN, list.length));
    return;
  }
  // Already running, so the clock is left alone - restarting it here is what
  // would cut a photograph short on every state frame. The classes are not:
  // leaving the photographs and coming back goes through stopPhotos(), which
  // takes `live` off both frames, so say which one is on screen every time.
  if (photoShowing === -1 || !photoTimer) { showPhoto(photoIndex); return; }
  const shot = photoEls[photoShowing];
  shot.classList.add('live');
  for (const other of photoEls) if (other !== shot) other.classList.remove('live');
}

// Off the photographs: stop the clock, but keep the sources decoded. Coming
// back should pick up where it was rather than starting the album again.
function stopPhotos() {
  if (photoSkip) { clearTimeout(photoSkip); photoSkip = null; }
  if (photoPreload) { clearTimeout(photoPreload); photoPreload = null; }
  clearPhotoTimer();
  if (!document.body.classList.contains('photos') && photoShowing === -1) return;
  document.body.classList.remove('photos');
  for (const shot of photoEls) shot.classList.remove('live');
}

for (const shot of photoEls) {
  const img = shot.querySelector('img');
  img.addEventListener('error', () => {
    if (!document.body.classList.contains('photos')) return;
    if (!img.getAttribute('src') || photoEls[photoShowing] !== shot) return;
    report(`photograph will not load: ${img.dataset.rel}`);
    skipPhoto();
  });
}

function renderSlideshow() {
  clearSlideTimer();
  stopFilms();
  stopPhotos();
  document.body.classList.remove('list');
  slideEntry = slideshowEntry({ completed: wire.completed, slideshow: { position: slidePosition } });
  if (!slideEntry) { renderIdle(); return; }
  const back = other(live);
  const slidePlan = panelsForMatch(slideEntry, show);
  applyPlan(layers[back], slidePlan, { force: true });
  applyTitle(slidePlan.match);
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
  const { screen, plan } = screenPlan(wire, show, MY_SCREEN);
  if (screen === 'list') {
    renderList(plan);
  } else if (screen === 'films') {
    renderFilms(plan);
  } else if (screen === 'photos') {
    renderPhotos(plan);
  } else if (screen === 'slideshow') {
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

// --- full screen -----------------------------------------------------------
// A browser window that merely fills the television still has a menu bar and a
// tab strip on it, and both end up on the wall. This is the real thing, the
// Fullscreen API, which browsers only grant inside a user gesture - so it hangs
// off the one click the operator already makes, and off a button and the f key
// for every time after that.
//
// Every call here is allowed to fail silently. A refused full screen must never
// stop the show from starting.
const fsBtn = document.getElementById('fs');
const fsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

function goFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  try {
    const r = req.call(el);
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (e) { /* refused, and that is survivable */ }
}

function leaveFullscreen() {
  const ex = document.exitFullscreen || document.webkitExitFullscreen;
  if (!ex) return;
  try {
    const r = ex.call(document);
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (e) { /* already out */ }
}

const toggleFullscreen = () => (fsOn() ? leaveFullscreen() : goFullscreen());

// Escape and the browser's own controls leave full screen without telling us,
// so the button reads the browser rather than remembering what it last did.
function markFullscreen() {
  const on = fsOn();
  document.body.classList.toggle('fs', on);
  fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  fsBtn.setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen');
  fsBtn.title = on ? 'Leave full screen (f)' : 'Full screen (f)';
}
document.addEventListener('fullscreenchange', markFullscreen);
document.addEventListener('webkitfullscreenchange', markFullscreen);
markFullscreen();

fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'f' && e.key !== 'F') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;   // leave the browser's own shortcuts alone
  e.preventDefault();
  toggleFullscreen();
});

// Reveal the button only while a pointer is actually moving, and take the
// cursor away again when it stops.
let pointerIdle = null;
function pointerMoved() {
  document.body.classList.add('pointing');
  clearTimeout(pointerIdle);
  pointerIdle = setTimeout(() => document.body.classList.remove('pointing'), 2500);
}
document.addEventListener('mousemove', pointerMoved);
document.addEventListener('touchstart', pointerMoved, { passive: true });

// One click at setup, then never again. The click is also the user activation that
// lets play() run; anything revealed before it is started here, not lost. It is
// the same gesture that grants full screen, so the one tap does both.
cover.addEventListener('click', () => {
  primed = true;
  cover.classList.add('gone');
  document.body.classList.add('started');
  try { render(wire); } catch (e) { report(e); }
  goFullscreen();
});

// The show was rebuilt and the hub restarted: fetch it again rather than play
// yesterday's films. One fetch at a time, and a failure is simply retried on the
// next frame - the screen keeps playing whatever it has meanwhile.
let refetching = false;
function noticeShowRebuilt(frame) {
  if (!show || !frame || typeof frame.built !== 'string' || frame.built === '') return;
  if (frame.built === show.built || refetching) return;
  refetching = true;
  fetch('/api/show', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((fresh) => {
      if (!fresh || !Array.isArray(fresh.players)) return;
      show = fresh;
      paintTitleCard();
      render(null);          // null: treat it as a fresh render, not a diff
    })
    .catch(() => { /* the next frame tries again */ })
    .finally(() => { refetching = false; });
}

async function loadShow() {
  for (;;) {
    try {
      const res = await fetch('/api/show', { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch { /* hub not up yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// The stream going quiet is not something a television can be left to sort out
// on its own. EventSource does reconnect by itself - the hub even asks for 2s -
// but a browser throttles a tab it thinks nobody is looking at, and a stage left
// on overnight, or one whose hub was restarted, can sit on the old frame for a
// long time. Measured: a stage missed two hub restarts in a row, over a minute,
// while the console beside it recovered both times because it polls.
//
// So: when the stream errors, poll until frames come back. /api/state carries
// exactly what a frame does, `built` included, so a rebuilt show is noticed here
// too. A healthy stream costs nothing - the timer only exists after an error.
let pollTimer = null;
function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}
function pollState() {
  stopPolling();
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.ok) {
        const frame = await res.json();
        if (frame && typeof frame === 'object') {
          const prev = wire;
          wire = frame;
          noticeShowRebuilt(wire);
          render(prev);
        }
      }
    } catch { /* still down */ }
    pollState();                      // keep going; a live frame stops it
  }, 3000);
}

async function boot() {
  show = await loadShow();
  paintTitleCard();
  // The hub sends a full snapshot on every (re)connect, and EventSource reconnects by itself.
  // The name goes with the connection so the hub can list this screen.
  const events = new EventSource(`/events?screen=${encodeURIComponent(MY_SCREEN)}`);
  events.addEventListener('state', (e) => {
    stopPolling();                    // the stream is alive again
    try {
      const prev = wire;
      wire = JSON.parse(e.data);
      noticeShowRebuilt(wire);
      render(prev);
    } catch (err) { report(err); }   // a bad frame must never blank the screen
  });
  events.addEventListener('error', () => { if (!pollTimer) pollState(); });
  // A screen that was hidden and comes back may have missed everything.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !pollTimer) pollState();
  });
}

boot().catch(report);

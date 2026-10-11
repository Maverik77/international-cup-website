# Pairings Party Interface — Design

**Date:** 2026-10-09
**Status:** Approved. Revised 2026-10-11: online-first sync, iPad remote.
**Owner:** Erik Wagner (@Maverik77)
**Event:** 22 October 2026, 19:00, Spanky's Shenanigans, 538 E Market St, Leesburg VA

## 1. Overview

A local-first application that drives the big screen at the pairings party while captains
announce the Day 1 team pairings and the Day 2 singles. Each player is represented by a
short video card. As a pairing is announced the operator stages it and reveals it; when
the opponents are announced they join on screen. Once everything is announced the screen
rotates through all matches on repeat for the rest of the night.

The guiding constraint is that **this runs once, in public, in a pub**. Every design choice
below favours "cannot fail" over "elegant". Videos and show state are on local disk, the
server has zero dependencies, and the network is never in the path of a reveal. Losing
connectivity costs the tablet remote and live syncing, never the show itself.

## 2. Scope

**In scope**

- A new `party/` application: hub server, operator console, stage view.
- Reveal flow for Day 1 team matches (2 v 2) and Day 2 singles (1 v 1).
- Per-match choice of which side is revealed first.
- Auto-rotating slideshow of all completed matches.
- A build step producing a local `show.json` plus the full set of player video cards.
- Generic flag cards generated for every player without a photo, so no slot is ever empty.
- Rehearsal mode.
- Remote control from a tablet or phone on the same network, and support for multiple stage screens.
- Online-first sync of announced pairings back to the existing AWS tables, with a durable
  offline queue (§4.4).

**Out of scope**

- Scores, live results, brackets, standings.
- Changes to the existing `pairings/admin.html`, `pairings/display.html`, the WebSocket API,
  or any Lambda. The party app *calls* `updatePairings`; it does not modify it.
- Frame-accurate synchronisation between independent machines (see §8).

## 3. Relationship to the existing pairings system

The repository already contains a pairings reveal system: `pairings/admin.html`,
`pairings/display.html`, a WebSocket API, and the `icup-pairings` / `icup-reveal-state`
DynamoDB tables. That system stays exactly as it is.

The party app keeps its own copy of the show on local disk, but it does not keep it to
itself. Pairings flow **in** at build time and **out** continuously as they are announced,
so the two systems converge rather than drift. The mechanism is in §4.4.

**The laptop is authoritative for the duration of the event.** Leave `pairings/admin.html`
alone from the moment the show starts. Both write the same table and the later write wins,
silently.

## 4. Architecture

### 4.1 Hub

A single Node process on the playback laptop. Started with one command, no build step.

Responsibilities:

- Serve the static pages and the video files.
- Hold the authoritative show state in memory.
- Persist that state to `party/state.json` after every change.
- Accept commands over HTTP POST.
- Broadcast state to every connected surface over Server-Sent Events.

**Zero runtime dependencies.** Node's built-in `http` module covers both static serving and
SSE. No WebSocket library, therefore no `npm install` that can fail on the afternoon of the
event. Commands travel as ordinary POSTs; state travels as SSE, which browsers reconnect
automatically.

Latency is 1–2 ms on localhost and single-digit milliseconds across a LAN, which is well
inside what the operator flow needs (§5.1 removes latency from the critical path anyway).

### 4.2 Surfaces

All three are views of the same state; none hold state of their own.

| Surface | URL | Runs on |
| --- | --- | --- |
| Operator console | `/operator` | The iPad, and the laptop screen as a permanent standby |
| Stage | `/stage` | The TV, driven over HDMI from the laptop |
| Additional stages | `/stage` | Any other machine on the network (prefer an HDMI splitter, §8) |

The stage has no controls, no cursor and no chrome. It renders state and preloads what is
queued next.

### 4.3 Networking

The hub does not care which network it is on. It binds to all interfaces and advertises
itself over Bonjour, so the operator console sits at the same address however the devices
happen to be connected.

**Expected setup.** The laptop stands by the TV, drives it over HDMI and runs `/stage`
full screen. The iPad runs `/operator` and travels with whoever is working the console.
Both sit on the venue wifi, which also gives the hub internet for live syncing (§4.4).

Fallbacks, in order, if the venue network will not carry it:

1. **Phone hotspot.** Laptop and iPad both join it. Keeps device-to-device *and* internet.
2. **Laptop-hosted network.** The iPad joins the laptop directly. No internet, so sync
   queues until later; nothing else changes.
3. **Laptop alone.** Open `/operator` on the laptop and work from there. No network at all.

**The laptop is always its own console.** Each fallback is a step down, not a recovery
procedure. If the iPad drops, dies or wanders out of range, walk to the laptop and carry
on from the same slot.

**Finding the console.** The laptop shows a QR code at startup encoding the operator URL.
Point the iPad camera at it rather than typing an address.

**Multiple screens.** HDMI from the laptop drives one TV perfectly. For more TVs in one
room use an HDMI splitter rather than a second machine (§8).

### 4.3.1 Pre-flight: the one failure worth rehearsing

Many guest networks enable client isolation, which blocks device-to-device traffic. Both
devices then show full bars and working internet and still cannot see each other. It looks
nothing like a network fault.

**Confirm the iPad can load `/operator` over the venue wifi before the night, not at
19:00.** If it cannot, move to the phone hotspot. Switching costs nothing, because the
Bonjour address does not change.

### 4.4 Sync: online first, offline safe

Announced pairings belong in the AWS tables so the website stays right. They must never be
able to delay a reveal.

- Every state change writes `party/state.json` and marks the outbox dirty. Local,
  synchronous, immediate; the UI never waits.
- A background worker pushes to AWS whenever it can, with backoff. It is fully decoupled
  from the reveal path. Nothing it does can block, stall or surface an error into the UI.
- **Connectivity is never probed before acting.** The hub does not try the network and fall
  back, because detecting failure costs a timeout and a timeout is a stalled screen in
  front of a full room. It acts locally and syncs behind your back.

**Push a snapshot, not a delta log.** Each flush sends the complete set of pairings rather
than a stream of changes. Retries cannot duplicate, out-of-order delivery cannot corrupt,
and a reopened match (§5.7) simply overwrites. At 39 matches this is a few kilobytes.

**No backend work is required.** The existing `updatePairings` Lambda already accepts
`{pairings: [...]}` and batch-writes them as `PutRequest`, overwriting by key. That is
idempotent by construction, which is exactly what a retrying flusher needs. The hub needs
`ADMIN_PASSWORD` in its environment and nothing more.

**Status is visible, not intrusive.** The operator console carries a small indicator:
synced / *n* pending / offline. The stage never shows it.

**Reads are deliberate.** Pairings come down from AWS at build time, and otherwise only
when the operator presses refresh. Nothing pulls from the network automatically mid-show.

## 5. Show model

### 5.1 Staging versus revealing

The operator console has two panes: **on screen** and **up next**. The next pairing is
filled in while the room is still looking at the current one, so by the time *reveal* is
pressed the stage has already fetched and decoded those clips.

This is the single most important design decision in the document. It converts "the
interface must be fast" from a performance problem into a user-interface one.

### 5.2 State shape

```
{
  day:    1 | 2,
  mode:   'idle' | 'live' | 'slideshow',
  slot: {
    index:     <number>,
    firstSide: 'intl' | 'usa',
    intl:      [playerId, playerId?],   // 2 on Day 1, 1 on Day 2
    usa:       [playerId, playerId?],
    shown:     'none' | 'first' | 'both'
  },
  next:      { intl: [...], usa: [...] },   // preloaded by the stage, not displayed
  completed: [ { index, intl: [...], usa: [...] } ],
  slideshow: { position: <number>, dwellSeconds: 12 },
  sync:      { dirty: <bool>, lastPushed: <iso8601|null>, lastError: <string|null> }
}
```

`sync` drives the console indicator only. It is never read by the stage, and no part of
the reveal flow waits on it.

### 5.3 Day 1 team match, four players

1. The International pair is pre-filled from the running order. Operator presses **reveal**.
2. `shown` becomes `first`. Stage plays two 4:9 cards in the left half. The right half is dark.
3. The captain announces the opponents. Operator picks two USA players.
4. Operator presses **reveal**. `shown` becomes `both`. The two USA cards enter on the right.
   Four narrow cards across the full width.
5. Operator presses **next**. The match is appended to `completed` and the following pair
   pre-fills.

### 5.4 Day 2 singles, two players

The same rhythm with one player per side and 8:9 cards, two across.

### 5.5 Reveal order

`firstSide` is set per match and toggled on the console. **Team positions are fixed
regardless: International occupies the left half, USA the right.** Revealing USA first
fills the right half and leaves the left waiting. Anchoring the sides means the audience
always knows which half is which.

### 5.6 Playback behaviour

Cards **play once and hold on the final frame.** Every card ends with the name, hometown
and school block up, so the held frame is itself the information panel. The screen stays
still while a captain talks, nothing loops distractingly, and no separate static card
design is needed.

When the second side is revealed, its cards play while the already-revealed side stays
held.

### 5.7 Overrides

- Pre-filled pairs are suggestions, not commitments. Any player can be swapped.
- The operator can jump to any slot, in any order.
- A completed match can be reopened and redone.
- Undo reverses the last action.

These exist because International pairings are usually known in advance, USA opponents are
drawn live, singles are entirely live, and any of it can change on the night.

### 5.8 Slideshow

Pressing **slideshow** cycles every completed match: all cards play together, then hold,
then cross-fade to the next after `dwellSeconds` (default 12). It loops indefinitely and
the operator can return to live at any time.

Thirteen team matches plus twenty-six singles is roughly a nine-minute loop.

## 6. Assets

### 6.1 What gets built

For each of the 52 players: one 4:9 card (480x1080) and one 8:9 card (960x1080). 104 clips,
roughly 1 GB, all stored locally.

The 16:9 long-form cards are a separate artefact and are not used by this application.

### 6.2 Generic cards

Any player without a usable photo receives a generated card: their flag filling the panel
with the name and hometown over it. **Generated for every such player up front, so no slot
can ever be empty.** When a real photo arrives later, that player is rebuilt and the file
replaced; nothing else changes because the manifest refers to filenames.

### 6.3 Manifest

`party/show.json` contains the player list (id, name, team, country, hometown, school, card
filenames) and the pre-loaded running order. Produced by the build step from
`data/players.json` plus any known pairings.

### 6.4 Build-time validation

The build fails loudly if any referenced card is missing, zero-length or unreadable. The
time to discover a broken file is during the build, not at 19:00.

## 7. Failure modes

| Failure | Behaviour |
| --- | --- |
| Video missing or corrupt | Stage falls back to that player's generic card. Also caught at build time. |
| Hub crashes, laptop sleeps | State is on disk after every change. Restart resumes at the same slot. |
| A stage screen disconnects | SSE reconnects by itself and re-syncs from current state. |
| Venue wifi fails | Show unaffected; videos and state are local. The iPad remote is lost, so work from the laptop (§4.3). Sync queues and flushes when connectivity returns. |
| Devices on the network cannot see each other | Client isolation. Switch to the phone hotspot; the Bonjour address is unchanged so nothing needs reconfiguring. Catch it at pre-flight (§4.3.1). |
| AWS unreachable, or sync fails | Invisible to the room. The outbox grows and flushes later. The console shows a pending count. |
| iPad sleeps or Safari suspends the page | It reconnects and re-pulls the full state rather than assuming it missed nothing. Set Auto-Lock to Never beforehand (§7.2). |
| Operator picks the wrong player | Re-pick before revealing, or undo afterwards. |
| Captain announces out of order | Operator jumps to any slot. |

### 7.1 Rehearsal mode

Runs the entire show against the real manifest and the real video files, so the whole
sequence can be sat through in advance. Finding problems in a kitchen is cheaper than
finding them in a pub.

### 7.2 Device settings to change before the night

Easier than engineering around, and each one has bitten a live show somewhere:

- **iPad: Auto-Lock to Never.** The browser wake-lock API needs a secure context and the
  LAN is plain HTTP, so this cannot be done in code.
- **Laptop: sleep disabled**, including on AC power.
- **Laptop: Do Not Disturb on.** A notification banner landing on the TV mid-reveal is the
  cheapest avoidable embarrassment of the night.

## 8. Known limitation: multi-screen synchronisation

Independent machines told to play at the same instant will be tens to a couple of hundred
milliseconds apart. This is invisible when screens are in different rooms and noticeable
when two TVs sit side by side in one sightline.

**For mirrored screens in one room, use an HDMI splitter**: one machine, one output,
several TVs, perfectly in sync, no software involved. Use the software multi-screen path
when screens are in different rooms or should show different content.

## 9. Open questions

1. ~~Where do the videos live when a second machine is driving its own TV?~~ Resolved:
   the laptop drives the TV over HDMI, so there is no second machine.
2. Should the slideshow interleave Day 1 and Day 2 matches or run them in blocks? Currently
   specified as in order, Day 1 then Day 2.
3. Should the waiting half of the screen stay dark, or show the opposing team's crest or
   the match number? Currently dark, to keep attention on what has been revealed.

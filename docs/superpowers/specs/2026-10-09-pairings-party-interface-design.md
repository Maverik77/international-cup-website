# Pairings Party Interface — Design

**Date:** 2026-10-09
**Status:** Draft (awaiting user review)
**Owner:** Erik Wagner (@Maverik77)
**Event:** 22 October 2026, 19:00, Spanky's Shenanigans, 538 E Market St, Leesburg VA

## 1. Overview

A local-first application that drives the big screen at the pairings party while captains
announce the Day 1 team pairings and the Day 2 singles. Each player is represented by a
short video card. As a pairing is announced the operator stages it and reveals it; when
the opponents are announced they join on screen. Once everything is announced the screen
rotates through all matches on repeat for the rest of the night.

The guiding constraint is that **this runs once, in public, in a pub**. Every design choice
below favours "cannot fail" over "elegant". Videos are on local disk, the server has zero
dependencies, and losing the venue wifi costs the phone remote and nothing else.

## 2. Scope

**In scope**

- A new `party/` application: hub server, operator console, stage view.
- Reveal flow for Day 1 team matches (2 v 2) and Day 2 singles (1 v 1).
- Per-match choice of which side is revealed first.
- Auto-rotating slideshow of all completed matches.
- A build step producing a local `show.json` plus the full set of player video cards.
- Generic flag cards generated for every player without a photo, so no slot is ever empty.
- Rehearsal mode.
- Support for multiple stage screens and for remote control from a phone on the same network.

**Out of scope**

- Scores, live results, brackets, standings.
- Any write-back to DynamoDB or the public website during the party.
- Changes to the existing `pairings/admin.html`, `pairings/display.html`, the WebSocket API,
  or any Lambda. Those continue to serve the website and are untouched.
- Frame-accurate synchronisation between independent machines (see §8).

## 3. Relationship to the existing pairings system

The repository already contains a pairings reveal system: `pairings/admin.html`,
`pairings/display.html`, a WebSocket API, and the `icup-pairings` / `icup-reveal-state`
DynamoDB tables. That system stays exactly as it is.

The party app is deliberately separate and offline. The only connection is one-directional
and happens **before** the event: the build step may export known pairings from DynamoDB
into the local `show.json`.

**Accepted cost:** two systems will know about pairings, and they can drift. This is a
conscious trade. Putting a pub's wifi in the path of a live reveal is the larger risk.

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
| Operator console | `/operator` | Laptop screen, or a phone/tablet on the same network |
| Stage | `/stage` | The TV |
| Additional stages | `/stage` | Any other machine on the network |

The stage has no controls, no cursor and no chrome. It renders state and preloads what is
queued next.

### 4.3 Networking modes

- **Local only.** Everything on one laptop. Open `/operator` on the laptop screen and
  `/stage` on the TV output. Needs no network at all.
- **LAN remote.** The laptop serves `/operator` to any device on the same wifi, so a phone
  becomes the remote. Works on venue wifi or on the laptop's own hotspot. No internet.
- **Multiple screens.** Any number of machines open `/stage`. See §8 for the sync caveat.

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
  slideshow: { position: <number>, dwellSeconds: 12 }
}
```

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
| Venue wifi fails | Laptop and its own screen are unaffected. Only the phone remote and any second machine are lost. |
| Operator picks the wrong player | Re-pick before revealing, or undo afterwards. |
| Captain announces out of order | Operator jumps to any slot. |

### 7.1 Rehearsal mode

Runs the entire show against the real manifest and the real video files, so the whole
sequence can be sat through in advance. Finding problems in a kitchen is cheaper than
finding them in a pub.

## 8. Known limitation: multi-screen synchronisation

Independent machines told to play at the same instant will be tens to a couple of hundred
milliseconds apart. This is invisible when screens are in different rooms and noticeable
when two TVs sit side by side in one sightline.

**For mirrored screens in one room, use an HDMI splitter**: one machine, one output,
several TVs, perfectly in sync, no software involved. Use the software multi-screen path
when screens are in different rooms or should show different content.

## 9. Open questions

1. Where do the videos live when a second machine is driving its own TV: a local copy on
   each machine, or pulled from the hub and cached? Moot if an HDMI splitter is used.
2. Should the slideshow interleave Day 1 and Day 2 matches or run them in blocks? Currently
   specified as in order, Day 1 then Day 2.
3. Should the waiting half of the screen stay dark, or show the opposing team's crest or
   the match number? Currently dark, to keep attention on what has been revealed.

# Pairings party app

Drives the big screen at the pairings party.
**22 October 2026, 19:00, Spanky's Shenanigans, 538 E Market St, Leesburg VA.**
Design: `docs/superpowers/specs/2026-10-09-pairings-party-interface-design.md`.

Everything below runs from the repo folder, in a terminal on the laptop.

## On the night

### Before you leave the house

1. iPad: Auto-Lock set to **Never**.
2. Laptop: sleep turned off, **including on AC power**.
3. Laptop: **Do Not Disturb on**, so no banner lands on the TV mid-reveal.
4. Laptop and iPad both charged, chargers in the bag.

### At the venue

1. Join the laptop and the iPad to the same wifi.
2. Laptop to the TV with HDMI.
3. In the terminal: `npm run party:start`
4. The terminal prints a QR code and a **Password** line. That line is where
   you read the password. It is also saved in `party/operator-password.txt`.
5. On the laptop, open the **Stage** address from the terminal, full screen.
   It shows **Tap to start**: click once on the page. The cards are silent; that
   click is what lets the browser play video at all, so nothing shows until you
   do it.
6. On the iPad, point the camera at the QR code and open the link.
7. The iPad asks for the password. Type it **once**, from the terminal. The
   iPad remembers it, and it survives a restart of the hub.
8. The console shows which match you are on. You are ready.

The laptop is always its own console. If the iPad dies, open the **Operator**
address in the laptop's browser, enter the password, and carry on from the same
match.

### When the night is over

Press **Ctrl-C** in the terminal, once. It may sit there for a few seconds: it
is pushing the last pairing to the website, and it says so. That is not a hang —
do not press Ctrl-C again. It then prints whether the push got through; if it
did not, the show is saved on the laptop and the next `npm run party:start`
finishes sending it.

### More than one screen

Every screen shows the same thing unless you say otherwise. To add a second one,
open the stage address on that device with a name on the end:

    http://<the stage address>/stage?screen=bar

It appears in **Screens…** on the console as soon as it is opened. From there each
screen can be set to:

| | |
| --- | --- |
| **Mirror the show** | The default. Exactly what the main screen shows. |
| **Slideshow** | Cycles the matches already revealed, whatever the main screen is doing. |
| **Player films** | The thirty-second film of every player, one after another and then round again. |
| **Photos of years gone by** | Photographs from the tournaments of 2021 to 2025, one after another. |
| **Draw so far** | The whole draw to date, as text, for people reading rather than watching. |
| **Title card** | The gold title, and nothing else. |

**Player films** is the one for before the pairings are announced: put the main
screen on it while people arrive, and put it back on **Mirror the show** when
you are ready to start. It runs for about twenty minutes and then begins
again, it has no sound, and it is not part of the show — the draw behind it is
exactly where you left it, and a screen still on the films misses nothing but
the pictures. Going back to the films later picks up where it left off rather
than starting over. One player has given no hometown, so there is no film
flying into his town and he is not in the loop.

**Photos** is the other one for the hour before the pairings, and it is on the
console's own row of buttons as well as in **Screens…** — tap **Photos** and
every mirroring screen goes to the photographs; tap **Back to live** and they
return to the draw, exactly where it was. Each picture holds for seven seconds,
the years are mixed rather than played album by album, and the year is in the
corner because that is the thing the room always asks. A portrait photograph
taken on a phone is shown whole, with a blurred blow-up of itself filling the
sides instead of black bars.

Nothing is loaded to begin with. To put the photographs on the laptop, export
the albums from Google Photos, unzip them anywhere, and run:

    node party/build/build-photos.mjs <the folder you unzipped into>
    npm run party:build

The first command converts and shrinks everything (it handles HEIC straight off
an iPhone) into `party/photos/`; the second is what puts them in the show. Run
them again after adding more — anything already done is skipped, so it takes
seconds. A photograph deleted from the source folder leaves the show and the
disk on the next run, which is how somebody is taken out if they ask. Until
any of that happens, a screen set to Photos says *No photographs loaded* rather
than going black. The photographs never leave the laptop: `party/photos/` is
gitignored and is not one of the folders the website deploy copies.

**Jump to a film…**, under each screen's buttons, starts that screen at one
particular player — somebody has just walked in, or asked. Type a few letters
of the name, tap it, and that screen cuts to their film and carries on down the
list from there. It works whatever the screen was doing: picking a film is also
how a screen is put on the films, so it is one tap, not two. Tapping the film
already playing starts it again from the top. The dialog remembers what you
last asked for under the buttons; where the loop has got to since is on the
television, not in the console.

**Put every screen back on the show** does what it says, in one tap — that is the
button to reach for before the finale. The console's own button reads
**Screens… (1 off the show)** whenever a screen has wandered, so you can see it
without opening the dialog.

Each screen still needs its own **Tap to start** click, and screens are never
frame-aligned: a reveal can land a fraction of a second apart on two devices.
Screen settings are not part of the saved show, so restarting the hub brings
every screen back to mirroring.

If the second TV is fed by an HDMI splitter from the laptop, none of this applies
— that is one screen, already in step.

### The stage is open to everyone on the wifi

The password protects the **console** only. The stage page is open on purpose
(the TVs need it), so anyone on the venue wifi who types its address can see it,
and can see the next match ahead of the reveal. Do not read the address out.

### If something goes wrong

| What you see | What to do |
| --- | --- |
| The hub stopped, the laptop slept, the terminal died | Run `npm run party:start` again. It carries on from the same match, and the iPad reconnects by itself. Do not reload the iPad unless it is still stuck after a minute. |
| The console says the show **started over from Day 1, match 1** | The saved show was unusable, so the hub began fresh. Tap **Jump to…** and pick the match you were on. Pick the first match not yet revealed. |
| The iPad says the password is wrong | Read the **Password** line in the terminal again and retype it, with the hyphens and no spaces. Still wrong: press Ctrl-C in the terminal, delete `party/operator-password.txt`, run `npm run party:start`, and use the new password it prints. |
| The iPad says **Too many wrong tries** | After 10 wrong tries that one device waits **60 seconds**. Wait a minute, then try again. You do not need to restart anything. |
| A card will not play | It falls back to that player's flag card by itself. Carry on. |
| A stage screen went black | It reconnects by itself. If not, reload the page — the reload brings **Tap to start** back, so click the page once more or it stays blank. |
| The iPad cannot reach the console at all | The venue wifi is blocking devices from each other. Put the laptop and the iPad both on the phone hotspot and restart with `npm run party:start`. |
| The sync light says **Offline** | Ignore it. The show runs from the laptop. It catches up when the network returns. |
| Wrong player revealed | Tap **Undo**, or pick the right player and reveal again. |
| A player you want is not in the list | They are already drawn into another match on this day, so the list hides them. Tap **Show N already picked** at the top to see everyone, with a note saying which match each one is in. |
| **Refresh from AWS** pulled in a draw you did not want | Tap **Undo**: it puts the slots back **and** clears those pairings on the website. Then pick the players yourself and reveal as normal. |
| A match announced out of order | **Jump to…** and pick it. It lists **both days**, with whoever is already drawn under each match, and opens where you are. |

If the venue network will not carry it, the order of fallbacks is: phone
hotspot, then a network hosted by the laptop, then the laptop alone. The
`.local` address in the terminal does not change between them.

## Before the night

### Rehearse

    npm run party:rehearse -- --pace 3     # about 12 minutes

Plays all 39 matches (13 team matches on Day 1, 26 singles on Day 2) against the
real cards, into `party/state.rehearsal.json`, with the network switched off. It
cannot touch `party/state.json` and cannot reach the website. The console's Refresh button is still there, and says it is off. Every run starts
again from match 1.

1. It prints the same QR code, addresses and password lines as the night. Open it, click once, and press Enter in the terminal.
2. Watch it run. Use `--pace 11` to sit through it at about real speed (about 43 minutes). Add `--go` to start at once without waiting for Enter.
3. Ctrl-C when you have seen enough.

It uses the same password as the night, from `party/operator-password.txt`, so
you can open its Operator address on the iPad and practise on the same gate.

### Build, once and whenever a photo arrives

    npm run party:flags     # once: downloads the 11 flag images
    npm run party:build     # show.json and a card for all 52 players

`party:build` only makes what is missing. To give someone a bespoke card, add
their nickname to `party/build/card-keys.json`, drop `<nickname>-4x9.mp4` and
`<nickname>-8x9.mp4` into `party/cards/`, and rebuild.

### Where the moving photos come from

The bespoke cards do not hold a still: the player's photo moves. Each one is a
Veo clip generated from their photograph, then cropped into the card. The raw
clips and the exact stills that produced them live in `party/veo/`, named
`<nickname>-veo.mp4` and `<nickname>-source.jpg`, so a card can be rebuilt or
re-cut without paying to generate the clip again. That directory is gitignored,
like `party/cards/`.

To make a new one, use the `veo-video` skill:

    python3 ~/.claude/skills/veo-video/veo_generate.py \
      --image party/veo/<nickname>-source.jpg \
      --out   party/veo/<nickname>-veo.mp4 --aspect 9:16

The skill documents the Gemini API call, the intermittent audio filter (retry;
filtered attempts are not charged) and the cost per clip.

The 16:9 long-form videos are a different thing again: a zoom from the globe to
the player's hometown, built from satellite imagery with vector overlays and
composited text. That is not Veo and not made here.

### The day before, in the venue

    npm run party:preflight

One line per check, `[ok]` or `[!!]`, and a last line that says READY or NOT
READY. It writes nothing and is safe to run at any time. It checks the build and
cards, the operator password file (present, never shown), the console pages, a
LAN address for the iPad, and that the website can be reached **and already
knows all 52 players**. If that last one fails, the website's roster does not
match this show, whatever is in it, and pairings would show blank names. The
first line says which website was checked (`--target staging` checks the other
one). Replace the roster, well before the night:

    npm run party:push-roster -- --target prod             # dry run: reads, prints the diff, writes nothing
    npm run party:push-roster -- --target prod --confirm   # asks you to type a phrase first

That replaces the whole roster (anyone not on this year's list is deleted), so
read the diff first. Without `--target` it points at staging.

Start options for the night: `npm run party:start` syncs to the live website;
add `-- --target staging` to sync to staging, or `-- --no-sync` to stop it
writing to the website at all. **Refresh from AWS** still reads from the website
under `--no-sync` — it is the one thing that does — so you can pull a draw that
was entered on the site without pushing anything back. Only a rehearsal refuses
to read as well.

### Nothing here is deployed, and it must stay that way

`party/show.json` carries hometowns and schools for players who asked not to
appear on the website. It is gitignored, along with `party/state*.json`,
`party/operator-password.txt` and `party/cards/`. The repo is public. Do not add
`party/` to `.github/workflows/deploy.yml`, and do not run `npm run deploy:manual`.

## Known limitations

Decided deliberately, not overlooked. Each was weighed and left as it is.

- **A reopened match stays fully revealed.** Jump to… a finished match and
  Reveal reads "Both revealed", because reopening does not reset it. Resetting
  it would blank the TV for someone who jumped back merely to look. To replay
  the two-step reveal, re-pick a player — that works and the clip plays again.
- **Undo after Refresh clears those pairings on the website too.** Consistent
  with every other Undo pushing what it reverted, but it touches public data.
- **The slideshow position lives in each stage**, so two screens both set to
  Slideshow cycle independently and drift apart. Intentional: they are separate
  screens for separate parts of the room, and nothing reads worse than two
  screens showing the same slideshow a beat apart.
- **Screens are never frame-aligned.** Each device decodes its own clips, so the
  same reveal can land a fraction of a second apart. Sync puts screens back on
  the same *content*, not on the same *frame*; frame-accurate sync over venue
  wifi is not something that can be promised.
- **Ctrl-C can take about three seconds**, because it is pushing the last
  pairing. It says so while it waits. It never hangs; a dead network is capped.
- **`stop()` flushes whether or not anything is outstanding**, so each shutdown
  pushes the same snapshot once more and bumps the revision. Harmless: the push
  is an idempotent whole-snapshot overwrite.
- **Nothing tests `stage.js`, `operator.js` or the stylesheets directly.** There
  is no DOM harness, by design — the decisions live in `public/panels.mjs` and
  `public/console.mjs`, which are tested hard, and the hub's own endpoints are
  tested over HTTP. What that leaves unpinned is the drawing: the match number's
  size and travel, the glyphs on the panel seams, and the two dialogs. Those were
  checked by eye in a browser. If a DOM harness ever arrives, pin them first.
- **The SIGINT wiring has no test seam**, so the shutdown *wording* is tested as
  a pure function while the handler that calls it is not.

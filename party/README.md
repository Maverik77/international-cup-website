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
| A match announced out of order | **Jump to…** and pick it. |

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

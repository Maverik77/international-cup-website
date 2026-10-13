// Maps show state onto the item shape of the live AWS pairings table.
// The shape is dictated by that table (and pairings/display.html), not chosen
// here. Items carry player ids, numbers and fixed enums only.
//
// DELIBERATE DEVIATION FROM THE ORIGINAL BRIEF - DO NOT "FIX" BACK.
// The endpoint is unauthenticated and display.html writes every player's name
// into the page for every pairing (revealStep only toggles a CSS class), so any
// id we publish is readable by anyone before it is announced in the room.
// Therefore ids for a side are withheld ('' placeholder, keys kept) until that
// side has actually been revealed:
//   none  -> both sides blank
//   first -> only the side named by firstSide is populated
//   both  -> both populated
// The table mirrors the room exactly.

const REVEAL_STEP = { none: 0, first: 1, both: 2 };
const SIDES = ['intl', 'usa'];

// Unrecognised values fall back in the safe direction: hide, never publish.
const stepOf = (shown) => (Object.hasOwn(REVEAL_STEP, shown) ? REVEAL_STEP[shown] : 0);
const firstOf = (side) => (SIDES.includes(side) ? side : 'intl');

function revealedSides(step, first) {
  if (step === 2) return { intl: true, usa: true };
  if (step === 1) return { intl: first === 'intl', usa: first === 'usa' };
  return { intl: false, usa: false };
}

export function toPairingItems(state) {
  const items = [];

  for (const slot of state.slots['1']) {
    const step = stepOf(slot.shown);
    const first = firstOf(slot.firstSide);
    const open = revealedSides(step, first);
    const id = (side, n) => (open[side] ? slot[side]?.[n] || '' : '');
    items.push({
      id: `day1-team-${slot.index}`,
      type: 'team',
      day: 1,
      match_number: slot.index,
      intl_team: { player1_id: id('intl', 0), player2_id: id('intl', 1) },
      usa_team: { player1_id: id('usa', 0), player2_id: id('usa', 1) },
      revealOrder: `${first}-first`,
      revealStep: step,
    });
  }

  for (const slot of state.slots['2']) {
    const step = stepOf(slot.shown);
    const first = firstOf(slot.firstSide);
    const open = revealedSides(step, first);
    const id = (side) => (open[side] ? slot[side]?.[0] || '' : '');
    items.push({
      id: `day2-singles-${slot.index}`,
      type: 'singles',
      day: 2,
      match_number: slot.index,
      intl_player_id: id('intl'),
      usa_player_id: id('usa'),
      revealOrder: `${first}-first`,
      revealStep: step,
    });
  }

  return items;
}

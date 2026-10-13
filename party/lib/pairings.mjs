// Maps show state onto the item shape of the live AWS pairings table.
// The shape is dictated by that table (and pairings/display.html), not chosen
// here. Items carry player ids, numbers and fixed enums only.

const REVEAL_STEP = { none: 0, first: 1, both: 2 };

export function toPairingItems(state) {
  const items = [];

  for (const slot of state.slots['1']) {
    items.push({
      id: `day1-team-${slot.index}`,
      type: 'team',
      day: 1,
      match_number: slot.index,
      intl_team: { player1_id: slot.intl[0] || '', player2_id: slot.intl[1] || '' },
      usa_team: { player1_id: slot.usa[0] || '', player2_id: slot.usa[1] || '' },
      revealOrder: `${slot.firstSide}-first`,
      revealStep: REVEAL_STEP[slot.shown],
    });
  }

  for (const slot of state.slots['2']) {
    items.push({
      id: `day2-singles-${slot.index}`,
      type: 'singles',
      day: 2,
      match_number: slot.index,
      intl_player_id: slot.intl[0] || '',
      usa_player_id: slot.usa[0] || '',
      revealOrder: `${slot.firstSide}-first`,
      revealStep: REVEAL_STEP[slot.shown],
    });
  }

  return items;
}

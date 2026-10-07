// Keep server indexes alongside presentation order: sorting must never change the card played.
export function orderedHand(hand, order = 'suit', trump = '') {
  const entries = hand.map((card, index) => ({ card, index }));
  if (order === 'deal') return entries;
  const rank = (card) =>
    ({ J: 11, Q: 12, K: 13, A: 14, 0: 10 })[card.val] || Number(card.val) || 99;
  const suit = (card) =>
    card.joker ? 6 : card.suit === trump ? 5 : Math.max(0, ['C', 'D', 'H', 'S'].indexOf(card.suit));
  return entries.sort((a, b) =>
    order === 'rank'
      ? rank(a.card) - rank(b.card) || suit(a.card) - suit(b.card) || a.index - b.index
      : suit(a.card) - suit(b.card) || rank(a.card) - rank(b.card) || a.index - b.index
  );
}

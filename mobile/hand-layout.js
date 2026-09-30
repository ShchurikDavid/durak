// Keep a visible, tappable edge on every card; large hands use additional rows.
function handLayout(count, available, maxHeight = Infinity) {
  const width = Math.max(1, available);
  for (let cardWidth = Math.min(96, width); cardWidth >= 1; cardWidth -= 1) {
    const edge = Number.isFinite(maxHeight) ? Math.max(12, cardWidth * 0.25) : 24;
    const capacity = Math.max(1, Math.floor((width - cardWidth) / edge) + 1);
    const rowCount = Math.ceil(count / capacity);
    const cardHeight = cardWidth * 1.44;
    const lift = Math.min(5, (cardWidth / 96) * 5);
    const rowGap = Number.isFinite(maxHeight) ? Math.min(8, maxHeight * 0.04) : 8;
    const height = rowCount * (cardHeight + lift) + Math.max(0, rowCount - 1) * rowGap;
    if (height > maxHeight && cardWidth > 1) continue;
    const rows = [];
    for (let start = 0; start < count; start += capacity) {
      const size = Math.min(capacity, count - start);
      const step = size < 2 ? 0 : Math.min(cardWidth + 8, (width - cardWidth) / (size - 1));
      rows.push({ start, size, step, width: cardWidth + step * (size - 1) });
    }
    return { cardWidth, cardHeight, height, lift, rowGap, rows };
  }
  return { cardWidth: 1, cardHeight: 1.44, height: 0, lift: 0, rowGap: 0, rows: [] };
}
module.exports = { handLayout };

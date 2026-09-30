function tableLayout(count, width, height) {
  const columns = Math.min(3, Math.max(1, count));
  const rows = Math.max(1, Math.ceil(count / columns));
  const cellWidth = Math.max(1, width / columns);
  const cellHeight = Math.max(1, height / rows);
  const cardWidth = Math.max(1, Math.min(88, (cellWidth - 8) / 1.35, (cellHeight - 8) / 1.75));
  return { columns, rows, cellWidth, cellHeight, cardWidth };
}
module.exports = { tableLayout };

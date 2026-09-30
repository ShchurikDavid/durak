const test = require('node:test');
const assert = require('node:assert/strict');
const { handLayout } = require('../mobile/hand-layout');
const { tableLayout } = require('../mobile/table-layout');
const { createLocalGame } = require('../mobile/local-game');

test('all hands fit narrow phones and landscape without horizontal scrolling or hidden cards', () => {
  for (const width of [160, 240, 292, 332, 384, 720]) {
    for (let count = 0; count <= 54; count++) {
      const layout = handLayout(count, width);
      const indexes = [];
      for (const row of layout.rows) {
        assert.ok(row.width <= width + 0.001);
        if (row.size > 1) assert.ok(row.step >= 24);
        for (let i = 0; i < row.size; i++) indexes.push(row.start + i);
      }
      assert.deepEqual(
        indexes,
        Array.from({ length: count }, (_, i) => i)
      );
    }
  }
});

test('large hands and six attack/defense pairs fit the height available on short screens', () => {
  for (const width of [160, 228, 292, 384, 720]) {
    for (const height of [48, 72, 100, 150, 176]) {
      for (let count = 1; count <= 54; count++) {
        const layout = handLayout(count, width, height);
        assert.ok(layout.height <= height + 0.001, `${count} cards, ${width}×${height}`);
        assert.equal(
          layout.rows.reduce((n, row) => n + row.size, 0),
          count
        );
        assert.ok(layout.rows.every((row) => row.width <= width + 0.001));
      }
    }
    for (const height of [60, 90, 140, 230]) {
      for (let count = 1; count <= 6; count++) {
        const layout = tableLayout(count, width, height);
        assert.ok(layout.cardWidth * 1.35 <= layout.cellWidth);
        assert.ok(layout.cardWidth * 1.75 <= layout.cellHeight);
        assert.ok(layout.cellHeight * layout.rows <= height + 0.001);
      }
    }
  }
});

test('offline settings rename the seated player without restarting and expose audio actions', () => {
  let state;
  const game = createLocalGame({
    onState: (value) => {
      state = value;
    }
  });
  try {
    assert.equal(state.lastAction, 'start');
    const cards = state.myHand.map((card) => card.code);
    game.rename('Новое имя');
    assert.equal(state.players[0].name, 'Новое имя');
    assert.deepEqual(
      state.myHand.map((card) => card.code),
      cards
    );
    assert.equal(state.lastAction, null);
  } finally {
    game.dispose();
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalGame } = require('../mobile/local-game');

test('native offline games use legal moves, conserve cards and finish without a server', () => {
  for (const mode of ['24', '36', '52', '54']) {
    for (const maxPlayers of [2, 3, 4]) {
      for (const gameType of ['throwIn', 'transfer']) {
        let seed = 19387;
        let nextId = 0;
        let state;
        const timers = new Map();
        const game = createLocalGame({
          mode,
          maxPlayers,
          gameType,
          name: 'Человек',
          random: () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
          },
          setTimeout: (fn, delay) => {
            const id = ++nextId;
            timers.set(id, { fn, delay });
            return id;
          },
          clearTimeout: (id) => timers.delete(id),
          onState: (value) => {
            state = value;
          }
        });
        try {
          assert.equal(state.local, true);
          assert.equal(state.players[0].name, 'Человек');
          const original = state.myHand.map((card) => card.code);
          game.send('playCard', 999);
          assert.deepEqual(
            state.myHand.map((card) => card.code),
            original
          );
          let turns = 0;
          while (state.status !== 'finished' && turns++ < 20000) {
            const count =
              state.players.reduce((total, p) => total + p.cardCount, 0) +
              state.deckCount +
              state.discardCount +
              state.table.reduce((total, pair) => total + 1 + !!pair.defend, 0);
            assert.equal(count, Number(mode));
            if (
              state.canPass &&
              (state.myHand.length > 0 || state.deckCount > 0) &&
              !state.surrendered
            ) {
              const round = state.roundNumber;
              const discard = state.discardCount;
              assert.equal(state.turnDeadline, null, 'Manual bito must not expire');
              const bot = [...timers].find(([, timer]) => timer.delay < 1000);
              if (bot) {
                timers.delete(bot[0]);
                bot[1].fn();
              }
              assert.equal(state.roundNumber, round, 'Bots must wait for the human to say bito');
              assert.equal(
                state.discardCount,
                discard,
                'Bots must leave defended cards on the table'
              );
            }
            if (state.playableCardIndexes.length)
              game.send('playCard', state.playableCardIndexes[0]);
            else if (state.canTransfer) game.send('transferCard', state.transferCardIndexes[0]);
            else if (state.canTake) game.send('take');
            else if (state.canPass) game.send('bito');
            else {
              const job = [...timers].find(([, timer]) => timer.delay < 1000) || [...timers][0];
              assert.ok(job, `No legal action or bot timer: ${mode}/${maxPlayers}/${gameType}`);
              timers.delete(job[0]);
              const originalNow = Date.now;
              try {
                if (job[1].delay >= 1000)
                  Date.now = () => (state.turnDeadline || originalNow()) + 40;
                job[1].fn();
              } finally {
                Date.now = originalNow;
              }
            }
          }
          assert.equal(state.status, 'finished', `${mode}/${maxPlayers}/${gameType}`);
          game.send('restartGame');
          assert.equal(state.status, 'playing');
          assert.equal(state.myHand.length, 6);
        } finally {
          game.dispose();
        }
        assert.equal(timers.size, 0);
      }
    }
  }
});

test('offline timeout votes receive bot votes and dispose cancels every timer', () => {
  let state;
  let id = 0;
  const timers = new Map();
  const game = createLocalGame({
    maxPlayers: 3,
    onState: (value) => {
      state = value;
    },
    setTimeout: (fn, delay) => {
      timers.set(++id, { fn, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id)
  });
  game.send('voteTimeout');
  let job = [...timers].find(([, t]) => t.delay < 1000);
  timers.delete(job[0]);
  job[1].fn();
  assert.equal(state.status, 'timeout');
  game.send('voteResume');
  job = [...timers].find(([, t]) => t.delay < 1000);
  timers.delete(job[0]);
  job[1].fn();
  assert.equal(state.status, 'playing');
  game.dispose();
  assert.equal(timers.size, 0);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApplication } = require('../src/app');
const { matchRecord, addMatch } = require('../src/game/match-history');
const { createLocalGame } = require('../mobile/local-game');

test('match records distinguish losses, surrender, draws and wins without duplicates', () => {
  const state = {
    matchId: 'one',
    status: 'finished',
    myIndex: 0,
    loserIndex: 0,
    finishedAt: 123,
    local: true,
    players: [
      { index: 0, name: 'Я' },
      { index: 1, name: 'Мира', isBot: true }
    ]
  };
  const record = matchRecord(state);
  assert.equal(record.result, 'loss');
  assert.equal(record.opponents, 'Мира (бот)');
  assert.equal(record.date, 123);
  assert.equal(addMatch([record], record).length, 1);
  assert.equal(matchRecord({ ...state, loserIndex: 1 }).result, 'win');
  assert.equal(matchRecord({ ...state, loserIndex: null }).result, 'draw');
  state.players[0].surrendered = true;
  assert.equal(matchRecord({ ...state, loserIndex: null }).result, 'loss');
  state.players[0].surrendered = false;
  assert.equal(matchRecord({ ...state, status: 'playing' }), null);
});

test('bots receive distinct names and each rematch has a new identifier', () => {
  const game = createLocalGame({
    maxPlayers: 4,
    name: 'Мира',
    random: () => 0,
    setTimeout: () => 0,
    clearTimeout() {}
  });
  try {
    const state = game.snapshot();
    assert.equal(new Set(state.players.map((p) => p.name)).size, 4);
    assert.equal(state.players.filter((p) => p.isBot).length, 3);
    const another = createLocalGame({ setTimeout: () => 0, clearTimeout() {} });
    assert.notEqual(another.snapshot().matchId, state.matchId);
    another.dispose();
  } finally {
    game.dispose();
  }
});

test('account history is private, persists results and rejects another account ownership', async (t) => {
  const app = createApplication({ databasePath: ':memory:' });
  t.after(() => app.close());
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}/api/auth/`;
  const request = (route, cookie, body) =>
    fetch(base + route, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  async function register(email) {
    const response = await request('register', '', {
      email,
      name: 'Игрок',
      password: 'password123'
    });
    return {
      cookie: response.headers.get('set-cookie').split(';')[0],
      user: (await response.json()).user
    };
  }
  const a = await register('one@example.com');
  const b = await register('two@example.com');
  assert.equal((await request('history')).status, 401);
  const record = {
    id: 'offline:0',
    date: Date.now(),
    result: 'loss',
    mode: 'С ботами',
    rules: '36 · Подкидной',
    opponents: 'Лев (бот)'
  };
  assert.equal((await request('history', '', { record })).status, 401);
  assert.equal((await request('history', b.cookie, { userId: a.user.id, record })).status, 400);
  for (let i = 0; i < 2; i++)
    assert.equal((await request('history', a.cookie, { userId: a.user.id, record })).status, 200);
  const read = async (cookie) => (await (await request('history', cookie)).json()).history;
  assert.equal((await read(a.cookie)).length, 1);
  assert.equal((await read(b.cookie)).length, 0);
  assert.equal(
    (
      await request('history', a.cookie, {
        userId: a.user.id,
        record: { ...record, mode: 'Онлайн' }
      })
    ).status,
    400
  );
  const room = app.service.createRoom();
  room.players = [a, b].map((account, i) => ({
    userId: `account:${account.user.id}`,
    socketId: `socket-${i}`,
    name: `Игрок ${i}`,
    hand: []
  }));
  app.service.engine.startGame(room);
  // An offline upload must not reserve the ID of an authoritative online result.
  const collision = { ...record, id: `${room.game.matchId}:0`, result: 'win' };
  assert.equal(
    (await request('history', a.cookie, { userId: a.user.id, record: collision })).status,
    200
  );
  app.service.engine.finishGame(room, 0, 'Поражение');
  app.service.sendGameState(room);
  app.service.sendGameState(room);
  assert.equal((await read(a.cookie)).length, 3);
  assert.equal((await read(a.cookie)).find((item) => item.mode === 'Онлайн').result, 'loss');
  assert.equal((await read(b.cookie))[0].result, 'win');
  await request('logout', a.cookie, {});
  assert.equal((await request('history', a.cookie)).status, 401);
});

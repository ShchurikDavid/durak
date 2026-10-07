const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApplication } = require('../src/app');
test('friend requests protect identity, require recipient consent, and allow removal', async () => {
  const app = createApplication({ databasePath: ':memory:' });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}/api/auth/`;
  const request = (route, cookie = '', body, headers = {}) =>
    fetch(base + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', cookie, ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
  async function register(name) {
    const res = await request('register', '', {
      name,
      email: name + '@example.com',
      password: 'test-password-123'
    });
    assert.equal(res.status, 201);
    return { cookie: res.headers.get('set-cookie').split(';')[0], id: (await res.json()).user.id };
  }
  try {
    const a = await register('Alice'),
      b = await register('Bob'),
      c = await register('Carol');
    assert.equal((await request('friends')).status, 401);
    assert.equal(
      (await request('friends', a.cookie, { action: 'request', code: a.id })).status,
      400
    );
    assert.equal(
      (
        await request(
          'friends',
          a.cookie,
          { action: 'request', code: b.id },
          { origin: 'https://evil.example' }
        )
      ).status,
      403
    );
    assert.equal(
      (await request('friends', a.cookie, { action: 'request', code: b.id })).status,
      200
    );
    assert.equal(
      (await request('friends', a.cookie, { action: 'request', code: b.id })).status,
      409
    );
    assert.equal(
      (await request('friends', a.cookie, { action: 'accept', code: b.id })).status,
      404
    );
    assert.equal(
      (await request('friends', c.cookie, { action: 'accept', code: a.id })).status,
      404
    );
    let list = await (await request('friends', b.cookie)).json();
    assert.equal(list.friends[0].incoming, true);
    assert.equal(list.friends[0].status, 'pending');
    assert.equal(JSON.stringify(list).includes('@example.com'), false);
    assert.equal(
      (await request('friends', b.cookie, { action: 'accept', code: a.id })).status,
      200
    );
    list = await (await request('friends', a.cookie)).json();
    assert.equal(list.friends[0].status, 'accepted');
    await request('friends', c.cookie, { action: 'remove', code: a.id });
    assert.equal((await (await request('friends', a.cookie)).json()).friends.length, 1);
    await request('friends', b.cookie, { action: 'remove', code: a.id });
    assert.equal((await (await request('friends', a.cookie)).json()).friends.length, 0);
    const room = app.service.createRoom({ name: '  Вечерний стол\u0000  ', mode: '36' });
    assert.equal(room.name, 'Вечерний стол');
    assert.equal(app.service.createRoom({ name: { toString: null } }).name, '');
    assert.equal(app.service.createRoom({ name: 'a'.repeat(100) }).name.length, 40);
  } finally {
    await app.close();
  }
});
test('hand order groups suits, puts trump last, preserves source indexes and original array', async () => {
  const { orderedHand } = await import('../public/js/hand-order.js');
  const hand = [
    { code: 'AH', suit: 'H', val: 'A' },
    { code: '6S', suit: 'S', val: '6' },
    { code: '7H', suit: 'H', val: '7' },
    { code: 'KC', suit: 'C', val: 'K' },
    { code: 'RJ', joker: true, val: 'JOKER' }
  ];
  const before = JSON.stringify(hand);
  const sorted = orderedHand(hand, 'suit', 'H');
  assert.deepEqual(
    sorted.map((x) => x.index),
    [3, 1, 2, 0, 4]
  );
  for (const entry of sorted) assert.equal(hand[entry.index], entry.card);
  assert.equal(JSON.stringify(hand), before);
  assert.deepEqual(
    orderedHand(hand, 'deal').map((x) => x.index),
    [0, 1, 2, 3, 4]
  );
  assert.deepEqual(
    orderedHand(hand, 'rank').map((x) => x.index),
    [1, 2, 3, 0, 4]
  );
});

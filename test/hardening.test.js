const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { scrypt } = require('node:crypto');
const { promisify } = require('node:util');
const { createApplication } = require('../src/app');
const { normalizeMode, normalizePlayerCount, normalizeRoomCode } = require('../src/game/rules');

test('untrusted JSON objects cannot trigger coercion exceptions in room options', () => {
  for (const value of [{ toString: 1 }, { valueOf: null, toString: null }, [], null, true]) {
    assert.equal(normalizeMode(value), '36');
    assert.equal(normalizePlayerCount(value), 2);
    assert.equal(normalizeRoomCode(value), '');
  }
});

test('password work has a global concurrency cap and releases its slot', async (t) => {
  let release, entered;
  const pending = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const app = createApplication({
    databasePath: ':memory:',
    passwordConcurrency: 1,
    derivePassword: async (...args) => {
      entered();
      await gate;
      return promisify(scrypt)(...args);
    }
  });
  t.after(() => app.close());
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const url = `http://127.0.0.1:${app.server.address().port}/api/auth/login`;
  const request = () =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'absent@example.com', password: 'test-password' })
    });
  const first = request();
  await pending;
  try {
    const blocked = await request();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '5');
  } finally {
    release();
  }
  assert.equal((await first).status, 401);
  assert.equal((await request()).status, 401);
});

test('malformed JSON and oversized bodies never disclose server stack traces', async (t) => {
  const app = createApplication({ databasePath: ':memory:' });
  t.after(() => app.close());
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  for (const [body, status] of [
    ['{', 400],
    [JSON.stringify({ x: 'a'.repeat(20000) }), 413]
  ]) {
    const response = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    assert.equal(response.status, status);
    const data = await response.json();
    assert.deepEqual(Object.keys(data), ['error']);
    assert.doesNotMatch(data.error, /at |SyntaxError|node_modules/);
  }
  const page = await fetch(base);
  assert.match(page.headers.get('content-security-policy'), /object-src 'none'/);
  const motion = await fetch(base + '/vendor/motion.js');
  assert.equal(motion.status, 200);
  assert.match(motion.headers.get('content-type'), /javascript/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApplication } = require('../src/app');

test('server files and secrets are inaccessible over HTTP and malformed origins are denied', async (t) => {
  const app = createApplication({ databasePath: ':memory:' });
  t.after(() => app.close());
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  for (const route of [
    '/.env',
    '/.git/config',
    '/data/durak.sqlite',
    '/data/durak.sqlite-wal',
    '/src/auth.js',
    '/deploy/durak.env.example',
    '/server.js',
    '/package.json',
    '/private.key',
    '/%2eenv'
  ]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 404, route);
  }
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(home.headers.get('x-powered-by'), null);
  const response = await fetch(base + '/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'null' },
    body: '{}'
  });
  assert.equal(response.status, 403);
});

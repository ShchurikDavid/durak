const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApplication } = require('../src/app');

test('Ubuntu proxy mode uses forwarded client IP and secure cookies only when enabled', async () => {
  for (const trustProxy of [false, true]) {
    const app = createApplication({ databasePath: ':memory:', trustProxy });
    app.app.get('/proxy-test', (req, res) => res.json({ ip: req.ip, secure: req.secure }));
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    const base = `http://127.0.0.1:${app.server.address().port}`;
    try {
      const headers = { 'X-Forwarded-For': '203.0.113.10', 'X-Forwarded-Proto': 'https' };
      const response = await fetch(base + '/proxy-test', { headers });
      assert.deepEqual(await response.json(), {
        ip: trustProxy ? '203.0.113.10' : '127.0.0.1',
        secure: trustProxy
      });
      const session = await fetch(base + '/api/auth/me', { headers });
      if (trustProxy) assert.match(session.headers.get('set-cookie'), /; Secure/);
    } finally {
      await app.close();
    }
  }
});

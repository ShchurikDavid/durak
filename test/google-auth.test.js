const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApplication } = require('../src/app');

async function setup(t, options = {}) {
  const application = createApplication({
    databasePath: ':memory:',
    googleClientId: '',
    ...options
  });
  t.after(() => application.close());
  application.server.listen(0, '127.0.0.1');
  await once(application.server, 'listening');
  const base = `http://127.0.0.1:${application.server.address().port}/api/auth/`;
  return (route, body, cookie) =>
    fetch(base + route, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
}
const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];

test('Google is unavailable without configuration and rejects unsigned credentials', async (t) => {
  const request = await setup(t);
  assert.deepEqual(await (await request('google/config')).json(), { enabled: false });
  assert.equal((await request('google', { credential: 'fake' })).status, 503);
  const enabled = await setup(t, { googleClientId: 'test.apps.googleusercontent.com' });
  const cookie = cookieOf(await enabled('me'));
  await enabled('google/config', undefined, cookie);
  assert.equal((await enabled('google', { credential: 'not-a-signed-token' }, cookie)).status, 401);
});

test('Google creates and reuses an account, binds nonce to session and prevents replay', async (t) => {
  let profile;
  const request = await setup(t, {
    googleClientId: 'test.apps.googleusercontent.com',
    verifyGoogleToken: async () => profile
  });
  const cookie = cookieOf(await request('me'));
  const config = await (await request('google/config', undefined, cookie)).json();
  profile = {
    sub: 'google-subject',
    email_verified: true,
    name: 'Google Игрок',
    nonce: config.nonce
  };
  const otherCookie = cookieOf(await request('me'));
  await request('google/config', undefined, otherCookie);
  assert.equal(
    (await request('google', { credential: 'verified-test-token' }, otherCookie)).status,
    401
  );
  const login = await request('google', { credential: 'verified-test-token' }, cookie);
  assert.equal(login.status, 200);
  const user = (await login.json()).user;
  const accountCookie = cookieOf(login);
  assert.equal(user.name, 'Google Игрок');
  assert.equal(
    (await request('google', { credential: 'verified-test-token' }, cookie)).status,
    401
  );
  await request('name', { name: 'Мой ник' }, accountCookie);
  const guestCookie = cookieOf(await request('logout', {}, accountCookie));
  const nextConfig = await (await request('google/config', undefined, guestCookie)).json();
  profile.nonce = nextConfig.nonce;
  const returning = await request('google', { credential: 'verified-test-token' }, guestCookie);
  assert.equal(returning.status, 200);
  assert.deepEqual((await returning.json()).user, { ...user, name: 'Мой ник' });
  const invalidCookie = cookieOf(await request('me'));
  profile.nonce = (await (await request('google/config', undefined, invalidCookie)).json()).nonce;
  profile.email_verified = false;
  assert.equal(
    (await request('google', { credential: 'verified-test-token' }, invalidCookie)).status,
    401
  );
});

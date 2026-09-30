const test = require('node:test');
const assert = require('node:assert/strict');
const { once, EventEmitter } = require('node:events');
const WebSocket = require('ws');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createApplication } = require('../src/app');

test('accounts, cookie sessions, nickname updates, logout and persistence', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'durak-auth-'));
  const databasePath = path.join(folder, 'test.sqlite');
  let application;
  let base;
  async function start() {
    application = createApplication({ databasePath });
    application.server.listen(0, '127.0.0.1');
    await once(application.server, 'listening');
    base = `http://127.0.0.1:${application.server.address().port}`;
  }
  async function request(route, body, cookie, extra = {}) {
    return fetch(base + '/api/auth/' + route, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...extra
      },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];
  async function connect(cookie) {
    const events = new EventEmitter();
    const ws = new WebSocket(
      base.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket',
      { headers: { cookie } }
    );
    const next = (event) =>
      once(events, event, { signal: AbortSignal.timeout(5000) }).then(([data]) => data);
    const ready = next('ready');
    ws.on('message', (buffer) => {
      const data = buffer.toString();
      if (data.startsWith('0')) ws.send('40');
      else if (data === '2') ws.send('3');
      else if (data.startsWith('40')) events.emit('ready');
      else if (data.startsWith('42')) {
        const [event, payload] = JSON.parse(data.slice(2));
        events.emit(event, payload);
      }
    });
    await ready;
    return {
      next,
      send: (event, payload) => ws.send('42' + JSON.stringify([event, payload])),
      close: () => ws.close()
    };
  }
  try {
    await start();
    const guest = await request('me');
    assert.deepEqual(await guest.json(), { user: null, name: null });
    const guestCookie = cookieOf(guest);
    assert.match(guest.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    assert.equal((await request('name', { name: 'Без сессии' })).status, 401);
    assert.equal((await request('name', { name: '   ' }, guestCookie)).status, 400);
    assert.equal((await request('name', { name: 'x'.repeat(21) }, guestCookie)).status, 400);
    assert.equal(
      (await request('name', { name: 'Гость' }, guestCookie, { Origin: 'https://evil.example' }))
        .status,
      403
    );
    assert.equal((await request('name', { name: 'Новый гость' }, guestCookie)).status, 200);
    assert.equal((await (await request('me', undefined, guestCookie)).json()).name, 'Новый гость');
    const credentials = {
      email: 'Player_1@example.com',
      password: 'correct-password',
      name: 'Давид'
    };
    assert.equal(
      (await request('register', { ...credentials, email: 'not-an-email' }, guestCookie)).status,
      400
    );
    assert.equal(
      (await request('register', { ...credentials, name: ' ' }, guestCookie)).status,
      400
    );
    assert.equal(
      (await request('register', credentials, guestCookie, { Origin: 'https://evil.example' }))
        .status,
      403
    );
    const registered = await request('register', credentials, guestCookie);
    assert.equal(registered.status, 201);
    const user = (await registered.json()).user;
    assert.equal(user.name, 'Давид');
    assert.equal(user.login, 'player_1@example.com');
    assert.deepEqual(Object.keys(user).sort(), ['id', 'login', 'name']);
    const cookie = cookieOf(registered);
    assert.notEqual(cookie, guestCookie);
    assert.equal((await request('register', credentials)).status, 409);
    assert.equal(
      (await request('register', { ...credentials, email: ' PLAYER_1@EXAMPLE.COM ' })).status,
      409
    );
    assert.equal(
      (await request('login', { ...credentials, password: 'incorrect-password' })).status,
      401
    );
    assert.deepEqual((await (await request('me', undefined, cookie)).json()).user, user);
    const player = await connect(cookie);
    const room = application.service.createRoom();
    const joined = player.next('updateState');
    player.send('joinRoom', { roomCode: room.code, name: 'Подмена' });
    assert.equal((await joined).players[0].name, 'Давид');
    const updatedState = player.next('updateState');
    const updatedProfile = player.next('profileUpdated');
    const renamed = await request('name', { name: '  Новый ник  ' }, cookie);
    assert.equal(renamed.status, 200);
    assert.equal(renamed.headers.get('set-cookie'), null);
    assert.equal((await updatedState).players[0].name, 'Новый ник');
    assert.equal((await updatedProfile).user.name, 'Новый ник');
    user.name = 'Новый ник';
    const rejoined = player.next('updateState');
    player.send('joinRoom', { roomCode: room.code, name: 'Старый ник' });
    assert.equal((await rejoined).players[0].name, 'Новый ник');
    player.close();
    await application.close();
    await start();
    assert.deepEqual((await (await request('me', undefined, cookie)).json()).user, user);
    const loggedIn = await request('login', credentials);
    assert.equal(loggedIn.status, 200);
    const loginCookie = cookieOf(loggedIn);
    assert.equal((await request('logout', {}, loginCookie)).status, 200);
    assert.equal((await (await request('me', undefined, loginCookie)).json()).user, null);
    for (let i = 0; i < 21; i++) await request('login', { login: 'x', password: '' });
    assert.equal((await request('login', credentials)).status, 429);
  } finally {
    await application?.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

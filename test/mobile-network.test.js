const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter, once } = require('node:events');
const ts = require('typescript');
const { createApplication } = require('../src/app');

const filename = path.resolve(__dirname, '../mobile/network.ts');
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  filename
);
const { NetworkGame, serverAddress } = compiled.exports;

test('native connection accepts LAN HTTP and HTTPS but rejects insecure external hosts', () => {
  assert.equal(serverAddress('192.168.1.10:3000'), 'http://192.168.1.10:3000');
  assert.equal(serverAddress('https://game.example/'), 'https://game.example');
  for (const value of [
    'http://example.com',
    'javascript:alert(1)',
    'https://user:pass@example.com',
    'https://example.com/?room=12345'
  ])
    assert.throws(() => serverAddress(value));
});

test('two native clients authenticate, play in the same room and receive nickname changes', async (t) => {
  const app = createApplication({ databasePath: ':memory:' });
  t.after(() => app.close());
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const address = `http://127.0.0.1:${app.server.address().port}`;
  function player(name) {
    const events = new EventEmitter();
    const errors = [];
    const client = new NetworkGame(address, name, {
      state: (state) => events.emit('state', state),
      rooms: () => {},
      connection: (ready) => {
        if (ready) events.emit('connected');
      },
      profile: (user, name) => events.emit('profile', { user, name }),
      error: (message) => errors.push(message),
      closed: () => events.emit('closed')
    });
    t.after(() => client.dispose());
    const next = (event) =>
      once(events, event, { signal: AbortSignal.timeout(10000) })
        .then(([data]) => data)
        .catch((error) => {
          throw new Error(`${name}: waiting for ${event}; ${errors.join('; ')}`, { cause: error });
        });
    return { client, next, errors };
  }
  const first = player('Первый'),
    second = player('Второй');
  let ready = first.next('connected');
  await first.client.connect();
  await ready;
  ready = second.next('connected');
  await second.client.connect();
  await ready;
  let state = first.next('state');
  first.client.create({ mode: '36', maxPlayers: 2, gameType: 'throwIn' });
  const waiting = await state;
  assert.equal(waiting.status, 'waiting');
  state = second.next('state');
  const firstDeal = first.next('state');
  second.client.join(waiting.roomCode);
  const playing = await state;
  const firstPlaying = await firstDeal;
  assert.equal(playing.status, 'playing');
  assert.equal(playing.myHand.length, 6);
  assert.ok(Array.isArray(playing.playableCardIndexes));
  const attacker = playing.myIndex === playing.attackerIndex ? second : first;
  const observer = attacker === second ? first : second;
  const hand = attacker === second ? playing.myHand : firstPlaying.myHand;
  const cardIndex = hand.findIndex((card) => !card.joker);
  state = observer.next('state');
  const attackState = attacker.next('state');
  attacker.client.send('playCard', cardIndex);
  assert.equal((await state).table[0].attack.code, hand[cardIndex].code);
  await attackState;
  state = second.next('state');
  await first.client.rename('Новый ник');
  assert.equal((await state).players[0].name, 'Новый ник');
  const closed = second.next('closed');
  first.client.send('leaveRoom');
  await closed;
  ready = first.next('connected');
  const profile = first.next('profile');
  await first.client.account('register', {
    email: 'native@example.com',
    password: 'test-native-pass',
    name: 'Аккаунт'
  });
  assert.equal((await profile).user.name, 'Аккаунт');
  await ready;
  assert.deepEqual(first.errors, []);
});

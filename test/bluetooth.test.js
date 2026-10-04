const test = require('node:test');
const assert = require('node:assert/strict');
const { createBluetoothHost } = require('../mobile/bluetooth-host');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const ts = require('typescript');

function loadTransport(native, events, permission = 'granted') {
  const filename = path.resolve(__dirname, '../mobile/bluetooth.ts');
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = compiled.require.bind(compiled);
  compiled.require = (name) =>
    name === 'react-native'
      ? {
          NativeModules: { GameBluetooth: native },
          NativeEventEmitter: class {
            addListener(name, callback) {
              events.on(name, callback);
              return { remove: () => events.off(name, callback) };
            }
          },
          Platform: { Version: 36 },
          PermissionsAndroid: {
            PERMISSIONS: {
              BLUETOOTH_SCAN: 'scan',
              BLUETOOTH_CONNECT: 'connect',
              BLUETOOTH_ADVERTISE: 'advertise'
            },
            RESULTS: { GRANTED: 'granted' },
            requestMultiple: async (permissions) =>
              Object.fromEntries(permissions.map((value) => [value, permission]))
          }
        }
      : original(name);
  compiled._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    filename
  );
  return compiled.exports.BluetoothGame;
}

test('Bluetooth transport joins a real engine, exchanges commands and cleans subscriptions', async (t) => {
  const emitters = { host: new EventEmitter(), guest: new EventEmitter() };
  const states = {};
  const clients = {};
  let stoppedHosting = 0;
  for (const id of ['host', 'guest']) {
    const other = id === 'host' ? 'guest' : 'host';
    const Transport = loadTransport(
      {
        prepare: async () => id,
        host: async () => {},
        connect: async () => {},
        stop() {},
        stopHosting() {
          stoppedHosting++;
        },
        send: (_target, value) =>
          queueMicrotask(() =>
            emitters[other].emit('durakBluetooth', { type: 'message', id, value })
          )
      },
      emitters[id]
    );
    clients[id] = new Transport(id, {
      state: (state) => {
        states[id] = state;
      },
      device() {},
      status() {},
      closed() {}
    });
    t.after(() => clients[id].dispose());
  }
  await clients.host.host({ mode: '36', maxPlayers: 2, gameType: 'throwIn' });
  await clients.guest.join('host');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(states.guest.myIndex, 1);
  assert.equal(states.host.status, 'playing');
  assert.equal(stoppedHosting, 1);
  const id = states.host.playableCardIndexes.length ? 'host' : 'guest';
  clients[id].send('playCard', states[id].playableCardIndexes[0]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(states.host.table, states.guest.table);
  assert.equal(states.host.table.length, 1);
  const sentAt = Date.now() - 60000;
  emitters.guest.emit('durakBluetooth', {
    type: 'message',
    id: 'host',
    value: JSON.stringify({
      type: 'state',
      sentAt,
      state: { ...states.guest, turnDeadline: sentAt + 20000 }
    })
  });
  assert.ok(Math.abs(states.guest.turnDeadline - Date.now() - 20000) < 1000);
  emitters.guest.emit('durakBluetooth', { type: 'message', id: 'host', value: '{malformed' });
  clients.host.dispose();
  clients.guest.dispose();
  assert.equal(emitters.host.listenerCount('durakBluetooth'), 0);
  assert.equal(emitters.guest.listenerCount('durakBluetooth'), 0);
});
test('Bluetooth discovery publishes devices immediately with phone classification and no room probe', async () => {
  const events = new EventEmitter();
  const found = [];
  let status = '';
  const Transport = loadTransport(
    { prepare: async () => 'Телефон', scan: async () => {}, stop() {} },
    events
  );
  const client = new Transport('Игрок', {
    state() {},
    device: (device) => found.push(device),
    status: (text) => {
      status = text;
    },
    closed() {}
  });
  try {
    await client.scan();
    events.emit('durakBluetooth', {
      type: 'device',
      id: 'headphones',
      value: 'Galaxy Buds',
      isPhone: false
    });
    events.emit('durakBluetooth', {
      type: 'device',
      id: 'phone',
      value: 'Телефон друга',
      isPhone: true
    });
    events.emit('durakBluetooth', {
      type: 'device',
      id: 'unknown',
      value: 'Неизвестное устройство'
    });
    assert.deepEqual(found, [
      { id: 'headphones', name: 'Galaxy Buds', isPhone: false },
      { id: 'phone', name: 'Телефон друга', isPhone: true },
      { id: 'unknown', name: 'Неизвестное устройство', isPhone: false }
    ]);
    events.emit('durakBluetooth', { type: 'scanEnd' });
    assert.match(status, /Выберите телефон друга/);
    await client.scan();
    events.emit('durakBluetooth', { type: 'scanEnd' });
    assert.match(status, /Устройства не найдены/);
  } finally {
    client.dispose();
  }
});
test('Bluetooth permission denial does not start discovery', async () => {
  let scans = 0;
  const Transport = loadTransport(
    {
      scan: async () => {
        scans++;
      },
      stop() {}
    },
    new EventEmitter(),
    'denied'
  );
  const client = new Transport('Игрок', { state() {}, device() {}, status() {}, closed() {} });
  await assert.rejects(client.scan(), /Разрешите доступ/);
  assert.equal(scans, 0);
  client.dispose();
});

function setup(count) {
  const states = new Map();
  const rejected = [];
  let closed = '';
  const host = createBluetoothHost({
    name: 'Создатель',
    mode: '36',
    maxPlayers: count,
    gameType: 'throwIn',
    onState: (state) => states.set('host', state),
    send: (id, packet) =>
      packet.type === 'state' ? states.set(id, packet.state) : rejected.push(packet),
    close: (text) => {
      closed = text;
    }
  });
  const join = (id) => host.receive(id, { type: 'hello', version: 1, name: id });
  return {
    host,
    states,
    join,
    rejected,
    get closed() {
      return closed;
    }
  };
}
for (const count of [2, 3, 4]) {
  test(`Bluetooth: ${count} phones share moves without sharing private hands`, (t) => {
    const ctx = setup(count);
    t.after(() => ctx.host.dispose());
    assert.equal(ctx.states.get('host').status, 'waiting');
    for (let index = 1; index < count; index++) ctx.join(`phone${index}`);
    assert.equal(ctx.states.size, count);
    const hands = [...ctx.states.values()].flatMap((state) =>
      state.myHand.map((card) => card.code)
    );
    assert.equal(new Set(hands).size, 6 * count);
    for (const state of ctx.states.values()) {
      assert.equal(state.status, 'playing');
      assert.equal(state.myHand.length, 6);
      assert.equal(state.players.length, count);
      assert.ok(state.players.every((player) => !('hand' in player)));
      assert.equal(state.deck, undefined);
    }
    const [attackerId, attacker] = [...ctx.states].find(
      ([, state]) => state.playableCardIndexes.length
    );
    ctx.host.receive(attackerId, {
      type: 'command',
      event: 'playCard',
      payload: attacker.playableCardIndexes[0]
    });
    for (const state of ctx.states.values()) assert.equal(state.table.length, 1);
    const [defenderId] = [...ctx.states].find(([, state]) => state.canTake);
    ctx.host.receive(defenderId, { type: 'command', event: 'take' });
    for (const state of ctx.states.values()) assert.equal(state.table.length, 0);
    ctx.host.receive('phone1', { type: 'rename', name: 'Друг' });
    assert.equal(ctx.states.get('host').players[1].name, 'Друг');
    ctx.host.disconnected('phone1');
    assert.match(ctx.closed, /отключился/);
  });
}
test('Bluetooth rejects outsiders, incompatible versions, duplicate joins and full rooms', (t) => {
  const ctx = setup(2);
  t.after(() => ctx.host.dispose());
  ctx.host.receive('bad', { type: 'hello', version: 2, name: 'bad' });
  assert.equal(ctx.rejected.length, 1);
  ctx.host.receive('bad', { type: 'command', event: 'restartGame' });
  assert.equal(ctx.states.get('host').status, 'waiting');
  ctx.join('phone1');
  ctx.join('phone1');
  ctx.join('phone2');
  assert.equal(ctx.states.get('host').players.length, 2);
  assert.equal(ctx.rejected.length, 2);
  const before = JSON.stringify([...ctx.states]);
  ctx.host.receive('phone1', { type: 'command', event: 'playCard', payload: '0' });
  ctx.host.receive('phone1', { type: 'command', event: 'createRoom', payload: {} });
  assert.equal(JSON.stringify([...ctx.states]), before);
});
test('A player leaving the waiting room frees a seat', (t) => {
  const ctx = setup(3);
  t.after(() => ctx.host.dispose());
  ctx.join('phone1');
  ctx.host.disconnected('phone1');
  assert.equal(ctx.states.get('host').players.length, 1);
  ctx.join('phone2');
  ctx.join('phone3');
  assert.equal(ctx.states.get('host').status, 'playing');
});

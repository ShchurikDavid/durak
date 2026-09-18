const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  let seed = 123456789;
  const math = Object.create(Math);
  math.random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const timers = new Map();
  let nextTimer = 0;
  let connection;
  const sockets = new Map();
  const io = {
    sockets: { sockets }, emit() {}, to() { return { emit() {} }; },
    on(event, handler) { if (event === 'connection') connection = handler; }
  };
  const express = () => ({ use() {}, get() {} });
  express.static = () => {};
  const context = vm.createContext({
    require(name) {
      if (name === 'express') return express;
      if (name === 'http') return { createServer: () => ({ listen() {} }) };
      if (name === 'socket.io') return { Server: function () { return io; } };
      return require(name);
    },
    __dirname: path.resolve(__dirname, '..'), process, console, Math: math,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), context);
  const api = vm.runInContext('({createRoom, startGame, canAttack, canDefend, currentAttackLimit, performBito, performTake, checkGameOver, publicStateFor, joinRoom, removeRoom, rooms, nextPlayerIndex})', context);
  api.socket = id => {
    const handlers = {};
    const events = [];
    const socket = { id, data: {}, join() {}, leave() {},
      on(event, fn) { handlers[event] = fn; },
      emit(event, payload) { events.push({ event, payload }); },
      disconnect() { handlers.disconnect(); }, handlers, events };
    sockets.set(id, socket);
    connection(socket);
    return socket;
  };
  api.room = (count = 2, mode = '36') => {
    const room = api.createRoom({ maxPlayers: count, mode });
    for (let i = 0; i < count; i++) {
      api.joinRoom(api.socket(`s${i}`), { userId: `u${i}`, roomCode: room.code });
    }
    return room;
  };
  return { ...api, timers, sockets };
}
const card = (val = '6', suit = 'S') => ({ val, suit, code: `${val}${suit}` });

test('invalid modes and identities cannot crash or occupy a room', () => {
  const api = setup();
  for (const mode of ['__proto__', 'constructor', 'toString', null]) {
    const room = api.createRoom({ mode });
    assert.equal(room.mode, '36');
    const socket = api.socket('bad');
    api.joinRoom(socket, { userId: {}, roomCode: room.code });
    assert.equal(room.players.length, 0);
  }
});

test('all modes deal unique cards and preserve deck size for 2–4 players', () => {
  for (const mode of ['24', '36', '52', '54']) {
    for (const count of [2, 3, 4]) {
      const api = setup();
      const room = api.room(count, mode);
      const cards = [...room.game.deck, ...room.players.flatMap(p => p.hand)];
      assert.equal(cards.length, Number(mode));
      assert.equal(new Set(cards.map(c => c.code)).size, Number(mode));
      assert.ok(room.players.every(p => p.hand.length === 6));
      assert.ok(!room.game.trumpCard.joker);
      assert.notEqual(room.game.attackerIndex, room.game.defenderIndex);
    }
  }
});

test('first discard limit stays five during defense, later limit six', () => {
  const api = setup(), room = api.room();
  room.game.attackerIndex = 0; room.game.defenderIndex = 1;
  for (const limit of [5, 6]) {
    room.game.discard = limit === 5 ? [] : [card()];
    for (let defended = 0; defended <= limit; defended++) {
      room.players[1].hand = Array(6 - defended).fill(card());
      room.game.table = Array.from({ length: defended }, () => ({ attack: card(), defend: card('7') }));
      assert.equal(api.currentAttackLimit(room), limit);
      assert.equal(api.canAttack(room, 0, card()), defended < limit);
    }
  }
  room.game.table = []; room.players[1].hand = [];
  assert.equal(api.currentAttackLimit(room), 0);
  assert.equal(api.canAttack(room, 0, card()), false);
  room.players[1].hand = [card(), card()];
  assert.equal(api.currentAttackLimit(room), 2);
});

test('taking before the first discard keeps limit five', () => {
  const api = setup(), room = api.room();
  room.game.table = [{ attack: card(), defend: null }];
  assert.ok(api.performTake(room));
  assert.equal(api.currentAttackLimit(room), 5);
});

test('original attacker draws first, defender draws last after bito or take', () => {
  for (const take of [false, true]) {
    const api = setup(), room = api.room(3);
    room.game.attackerIndex = 0; room.game.defenderIndex = 1;
    room.players.forEach(p => { p.hand = Array(5).fill(card()); });
    const last = card('A', 'H'); room.game.deck = [last];
    room.game.table = [{ attack: card(), defend: take ? null : card('7') }];
    assert.ok(take ? api.performTake(room) : api.performBito(room));
    assert.ok(room.players[0].hand.includes(last));
  }
});

test('players who finished are skipped after a round with no deck', () => {
  const api = setup(), room = api.room(4);
  room.game.deck = []; room.game.attackerIndex = 0; room.game.defenderIndex = 1;
  room.players[0].hand = []; room.players[1].hand = [];
  room.players[2].hand = [card()]; room.players[3].hand = [card('8')];
  room.game.table = [{ attack: card(), defend: card('7') }];
  api.performBito(room);
  assert.equal(room.game.attackerIndex, 2);
  assert.equal(room.game.defenderIndex, 3);
  assert.equal(api.checkGameOver(room), false);
  assert.equal(api.publicStateFor(room, 0).isMyTurn, false);
  room.players[2].hand = [];
  assert.equal(api.checkGameOver(room), true);
  assert.equal(room.game.loserIndex, 3);
});

test('only main attacker opens; other attackers may pass after defense', () => {
  const api = setup(), room = api.room(3);
  room.game.attackerIndex = 0; room.game.defenderIndex = 1;
  assert.equal(api.canAttack(room, 2, card()), false);
  assert.equal(api.publicStateFor(room, 2).isMyTurn, false);
  room.game.table = [{ attack: card(), defend: card('7') }];
  assert.equal(api.publicStateFor(room, 2).canPass, true);
  api.sockets.get('s2').handlers.bito();
  assert.equal(room.game.table.length, 0);
});

test('reconnect resumes the timer and removing a room clears it', () => {
  const api = setup(), room = api.room();
  api.sockets.get('s0').disconnect();
  assert.equal(room.game.status, 'paused');
  assert.equal(room.game.turnDeadline, null);
  api.joinRoom(api.socket('replacement'), { userId: 'u0', roomCode: room.code });
  assert.equal(room.game.status, 'playing');
  assert.ok(room.game.turnDeadline > Date.now());
  assert.ok(api.timers.has(room.turnTimer));
  api.removeRoom(room);
  assert.equal(api.timers.size, 0);
});

test('failed room switch preserves current game; changing identity cannot add a seat', () => {
  const api = setup(), room = api.room(), socket = api.sockets.get('s0');
  api.joinRoom(socket, { userId: 'u0', roomCode: 'XXXXX' });
  assert.equal(socket.data.roomCode, room.code);
  assert.ok(api.rooms.has(room.code));
  const waiting = api.createRoom({ maxPlayers: 4 });
  const other = api.socket('other');
  api.joinRoom(other, { userId: 'one', roomCode: waiting.code });
  api.joinRoom(other, { userId: 'two', roomCode: waiting.code });
  assert.equal(waiting.players.length, 1);
});

test('trumps, ranks and joker colors obey defense rules', () => {
  const api = setup();
  assert.ok(api.canDefend(card('6', 'H'), card('7', 'H'), 'S'));
  assert.equal(api.canDefend(card('7', 'H'), card('6', 'H'), 'S'), false);
  assert.ok(api.canDefend(card('A', 'H'), card('6', 'S'), 'S'));
  assert.equal(api.canDefend(card('6', 'S'), card('A', 'H'), 'S'), false);
  assert.ok(api.canDefend(card('A', 'H'), { joker: true, color: 'red' }, 'S'));
  assert.equal(api.canDefend(card('A', 'H'), { joker: true, color: 'black' }, 'S'), false);
});

test('browser scripts parse and player id works without randomUUID on LAN', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  new vm.Script(fs.readFileSync(path.join(__dirname, '../public/durak-enhancements.js'), 'utf8'));
  const fn = html.match(/function getUserId\(\)\{[\s\S]*?\n    \}/)[0];
  const storage = new Map();
  const context = vm.createContext({ crypto: { getRandomValues: require('node:crypto').webcrypto.getRandomValues.bind(require('node:crypto').webcrypto) }, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) } });
  vm.runInContext(fn, context);
  const id = vm.runInContext('getUserId()', context);
  assert.match(id, /^user_[a-f0-9]{32}$/);
  assert.equal(vm.runInContext('getUserId()', context), id);
});

test('unclaimed rooms expire and disappear from memory', () => {
  const api = setup(), room = api.createRoom();
  api.timers.get(room.emptyTimer).fn();
  assert.equal(api.rooms.has(room.code), false);
  assert.equal(api.timers.size, 0);
});

test('full games preserve every card and finish with 2–4 players', () => {
  for (const mode of ['24', '36', '52']) {
    for (const count of [2, 3, 4]) {
      const api = setup(), room = api.room(count, mode);
      for (let step = 0; step < 10000 && room.game.status === 'playing'; step++) {
        const cards = [...room.game.deck, ...room.game.discard,
          ...room.players.flatMap(p => p.hand),
          ...room.game.table.flatMap(pair => [pair.attack, pair.defend].filter(Boolean))];
        assert.equal(cards.length, Number(mode));
        assert.equal(new Set(cards.map(c => c.code)).size, Number(mode));
        const { attackerIndex, defenderIndex } = room.game;
        const attacker = room.players[attackerIndex], defender = room.players[defenderIndex];
        const open = room.game.table.find(pair => !pair.defend);
        if (open) {
          const index = defender.hand.findIndex(c => api.canDefend(open.attack, c, room.game.trumpCard.suit));
          if (index < 0) api.sockets.get(defender.socketId).handlers.take();
          else api.sockets.get(defender.socketId).handlers.playCard(index);
        } else if (room.game.table.length) {
          api.sockets.get(attacker.socketId).handlers.bito();
        } else {
          const index = attacker.hand.findIndex(c => api.canAttack(room, attackerIndex, c));
          assert.ok(index >= 0, `no legal opening: ${mode}/${count}`);
          api.sockets.get(attacker.socketId).handlers.playCard(index);
        }
      }
      assert.equal(room.game.status, 'finished', `${mode}/${count} did not finish`);
    }
  }
});

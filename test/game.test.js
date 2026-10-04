const test = require('node:test');
const assert = require('node:assert/strict');

test('HTTP modules and real Socket.IO clients work together', async (t) => {
  const { once, EventEmitter } = require('node:events');
  const { createApplication } = require('../src/app');
  const application = createApplication({ databasePath: ':memory:' });
  t.after(() => application.close());
  application.server.listen(0, '127.0.0.1');
  await once(application.server, 'listening');
  const base = `http://127.0.0.1:${application.server.address().port}`;
  for (const route of [
    '/',
    '/js/app.js',
    '/js/ui/participants.js',
    '/css/base.css',
    '/css/table.css'
  ]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    if (route.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/);
  }

  async function connect() {
    const events = new EventEmitter();
    const ws = new WebSocket(
      base.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket'
    );
    t.after(() => ws.close());
    const next = (event) =>
      once(events, event, { signal: AbortSignal.timeout(5000) }).then(([data]) => data);
    const ready = next('ready');
    ws.addEventListener('message', ({ data }) => {
      if (data.startsWith('0')) ws.send('40');
      else if (data === '2') ws.send('3');
      else if (data.startsWith('40')) events.emit('ready');
      else if (data.startsWith('42')) {
        const [event, payload] = JSON.parse(data.slice(2));
        events.emit(event, payload);
      }
    });
    ws.addEventListener('error', () =>
      events.emit('error', new Error('WebSocket connection failed'))
    );
    await ready;
    return { next, send: (event, payload) => ws.send('42' + JSON.stringify([event, payload])) };
  }

  const first = await connect();
  const created = first.next('roomCreated');
  first.send('createRoom', { mode: '36', maxPlayers: 2 });
  const { code } = await created;
  const defaultName = first.next('updateState');
  first.send('joinRoom', { userId: 'integration-one', roomCode: code });
  assert.equal((await defaultName).players[0].name, 'Игрок');
  const waiting = first.next('updateState');
  first.send('joinRoom', { userId: 'integration-one', name: 'Первый', roomCode: code });
  assert.equal((await waiting).status, 'waiting');
  const second = await connect();
  const started = second.next('updateState');
  // Copying another client's claimed ID cannot take over their seat.
  second.send('joinRoom', { userId: 'integration-one', name: 'Второй', roomCode: code });
  const state = await started;
  assert.equal(state.status, 'playing');
  assert.equal(state.myHand.length, 6);
  assert.equal(state.attackLimit, 5);
  assert.ok(state.players.every((player) => !('hand' in player)));
});

function setup() {
  let seed = 123456789;
  const math = Object.create(Math);
  math.random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const timers = new Map();
  let nextTimer = 0;
  let connection;
  const sockets = new Map();
  const io = {
    sockets: { sockets },
    emit() {},
    to() {
      return { emit() {} };
    },
    on(event, handler) {
      if (event === 'connection') connection = handler;
    }
  };
  const options = {
    random: math.random,
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };
  const service = require('../src/rooms/service').createRoomService(io, options);
  require('../src/socket/handlers').registerSocketHandlers(io, service);
  const api = {
    ...service,
    ...service.engine,
    ...require('../src/game/rules'),
    ...require('../src/game/public-state')
  };
  api.socket = (id) => {
    const handlers = {};
    const events = [];
    const socket = {
      id,
      data: {},
      join() {},
      leave() {},
      on(event, fn) {
        handlers[event] = fn;
      },
      emit(event, payload) {
        events.push({ event, payload });
      },
      disconnect() {
        handlers.disconnect();
      },
      handlers,
      events
    };
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

test('a table ending with only defensive jokers is a draw, not an endless game', () => {
  const api = setup();
  const room = api.room(2, '54');
  room.game.deck = [];
  room.game.table = [];
  room.players[0].hand = [{ joker: true, code: 'JOKER_RED' }];
  room.players[1].hand = [{ joker: true, code: 'JOKER_BLACK' }];
  assert.equal(api.checkGameOver(room), true);
  assert.equal(room.game.status, 'finished');
  assert.equal(room.game.loserIndex, null);
});

test('transfer moves attack to the next player and publishes available cards', () => {
  const api = setup(),
    room = api.room(3);
  room.gameType = 'transfer';
  room.game.attackerIndex = 0;
  room.game.defenderIndex = 1;
  room.players[0].hand = [card('6', 'H'), card('A')];
  room.players[1].hand = [card('6', 'D'), card('K')];
  room.players[2].hand = [card('6', 'C'), card('7'), card('8')];
  api.sockets.get('s0').handlers.playCard(0);
  assert.deepEqual(api.publicStateFor(room, 1).transferCardIndexes, [0]);
  api.sockets.get('s1').handlers.transferCard(0);
  assert.equal(room.game.defenderIndex, 2);
  assert.equal(room.game.attackerIndex, 1);
  assert.equal(room.game.roundAttackerIndex, 0);
  assert.equal(room.game.table.length, 2);
  assert.equal(room.players[1].hand.length, 1);
  assert.equal(api.publicStateFor(room, 2).canTransfer, false); // Player 0 has only one card.
  assert.equal(api.publicStateFor(room, 2).gameTypeLabel, 'Переводной');
  room.game.deck = [card('Q')];
  api.performTake(room);
  assert.equal(room.players[0].hand.length, 2); // Original attacker draws first.
  assert.equal(room.game.roundAttackerIndex, null);
});

test('transfer is forbidden after defense, for wrong ranks, jokers and excess cards', () => {
  const api = setup(),
    room = api.room(3);
  room.game.attackerIndex = 0;
  room.game.defenderIndex = 1;
  room.game.table = [{ attack: card(), defend: null }];
  assert.equal(api.canTransfer(room, 1, card()), false);
  room.gameType = 'transfer';
  assert.equal(api.canTransfer(room, 1, card()), true);
  assert.equal(api.canTransfer(room, 0, card()), false);
  assert.equal(api.canTransfer(room, 1, card('7')), false);
  assert.equal(api.canTransfer(room, 1, { ...card(), joker: true }), false);
  room.game.table[0].defend = card('7');
  assert.equal(api.canTransfer(room, 1, card()), false);
  room.game.table = Array.from({ length: 5 }, () => ({ attack: card(), defend: null }));
  assert.equal(api.canTransfer(room, 1, card()), false);
  room.game.discard = [card('8')];
  assert.equal(api.canTransfer(room, 1, card()), true);
  room.game.table.push({ attack: card(), defend: null });
  assert.equal(api.canTransfer(room, 1, card()), false);
  room.game.table = [{ attack: card(), defend: null }];
  room.players[2].hand = [card()];
  assert.equal(api.canTransfer(room, 1, card()), false);
  room.game.status = 'paused';
  assert.equal(api.canTransfer(room, 1, card()), false);
});

test('two players can transfer back; invalid transfer commands do not change cards', () => {
  const api = setup(),
    room = api.room(2);
  room.gameType = 'transfer';
  room.game.attackerIndex = 0;
  room.game.defenderIndex = 1;
  room.players[0].hand = [card(), card('6', 'D'), card('8'), card('9')];
  room.players[1].hand = [card('6', 'H'), card('7'), card('8'), card('9')];
  api.sockets.get('s0').handlers.playCard(0);
  api.sockets.get('s1').handlers.transferCard(99);
  assert.equal(room.game.table.length, 1);
  api.sockets.get('s1').handlers.transferCard(0);
  assert.equal(room.game.defenderIndex, 0);
  api.sockets.get('s0').handlers.transferCard(0);
  assert.equal(room.game.defenderIndex, 1);
  assert.equal(room.game.table.length, 3);
});

test('room game type is validated and survives restart', () => {
  const api = setup();
  assert.equal(api.createRoom({ gameType: 'invalid' }).gameType, 'throwIn');
  const room = api.createRoom({ mode: '24', maxPlayers: 2, gameType: 'transfer' });
  assert.equal(api.roomInfo(room).gameTypeLabel, 'Переводной');
  for (let i = 0; i < 2; i++)
    api.joinRoom(api.socket('r' + i), { userId: 'r' + i, roomCode: room.code });
  assert.equal(api.publicStateFor(room, 0).gameType, 'transfer');
  room.game.status = 'finished';
  api.sockets.get('r0').handlers.restartGame();
  assert.equal(room.game.status, 'playing');
  assert.equal(api.publicStateFor(room, 0).gameType, 'transfer');
});

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
      const cards = [...room.game.deck, ...room.players.flatMap((p) => p.hand)];
      assert.equal(cards.length, Number(mode));
      assert.equal(new Set(cards.map((c) => c.code)).size, Number(mode));
      assert.ok(room.players.every((p) => p.hand.length === 6));
      assert.ok(!room.game.trumpCard.joker);
      assert.notEqual(room.game.attackerIndex, room.game.defenderIndex);
    }
  }
});

test('first discard limit stays five during defense, later limit six', () => {
  const api = setup(),
    room = api.room();
  room.game.attackerIndex = 0;
  room.game.defenderIndex = 1;
  for (const limit of [5, 6]) {
    room.game.discard = limit === 5 ? [] : [card()];
    for (let defended = 0; defended <= limit; defended++) {
      room.players[1].hand = Array(6 - defended).fill(card());
      room.game.table = Array.from({ length: defended }, () => ({
        attack: card(),
        defend: card('7')
      }));
      assert.equal(api.currentAttackLimit(room), limit);
      assert.equal(api.canAttack(room, 0, card()), defended < limit);
    }
  }
  room.game.table = [];
  room.players[1].hand = [];
  assert.equal(api.currentAttackLimit(room), 0);
  assert.equal(api.canAttack(room, 0, card()), false);
  room.players[1].hand = [card(), card()];
  assert.equal(api.currentAttackLimit(room), 2);
});

test('taking before the first discard keeps limit five', () => {
  const api = setup(),
    room = api.room();
  room.game.table = [{ attack: card(), defend: null }];
  assert.ok(api.performTake(room));
  assert.equal(api.currentAttackLimit(room), 5);
});

test('original attacker draws first, defender draws last after bito or take', () => {
  for (const take of [false, true]) {
    const api = setup(),
      room = api.room(3);
    room.game.attackerIndex = 0;
    room.game.defenderIndex = 1;
    room.players.forEach((p) => {
      p.hand = Array(5).fill(card());
    });
    const last = card('A', 'H');
    room.game.deck = [last];
    room.game.table = [{ attack: card(), defend: take ? null : card('7') }];
    assert.ok(take ? api.performTake(room) : api.performBito(room));
    assert.ok(room.players[0].hand.includes(last));
  }
});

test('players who finished are skipped after a round with no deck', () => {
  const api = setup(),
    room = api.room(4);
  room.game.deck = [];
  room.game.attackerIndex = 0;
  room.game.defenderIndex = 1;
  room.players[0].hand = [];
  room.players[1].hand = [];
  room.players[2].hand = [card()];
  room.players[3].hand = [card('8')];
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
  const api = setup(),
    room = api.room(3);
  room.game.attackerIndex = 0;
  room.game.defenderIndex = 1;
  assert.equal(api.canAttack(room, 2, card()), false);
  assert.equal(api.publicStateFor(room, 2).isMyTurn, false);
  room.game.table = [{ attack: card(), defend: card('7') }];
  assert.equal(api.publicStateFor(room, 2).canPass, true);
  api.sockets.get('s2').handlers.bito();
  assert.equal(room.game.table.length, 0);
});

test('reconnect resumes the timer and removing a room clears it', () => {
  const api = setup(),
    room = api.room();
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
  const api = setup(),
    room = api.room(),
    socket = api.sockets.get('s0');
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

test('player id works without randomUUID on LAN', async () => {
  const { getUserId } = await import('../public/js/core/identity.js');
  const values = new Map();
  const storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) };
  const cryptoProvider = {
    getRandomValues: (array) => require('node:crypto').webcrypto.getRandomValues(array)
  };
  const id = getUserId(storage, cryptoProvider);
  assert.match(id, /^user_[a-f0-9]{32}$/);
  assert.equal(getUserId(storage, cryptoProvider), id);
});

test('unclaimed rooms expire and disappear from memory', () => {
  const api = setup(),
    room = api.createRoom();
  api.timers.get(room.emptyTimer).fn();
  assert.equal(api.rooms.has(room.code), false);
  assert.equal(api.timers.size, 0);
});

test('full games preserve every card and finish with 2–4 players', () => {
  for (const mode of ['24', '36', '52']) {
    for (const count of [2, 3, 4]) {
      const api = setup(),
        room = api.room(count, mode);
      for (let step = 0; step < 10000 && room.game.status === 'playing'; step++) {
        const cards = [
          ...room.game.deck,
          ...room.game.discard,
          ...room.players.flatMap((p) => p.hand),
          ...room.game.table.flatMap((pair) => [pair.attack, pair.defend].filter(Boolean))
        ];
        assert.equal(cards.length, Number(mode));
        assert.equal(new Set(cards.map((c) => c.code)).size, Number(mode));
        const { attackerIndex, defenderIndex } = room.game;
        const attacker = room.players[attackerIndex],
          defender = room.players[defenderIndex];
        const open = room.game.table.find((pair) => !pair.defend);
        if (open) {
          const index = defender.hand.findIndex((c) =>
            api.canDefend(open.attack, c, room.game.trumpCard.suit)
          );
          if (index < 0) api.sockets.get(defender.socketId).handlers.take();
          else api.sockets.get(defender.socketId).handlers.playCard(index);
        } else if (room.game.table.length) {
          api.sockets.get(attacker.socketId).handlers.bito();
        } else {
          const index = attacker.hand.findIndex((c) => api.canAttack(room, attackerIndex, c));
          assert.ok(index >= 0, `no legal opening: ${mode}/${count}`);
          api.sockets.get(attacker.socketId).handlers.playCard(index);
        }
      }
      assert.equal(room.game.status, 'finished', `${mode}/${count} did not finish`);
    }
  }
});

test('surrender discards hand, blocks actions and keeps spectator connected', () => {
  const api = setup(),
    room = api.room(4);
  room.game.attackerIndex = 0;
  room.game.defenderIndex = 1;
  const hand = [...room.players[2].hand];
  api.sockets.get('s2').handlers.surrender();
  assert.equal(room.players[2].surrendered, true);
  assert.deepEqual(room.players[2].hand, []);
  assert.deepEqual(room.game.discard, hand);
  assert.equal(api.nextPlayerIndex(room, 1), 3);
  api.dealCards(room);
  assert.deepEqual(room.players[2].hand, []);
  room.game.table = [{ attack: card(), defend: card('7') }];
  const state = api.publicStateFor(room, 2);
  assert.equal(state.canPass, false);
  assert.equal(state.canSurrender, false);
  assert.equal(state.role, 'Наблюдатель');
  api.sockets.get('s2').handlers.bito();
  assert.equal(room.game.table.length, 1);
  api.sockets.get('s2').handlers.disconnect();
  assert.equal(room.game.status, 'playing');
  assert.equal(room.reconnectTimers.size, 0);
  api.joinRoom(api.sockets.get('s2'), { userId: 'u2', roomCode: room.code });
  assert.equal(api.publicStateFor(room, 2).surrendered, true);
  api.sockets.get('s2').handlers.leaveRoom();
  assert.equal(api.rooms.has(room.code), true);
  assert.equal(room.players.length, 4);
});

test('defender surrender finishes the round, preserves cards and resets on a new game', () => {
  const api = setup(),
    room = api.room(3);
  room.game.attackerIndex = 0;
  room.game.defenderIndex = 1;
  const attack = room.players[0].hand.pop();
  room.game.table = [{ attack, defend: null }];
  const discarded = [...room.players[1].hand, attack];
  assert.equal(api.performSurrender(room, 1), true);
  assert.deepEqual(room.game.discard, discarded);
  assert.equal(room.game.table.length, 0);
  assert.equal(room.game.attackerIndex, 2);
  assert.equal(room.game.defenderIndex, 0);
  assert.equal(
    room.game.deck.length +
      room.game.discard.length +
      room.players.reduce((n, p) => n + p.hand.length, 0),
    36
  );
  assert.equal(api.performSurrender(room, 0), true);
  assert.equal(room.game.status, 'finished');
  assert.equal(room.game.loserIndex, 0);
  api.startGame(room);
  assert.ok(room.players.every((p) => !p.surrendered && p.hand.length === 6));
});

test('attacker surrender preserves an ongoing defense and ends two-player games', () => {
  const api = setup(),
    room = api.room(3);
  room.game.attackerIndex = 0;
  room.game.defenderIndex = 1;
  room.game.table = [{ attack: room.players[0].hand.pop(), defend: null }];
  assert.equal(api.performSurrender(room, 0), true);
  assert.equal(room.game.defenderIndex, 1);
  assert.equal(room.game.attackerIndex, 2);
  assert.equal(room.game.table.length, 1);
  api.performTake(room);
  assert.equal(room.players[0].hand.length, 0);
  assert.equal(room.game.attackerIndex, 2);
  const duel = api.room(2);
  assert.equal(api.performSurrender(duel, 0), true);
  assert.equal(duel.game.status, 'finished');
  assert.equal(duel.game.loserIndex, 0);
  assert.equal(duel.players[0].surrendered, true);
  assert.equal(api.performSurrender(duel, -1), false);
});

test('timeout needs majority, freezes play and resumes with preserved turn time', () => {
  const api = setup(),
    room = api.room(3);
  room.game.turnDeadline = Date.now() + 12345;
  api.sockets.get('s0').handlers.voteTimeout();
  assert.equal(room.game.status, 'playing');
  api.sockets.get('s0').handlers.voteTimeout();
  assert.equal(room.game.timeoutVotes.length, 1);
  api.sockets.get('s1').handlers.voteTimeout();
  assert.equal(room.game.status, 'timeout');
  assert.equal(room.game.turnDeadline, null);
  assert.equal(room.turnTimer, null);
  assert.ok(room.game.resumeTurnMs <= 12345 && room.game.resumeTurnMs > 12000);
  assert.equal(api.timers.get(room.timeoutTimer).delay, 60000);
  const hands = JSON.stringify(room.players.map((p) => p.hand));
  for (const socket of api.sockets.values()) {
    socket.handlers.playCard(0);
    socket.handlers.transferCard(0);
    socket.handlers.take();
    socket.handlers.bito();
    socket.handlers.surrender();
  }
  assert.equal(JSON.stringify(room.players.map((p) => p.hand)), hands);
  assert.equal(api.publicStateFor(room, 2).timeout.active, true);
  api.sockets.get('s0').handlers.voteResume();
  api.sockets.get('s0').handlers.voteResume();
  assert.equal(room.game.resumeVotes.length, 1);
  assert.equal(room.game.status, 'timeout');
  api.sockets.get('s2').handlers.voteResume();
  assert.equal(room.game.status, 'playing');
  assert.ok(room.game.turnDeadline - Date.now() <= 12345);
  assert.deepEqual(room.game.resumeVotes, []);
  assert.deepEqual(room.game.timeoutVotes, []);
  assert.equal(room.timeoutTimer, null);
});

test('timeout expires automatically; disconnected players must reconnect before play resumes', () => {
  const api = setup(),
    room = api.room(2);
  api.voteTimeout(room, 0);
  api.voteTimeout(room, 1);
  const timer = room.timeoutTimer;
  api.sockets.get('s1').handlers.disconnect();
  assert.equal(room.game.status, 'timeout');
  assert.equal(room.timeoutTimer, timer);
  api.joinRoom(api.sockets.get('s1'), { userId: 'u1', roomCode: room.code });
  assert.equal(room.game.status, 'timeout');
  api.sockets.get('s1').handlers.disconnect();
  api.timers.get(timer).fn();
  assert.equal(room.game.status, 'paused');
  assert.equal(room.game.timeoutDeadline, null);
  api.joinRoom(api.sockets.get('s1'), { userId: 'u1', roomCode: room.code });
  assert.equal(room.game.status, 'playing');
  assert.ok(room.game.turnDeadline);
});

test('spectators cannot vote and room removal clears timeout timer', () => {
  const api = setup(),
    room = api.room(4);
  api.performSurrender(room, 3);
  assert.equal(api.voteTimeout(room, 3), false);
  assert.equal(api.voteTimeout(room, -1), false);
  api.voteTimeout(room, 0);
  api.voteTimeout(room, 1);
  assert.equal(room.game.status, 'timeout');
  assert.equal(api.publicStateFor(room, 3).timeout.canVote, false);
  assert.equal(api.voteTimeout(room, 3, true), false);
  const timer = room.timeoutTimer;
  api.removeRoom(room);
  assert.equal(api.timers.has(timer), false);
});

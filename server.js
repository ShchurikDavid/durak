const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

const PORT = Number(process.env.PORT) || 3000;
const HAND_SIZE = 6;
const RECONNECT_GRACE_MS = 60_000;
const ROOM_CODE_LENGTH = 5;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const TURN_TIME_MS = 20_000;

const suits = ['S', 'H', 'D', 'C'];
const ALL_VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const MODE_CONFIG = {
  '24': { label: '24 карты', values: ['9', '10', 'J', 'Q', 'K', 'A'], jokers: false },
  '36': { label: '36 карт', values: ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'], jokers: false },
  '52': { label: '52 карты', values: ALL_VALUES, jokers: false },
  '54': { label: '52 карты + 🃏 джокеры', values: ALL_VALUES, jokers: true }
};
const DEFAULT_MODE = '36';

const valueRank = {
  '2': 2, '3': 3, '4': 4, '5': 5,
  '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14
};

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map();

function newGameState() {
  return {
    status: 'waiting',
    deck: [],
    trumpCard: null,
    table: [],
    discard: [],
    discardPreview: [],
    attackerIndex: 0,
    defenderIndex: 1,
    turn: 'attacker',
    roundNumber: 0,
    firstRoundLimit: 5,
    turnDeadline: null,
    roundStartedAt: Date.now(),
    matchStartedAt: Date.now(),
    winnerIndex: null,
    loserIndex: null,
    resultText: '',
    mode: DEFAULT_MODE
  };
}

function normalizeMode(value) {
  const mode = String(value || DEFAULT_MODE);
  return Object.hasOwn(MODE_CONFIG, mode) ? mode : DEFAULT_MODE;
}

function normalizePlayerCount(value) {
  const count = Number(value);
  return Number.isInteger(count)
    ? Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, count))
    : 2;
}

function createRoom(payload = {}) {
  const data = typeof payload === 'object' && payload !== null ? payload : { mode: payload };
  const mode = normalizeMode(data.mode);
  const maxPlayers = normalizePlayerCount(data.maxPlayers ?? data.players ?? 2);

  let code;
  do {
    code = crypto.randomBytes(4).toString('hex').slice(0, ROOM_CODE_LENGTH).toUpperCase();
  } while (rooms.has(code));

  const room = {
    code,
    mode,
    maxPlayers,
    players: [],
    game: newGameState(),
    reconnectTimers: new Map()
  };

  rooms.set(code, room);
  room.emptyTimer = setTimeout(() => {
    if (room.players.length === 0) removeRoom(room);
  }, RECONNECT_GRACE_MS);
  broadcastRoomList();
  return room;
}

function normalizeRoomCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

function playerBySocket(room, socketId) {
  return room.players.find(p => p.socketId === socketId);
}

function playerIndexBySocket(room, socketId) {
  return room.players.findIndex(p => p.socketId === socketId);
}

function activePlayers(room) {
  return room.players.filter(p => p.socketId);
}

function allPlayersPresent(room) {
  return room.players.length === room.maxPlayers && room.players.every(p => Boolean(p.socketId));
}

function nextPlayerIndex(room, fromIndex) {
  const total = room.players.length;
  if (!total) return 0;

  for (let step = 1; step <= total; step++) {
    const index = (fromIndex + step) % total;
    const player = room.players[index];
    if (player?.socketId && (room.game.deck.length > 0 || player.hand.length > 0)) return index;
  }
  return fromIndex;
}

function orderedPlayerIndexes(room, firstIndex) {
  const result = [];
  const total = room.players.length;
  if (!total) return result;

  for (let step = 0; step < total; step++) {
    const index = (firstIndex + step) % total;
    if (room.players[index]) result.push(index);
  }
  return result;
}

function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createDeck(mode) {
  const config = MODE_CONFIG[normalizeMode(mode)];
  const deck = [];

  for (const suit of suits) {
    for (const val of config.values) {
      deck.push({
        suit,
        val,
        code: `${val === '10' ? '0' : val}${suit}`
      });
    }
  }

  if (config.jokers) {
    deck.push({
      suit: 'JOKER_RED',
      val: 'JOKER_RED',
      code: 'JOKER_RED',
      color: 'red',
      joker: true
    });
    deck.push({
      suit: 'JOKER_BLACK',
      val: 'JOKER_BLACK',
      code: 'JOKER_BLACK',
      color: 'black',
      joker: true
    });
  }

  return shuffle(deck);
}

function hasUndefended(room) {
  return room.game.table.some(pair => pair.defend === null);
}

function undefendedCount(room) {
  return room.game.table.filter(pair => pair.defend === null).length;
}

function tableValues(room) {
  const values = [];
  for (const pair of room.game.table) {
    values.push(pair.attack.val);
    if (pair.defend) values.push(pair.defend.val);
  }
  return values;
}

function uniqueTableValues(room) {
  return [...new Set(tableValues(room))];
}

function currentAttackLimit(room) {
  const defender = room.players[room.game.defenderIndex];
  const defenderHand = defender ? defender.hand.length : HAND_SIZE;
  const defendedCount = room.game.table.filter(pair => pair.defend !== null).length;
  const roundLimit = room.game.discard.length === 0 ? room.game.firstRoundLimit : HAND_SIZE;
  // Уже сыгранные карты защиты тоже входят в руку на начало захода.
  return Math.min(roundLimit, defenderHand + defendedCount);
}

function canAttack(room, index, card) {
  if (!room.players[index] || !card) return false;
  if (index === room.game.defenderIndex) return false;
  if (room.game.turn !== 'attacker') return false;
  // Джокером нельзя атаковать/подкидывать — он слишком силён как атака
  // (почти нечем отбиться), поэтому джокер разрешён только для защиты.
  if (card.joker) return false;
  if (room.game.table.length >= currentAttackLimit(room)) return false;
  if (room.game.table.length === 0) {
    // Only the main attacker can start the attack
    return index === room.game.attackerIndex;
  }
  
  // Allow attacking if there are undefended cards (defender hasn't responded yet)
  // or if all cards are defended (normal podkidnoy rules)
  const hasUndefendedCards = hasUndefended(room);
  if (hasUndefendedCards) {
    // Can only add cards that match values already on table
    return uniqueTableValues(room).includes(card.val);
  }
  
  // All cards defended - can add new cards matching any table value
  return uniqueTableValues(room).includes(card.val);
}

function canDefend(attack, defend, trumpSuit) {
  if (defend.joker) {
    if (attack.joker) return false;
    const attackIsRed = attack.suit === 'H' || attack.suit === 'D';
    const attackIsBlack = attack.suit === 'S' || attack.suit === 'C';
    return defend.color === 'red' ? attackIsRed : attackIsBlack;
  }

  if (attack.joker) return false;
  if (!trumpSuit) return false;

  if (attack.suit === defend.suit) {
    return valueRank[defend.val] > valueRank[attack.val];
  }

  return defend.suit === trumpSuit && attack.suit !== trumpSuit;
}

function drawOrderAfterRound(room, firstIndex) {
  // Начинавший атаку добирает первым, защищавшийся — последним.
  const defender = room.game.defenderIndex;
  return orderedPlayerIndexes(room, firstIndex)
    .filter(index => index !== defender).concat(defender);
}

function dealCards(room, firstIndex = room.game.attackerIndex) {
  for (const index of drawOrderAfterRound(room, firstIndex)) {
    const player = room.players[index];
    if (!player) continue;

    while (player.hand.length < HAND_SIZE && room.game.deck.length > 0) {
      player.hand.push(room.game.deck.pop());
    }
  }
}

function determineFirstAttacker(room) {
  const trumpSuit = room.game.trumpCard?.suit;
  let lowestRank = Infinity;
  let attacker = 0;

  room.players.forEach((player, index) => {
    for (const card of player.hand) {
      if (!card.joker && card.suit === trumpSuit && valueRank[card.val] < lowestRank) {
        lowestRank = valueRank[card.val];
        attacker = index;
      }
    }
  });

  room.game.attackerIndex = attacker;
  room.game.defenderIndex = nextPlayerIndex(room, attacker);
}


function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  room.game.turnDeadline = null;
}

function scheduleTurnTimer(room) {
  clearTurnTimer(room);

  if (room.game.status !== 'playing' || !room.players.length) return;

  room.game.turnDeadline = Date.now() + TURN_TIME_MS;
  room.turnTimer = setTimeout(() => handleTurnTimeout(room), TURN_TIME_MS + 30);
}

function performBito(room) {
  if (
    room.game.status !== 'playing' ||
    room.game.table.length === 0 ||
    hasUndefended(room)
  ) return false;

  const oldDefender = room.game.defenderIndex;
  addToDiscard(room);
  room.game.table = [];
  dealCards(room);

  const newAttacker = room.players[oldDefender].hand.length > 0
    ? oldDefender : nextPlayerIndex(room, oldDefender);
  const newDefender = nextPlayerIndex(room, newAttacker);

  room.game.attackerIndex = newAttacker;
  room.game.defenderIndex = newDefender;
  room.game.roundNumber += 1;
  room.game.roundStartedAt = Date.now();
  room.game.turn = 'attacker';

  return true;
}

function performTake(room) {
  if (
    room.game.status !== 'playing' ||
    room.game.table.length === 0 ||
    !hasUndefended(room)
  ) return false;

  const defenderIndex = room.game.defenderIndex;
  const defender = room.players[defenderIndex];
  if (!defender) return false;

  for (const pair of room.game.table) {
    defender.hand.push(pair.attack);
    if (pair.defend) defender.hand.push(pair.defend);
  }

  room.game.table = [];
  dealCards(room);

  const newAttacker = nextPlayerIndex(room, defenderIndex);
  const newDefender = nextPlayerIndex(room, newAttacker);

  room.game.attackerIndex = newAttacker;
  room.game.defenderIndex = newDefender;
  room.game.roundNumber += 1;
  room.game.roundStartedAt = Date.now();
  room.game.turn = 'attacker';

  return true;
}

function handleTurnTimeout(room) {
  room.turnTimer = null;

  if (
    !rooms.has(room.code) ||
    room.game.status !== 'playing' ||
    !room.game.turnDeadline ||
    Date.now() + 5 < room.game.turnDeadline
  ) {
    return;
  }

  room.game.turnDeadline = null;

  // If there are undefended cards, defender must respond (take or defend)
  // Since turn is always 'attacker' during attack phase, we check for undefended cards
  if (hasUndefended(room)) {
    // Defender didn't respond in time - they take
    if (performTake(room)) {
      if (checkGameOver(room)) {
        sendGameState(room, 'gameOver');
      } else {
        scheduleTurnTimer(room);
        sendGameState(room, 'timeout-take');
      }
    }
    return;
  }

  // Все карты защищены - можно бито
  if (room.game.table.length > 0 && !hasUndefended(room)) {
    if (performBito(room)) {
      if (checkGameOver(room)) {
        sendGameState(room, 'gameOver');
      } else {
        scheduleTurnTimer(room);
        sendGameState(room, 'timeout-bito');
      }
    }
    return;
  }

  // Атакующий не походил за отведённое время (стол пуст — карта ещё не
  // разыграна). Никакую карту за него НЕ разыгрываем — просто передаём
  // право атаковать следующему игроку по кругу, ничего не меняя в руках.
  const attacker = room.players[room.game.attackerIndex];
  if (!attacker) return;

  const nextAttackerIndex = nextPlayerIndex(room, room.game.attackerIndex);
  const nextDefenderIndex = nextPlayerIndex(room, nextAttackerIndex);
  room.game.attackerIndex = nextAttackerIndex;
  room.game.defenderIndex = nextDefenderIndex;
  room.game.turn = 'attacker';

  scheduleTurnTimer(room);
  sendGameState(room, 'timeout-pass');
}

function startGame(room) {
  room.game = newGameState();
  room.game.status = 'playing';
  room.game.mode = room.mode;
  room.game.roundStartedAt = Date.now();
  room.game.matchStartedAt = Date.now();
  room.game.deck = createDeck(room.mode);

  const trumpIndex = room.game.deck.findIndex(card => !card.joker);
  if (trumpIndex > 0) {
    [room.game.deck[0], room.game.deck[trumpIndex]] =
      [room.game.deck[trumpIndex], room.game.deck[0]];
  }

  room.game.trumpCard = room.game.deck[0] || null;

  room.players.forEach(player => { player.hand = []; });

  // Стартовая раздача — по кругу от случайного места.
  const startIndex = Math.floor(Math.random() * room.players.length);
  room.game.attackerIndex = startIndex;
  room.game.defenderIndex = nextPlayerIndex(room, startIndex);
  dealCards(room, startIndex);
  determineFirstAttacker(room);

  room.game.turn = 'attacker';
  scheduleTurnTimer(room);
  sendGameState(room, 'start');
}

function addToDiscard(room) {
  const played = [];
  for (const pair of room.game.table) {
    played.push(pair.attack);
    if (pair.defend) played.push(pair.defend);
  }

  if (!played.length) return;

  room.game.discard.push(...played);
  room.game.discardPreview = played.slice(-6);
}

function finishGame(room, loserIndex, text) {
  clearTurnTimer(room);
  room.game.status = 'finished';
  room.game.loserIndex = loserIndex;
  room.game.winnerIndex = null;
  room.game.resultText = text;
  room.game.turn = null;
}

function checkGameOver(room) {
  if (room.game.deck.length > 0 || room.game.table.length > 0) return false;

  const remaining = room.players
    .map((player, index) => player.hand.length > 0 ? index : -1)
    .filter(index => index !== -1);

  if (remaining.length === 1) {
    const loser = remaining[0];
    finishGame(
      room,
      loser,
      `💀 ${room.players[loser].name || `Игрок ${loser + 1}`} остался с картами — он дурак!`
    );
    return true;
  }

  if (remaining.length === 0) {
    finishGame(room, null, '🤝 Все игроки закончили карты.');
    return true;
  }

  return false;
}

function resetAfterFinished(room) {
  clearTurnTimer(room);
  room.game = newGameState();
  room.players.forEach(player => { player.hand = []; });
}

function publicStateFor(room, index, lastAction) {
  const me = room.players[index];
  if (!me) return null;

  const connectedCount = activePlayers(room).length;
  const isAttacker = index === room.game.attackerIndex;
  const isDefender = index === room.game.defenderIndex;
  const attackRanks = uniqueTableValues(room);
  const attackLimit = currentAttackLimit(room);

  let statusText = `🟡 Игроков ${connectedCount}/${room.maxPlayers}`;

  if (room.game.status === 'playing') {
    // Раньше здесь проверялось room.game.turn === 'defender', но в текущей
    // модели (любой не-защищающийся может подкинуть карту в любой момент)
    // ход 'turn' всегда остаётся 'attacker' — 'defender' никогда не
    // выставляется. Поэтому статус защищающегося раньше ВСЕГДА показывал
    // "Соперник защищается", даже когда реально нужно было защищаться
    // самому. Определяем состояние через hasUndefended(), как и остальная
    // логика игры.
    const hasOpenDefense = hasUndefended(room);
    if (isDefender) {
      statusText = hasOpenDefense
        ? '🟢 Ваш ход — защищайтесь'
        : '🔴 Соперник атакует';
    } else if (me.hand.length === 0 && room.game.deck.length === 0) {
      statusText = '🏆 Вы закончили карты — ждите окончания игры';
    } else if (isAttacker || room.game.table.length > 0) {
      statusText = '🟢 Ваш ход — атакуйте';
    } else {
      statusText = '⏳ Ждите атаки';
    }
  }

  if (room.game.status === 'paused') {
    statusText = '⏸️ Игрок отключился. Ждём переподключения...';
  }

  if (room.game.status === 'finished') {
    if (room.game.loserIndex === null) {
      statusText = '🤝 ' + room.game.resultText;
    } else if (room.game.loserIndex === index) {
      statusText = '💀 Вы проиграли!';
    } else {
      statusText = '🏆 Вы закончили игру!';
    }
  }

  return {
    roomCode: room.code,
    playersConnected: connectedCount,
    playersTotal: room.players.length,
    maxPlayers: room.maxPlayers,
    myIndex: index,
    myHand: me.hand || [],
    players: room.players.map((player, playerIndex) => ({
      index: playerIndex,
      name: player.name || `Игрок ${playerIndex + 1}`,
      connected: Boolean(player.socketId),
      cardCount: player.hand.length,
      isMe: playerIndex === index,
      isAttacker: playerIndex === room.game.attackerIndex,
      isDefender: playerIndex === room.game.defenderIndex
    })),
    gameMode: room.mode,
    gameModeLabel: MODE_CONFIG[room.mode]?.label || MODE_CONFIG[DEFAULT_MODE].label,
    trumpCard: room.game.trumpCard,
    deckCount: room.game.deck.length,
    discardCount: room.game.discard.length,
    discardPreview: room.game.discardPreview.slice(-6),
    table: room.game.table,
    status: room.game.status,
    statusText,
    turn: room.game.turn,
    attackerIndex: room.game.attackerIndex,
    defenderIndex: room.game.defenderIndex,
    turnDeadline: room.game.turnDeadline,
    roundStartedAt: room.game.roundStartedAt,
    matchStartedAt: room.game.matchStartedAt,
    isMyTurn: room.game.status === 'playing' &&
      (isDefender ? hasUndefended(room) : me.hand.some(card => canAttack(room, index, card))),
    role: isDefender ? 'Защищающийся' : 'Атакующий',
    canPass: room.game.status === 'playing' &&
      !isDefender &&
      room.game.turn === 'attacker' &&
      room.game.table.length > 0 &&
      !hasUndefended(room),
    canTake: room.game.status === 'playing' &&
      isDefender &&
      room.game.table.length > 0 &&
      hasUndefended(room),
    canRestart: room.game.status === 'finished' && allPlayersPresent(room),
    attackRanks,
    attackCount: room.game.table.length,
    attackLimit,
    roundNumber: room.game.roundNumber + 1,
    winnerIndex: room.game.winnerIndex,
    loserIndex: room.game.loserIndex,
    resultText: room.game.resultText,
    lastAction
  };
}

function sendGameState(room, lastAction = null) {
  room.players.forEach((player, index) => {
    if (!player.socketId) return;
    const state = publicStateFor(room, index, lastAction);
    if (state) io.to(player.socketId).emit('updateState', state);
  });
}

function roomInfo(room) {
  return {
    code: room.code,
    players: room.players.filter(player => player.socketId).length,
    maxPlayers: room.maxPlayers,
    mode: room.mode,
    modeLabel: MODE_CONFIG[room.mode]?.label || MODE_CONFIG[DEFAULT_MODE].label,
    status: room.game.status === 'playing' || room.game.status === 'paused'
      ? 'playing'
      : room.game.status
  };
}

function openRoomList() {
  return [...rooms.values()]
    .map(roomInfo)
    .filter(room => room.status === 'waiting' && room.players < room.maxPlayers)
    .sort((a, b) => a.code.localeCompare(b.code));
}

function broadcastRoomList() {
  io.emit('roomList', openRoomList());
}

function sendLobby(socket, message = '') {
  socket.emit('roomLobby', {
    rooms: openRoomList(),
    message
  });
}

function removeRoom(room) {
  if (!rooms.has(room.code)) return;
  clearTurnTimer(room);
  clearTimeout(room.emptyTimer);
  for (const timer of room.reconnectTimers.values()) clearTimeout(timer);
  room.reconnectTimers.clear();
  rooms.delete(room.code);
  broadcastRoomList();
}

function leaveCurrentRoom(socket, reason = 'leave') {
  const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : null;

  if (!room) {
    socket.data.roomCode = null;
    return;
  }

  const player = playerBySocket(room, socket.id);

  if (player) {
    const timer = room.reconnectTimers.get(player.userId);
    if (timer) {
      clearTimeout(timer);
      room.reconnectTimers.delete(player.userId);
    }

    room.players = room.players.filter(item => item !== player);

    if (room.players.length === 0) {
      removeRoom(room);
    } else if (room.game.status === 'playing') {
      room.game.status = 'paused';
      sendGameState(room, 'disconnect');
    }
  }

  socket.leave(room.code);
  socket.data.roomCode = null;

  if (reason === 'leave' || reason === 'switch') {
    const remaining = [...room.players];
    removeRoom(room);

    for (const p of remaining) {
      if (!p.socketId) continue;
      const other = io.sockets.sockets.get(p.socketId);
      if (!other) continue;

      other.data.roomCode = null;
      other.leave(room.code);
      other.emit('roomClosed', 'Комната закрыта, потому что игрок вышел.');
      sendLobby(other);
    }
  } else {
    broadcastRoomList();
  }
}

function joinRoom(socket, payload) {
  const userId = typeof payload === 'string' ? payload : payload?.userId;
  const name = typeof payload === 'object' && payload?.name
    ? String(payload.name).slice(0, 20)
    : 'Игрок';
  const requestedCode = normalizeRoomCode(
    typeof payload === 'object' ? payload?.roomCode : ''
  );

  if (typeof userId !== 'string' || !userId.trim() || userId.length > 128) {
    return socket.emit('roomError', 'Не удалось определить игрока.');
  }

  const room = rooms.get(requestedCode);
  if (!room) {
    return socket.emit('roomError', 'Комната не найдена.');
  }

  let player = room.players.find(p => p.userId === userId);
  if (!player && room.players.length >= room.maxPlayers) {
    return socket.emit('roomError', `Комната уже заполнена (${room.maxPlayers}/${room.maxPlayers}).`);
  }
  if (socket.data.roomCode === requestedCode && socket.data.userId !== userId) {
    return socket.emit('roomError', 'Вы уже вошли в эту комнату.');
  }
  if (socket.data.roomCode && socket.data.roomCode !== requestedCode) {
    leaveCurrentRoom(socket, 'switch');
  }

  if (player) {
    if (player.socketId && player.socketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(player.socketId);
      if (oldSocket) oldSocket.disconnect(true);
    }

    const timer = room.reconnectTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      room.reconnectTimers.delete(userId);
    }

    player.socketId = socket.id;
    player.name = name || player.name;
  } else {
    if (room.players.length >= room.maxPlayers) {
      return socket.emit('roomError', `Комната уже заполнена (${room.maxPlayers}/${room.maxPlayers}).`);
    }

    player = {
      userId,
      name,
      socketId: socket.id,
      hand: []
    };

    room.players.push(player);
  }

  socket.data.roomCode = room.code;
  clearTimeout(room.emptyTimer);
  room.emptyTimer = null;
  socket.data.userId = userId;
  socket.join(room.code);

  if (room.players.length === room.maxPlayers && room.game.status === 'waiting') {
    startGame(room);
  } else if (room.game.status === 'paused' && allPlayersPresent(room)) {
    room.game.status = 'playing';
    scheduleTurnTimer(room);
    sendGameState(room, 'reconnect');
  } else {
    sendGameState(room, 'reconnect');
  }

  broadcastRoomList();
  socket.emit('joinedRoom', { code: room.code });
}

io.on('connection', socket => {
  sendLobby(socket);

  socket.on('getRooms', () => sendLobby(socket));

  socket.on('createRoom', payload => {
    const room = createRoom(payload);
    socket.emit('roomCreated', { code: room.code });
  });

  socket.on('joinRoom', payload => joinRoom(socket, payload));

  socket.on('leaveRoom', () => {
    leaveCurrentRoom(socket, 'leave');
    sendLobby(socket, 'Вы вышли из комнаты.');
  });

  socket.on('restartGame', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;

    const index = playerIndexBySocket(room, socket.id);
    if (index === -1 || !allPlayersPresent(room)) return;
    if (room.game.status !== 'finished') return;

    resetAfterFinished(room);
    startGame(room);
  });

  socket.on('playCard', cardIndex => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.game.status !== 'playing') return;

    const index = playerIndexBySocket(room, socket.id);
    const player = room.players[index];

    if (!player || !Number.isInteger(cardIndex)) return sendGameState(room);

    const card = player.hand[cardIndex];
    if (!card) return sendGameState(room);

    if (index === room.game.defenderIndex && hasUndefended(room)) {
      const pair = room.game.table.find(item => item.defend === null);

      if (!pair || !canDefend(pair.attack, card, room.game.trumpCard?.suit)) {
        return sendGameState(room);
      }

      pair.defend = player.hand.splice(cardIndex, 1)[0];
      // After defending, if all cards are defended, turn goes to attacker
      // If there are still undefended cards, attacker can continue or defender can defend more
      if (!hasUndefended(room)) {
        room.game.turn = 'attacker';
      }
      scheduleTurnTimer(room);
      sendGameState(room, 'defend');
      return;
    }

    if (index !== room.game.defenderIndex && room.game.turn === 'attacker') {
      if (!canAttack(room, index, card)) return sendGameState(room);

      const attackCard = player.hand.splice(cardIndex, 1)[0];
      room.game.table.push({
        attack: attackCard,
        defend: null
      });
      // Keep turn as 'attacker' to allow multiple cards in sequence
      // Defender can still defend at any time when there are undefended cards
      scheduleTurnTimer(room);
      sendGameState(room, 'play');
      return;
    }

    return sendGameState(room);
  });

  socket.on('bito', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.game.status !== 'playing') return;

    const index = playerIndexBySocket(room, socket.id);

    // In podkidnoy, any attacker (non-defender) can say bito when all cards are defended
    const isAttacker = index >= 0 && index !== room.game.defenderIndex;

    if (
      !isAttacker ||
      room.game.turn !== 'attacker' ||
      room.game.table.length === 0 ||
      hasUndefended(room)
    ) {
      return sendGameState(room);
    }

    clearTurnTimer(room);

    if (!performBito(room)) return sendGameState(room);

    if (!checkGameOver(room)) {
      scheduleTurnTimer(room);
      sendGameState(room, 'bito');
    } else {
      sendGameState(room, 'gameOver');
    }
  });

  socket.on('take', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.game.status !== 'playing') return;

    const index = playerIndexBySocket(room, socket.id);

    if (
      index !== room.game.defenderIndex ||
      room.game.table.length === 0 ||
      !hasUndefended(room)
    ) {
      return sendGameState(room);
    }

    clearTurnTimer(room);

    if (!performTake(room)) return sendGameState(room);

    if (!checkGameOver(room)) {
      scheduleTurnTimer(room);
      sendGameState(room, 'take');
    } else {
      sendGameState(room, 'gameOver');
    }
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    const userId = socket.data.userId;
    const room = roomCode ? rooms.get(roomCode) : null;

    if (!room) return;

    const player = playerBySocket(room, socket.id);
    if (!player) return;

    player.socketId = null;

    if (room.game.status === 'playing') {
      clearTurnTimer(room);
      room.game.status = 'paused';
    }
    sendGameState(room, 'disconnect');

    const timer = setTimeout(() => {
      const currentRoom = rooms.get(roomCode);
      if (!currentRoom) return;

      const current = currentRoom.players.find(p => p.userId === userId);

      if (current && !current.socketId) {
        currentRoom.players = currentRoom.players.filter(p => p !== current);

        const remaining = currentRoom.players.filter(p => p.socketId);
        for (const p of remaining) {
          const other = io.sockets.sockets.get(p.socketId);
          if (!other) continue;

          other.data.roomCode = null;
          other.leave(roomCode);
          other.emit('roomClosed', 'Комната закрыта: соперник вышел.');
          sendLobby(other);
        }

        removeRoom(currentRoom);
      }

      currentRoom?.reconnectTimers.delete(userId);
    }, RECONNECT_GRACE_MS);

    room.reconnectTimers.set(userId, timer);
    broadcastRoomList();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const addresses = [];

  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list || []) {
      if (info.family === 'IPv4' && !info.internal) addresses.push(info.address);
    }
  }

  console.log('\n====================================');
  console.log(`Дурак сервер запущен на порту ${PORT}`);
  console.log(`На этом ПК: http://localhost:${PORT}`);
  addresses.forEach(ip => console.log(`В LAN:     http://${ip}:${PORT}`));
  console.log('Комнаты: 2–4 игрока');
  console.log('====================================\n');
});

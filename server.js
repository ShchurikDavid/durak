const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 2;
const HAND_SIZE = 6;
const RECONNECT_GRACE_MS = 60_000;
const ROOM_CODE_LENGTH = 5;

const suits = ['S', 'H', 'D', 'C'];
const ALL_VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const MODE_CONFIG = {
  '24': { label: '24 карты', values: ['9', '10', 'J', 'Q', 'K', 'A'], jokers: false },
  '36': { label: '36 карт', values: ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'], jokers: false },
  '52': { label: '52 карты', values: ALL_VALUES, jokers: false },
  '54': { label: '52 карты + 🃏 джокеры', values: ALL_VALUES, jokers: true }
};
const DEFAULT_MODE = '36';
// Раньше здесь не было 2, 3, 4 и 5. В режимах «52 карты» и «52 + джокеры»
// их ранг был undefined, поэтому такими картами нельзя было ни побить,
// ни корректно определить первого атакующего.
const valueRank = {
  '2': 2, '3': 3, '4': 4, '5': 5,
  '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14
};

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/*
  Все игры изолированы по комнатам:
  rooms = Map<ROOM_CODE, { code, players, game, reconnectTimers }>
*/
const rooms = new Map();

function newGameState() {
  return {
    status: 'waiting',
    deck: [],
    trumpCard: null,
    table: [],
    attackerIndex: 0,
    defenderIndex: 1,
    turn: 'attacker',
    winnerIndex: null,
    loserIndex: null,
    resultText: '',
    mode: DEFAULT_MODE
  };
}

function normalizeMode(value) {
  const mode = String(value || DEFAULT_MODE);
  return MODE_CONFIG[mode] ? mode : DEFAULT_MODE;
}

function createRoom(mode = DEFAULT_MODE) {
  let code;
  do {
    code = crypto.randomBytes(4).toString('hex').slice(0, ROOM_CODE_LENGTH).toUpperCase();
  } while (rooms.has(code));

  const room = {
    code,
    mode: normalizeMode(mode),
    players: [],
    game: newGameState(),
    reconnectTimers: new Map()
  };

  rooms.set(code, room);
  broadcastRoomList();
  return room;
}

function normalizeRoomCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
}

function roomInfo(room) {
  return {
    code: room.code,
    players: room.players.filter(p => p.socketId).length,
    maxPlayers: MAX_PLAYERS,
    mode: room.mode,
    modeLabel: MODE_CONFIG[room.mode]?.label || MODE_CONFIG[DEFAULT_MODE].label,
    status: room.game.status === 'playing' || room.game.status === 'paused'
      ? 'playing'
      : room.game.status
  };
}

function broadcastRoomList() {
  // Показываем только те комнаты, куда реально можно войти.
  // Раньше в общий список попадали заполненные и идущие партии.
  io.emit('roomList', openRoomList());
}

function removeRoom(room) {
  if (!rooms.has(room.code)) return;
  for (const timer of room.reconnectTimers.values()) clearTimeout(timer);
  room.reconnectTimers.clear();
  rooms.delete(room.code);
  broadcastRoomList();
}

function maybeRemoveEmptyRoom(room) {
  if (room.players.length === 0) removeRoom(room);
}

function playerBySocket(room, socketId) {
  return room.players.find(p => p.socketId === socketId);
}

function playerIndexBySocket(room, socketId) {
  return room.players.findIndex(p => p.socketId === socketId);
}

function bothPlayersPresent(room) {
  return room.players.length === MAX_PLAYERS &&
    room.players.every(p => Boolean(p.socketId));
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
    deck.push({ suit: 'JOKER_RED', val: 'JOKER_RED', code: 'JOKER_RED', color: 'red', joker: true });
    deck.push({ suit: 'JOKER_BLACK', val: 'JOKER_BLACK', code: 'JOKER_BLACK', color: 'black', joker: true });
  }

  return shuffle(deck);
}

function hasUndefended(room) {
  return room.game.table.some(pair => pair.defend === null);
}

function tableValues(room) {
  return room.game.table.flatMap(pair => {
    const result = [pair.attack.val];
    if (pair.defend) result.push(pair.defend.val);
    return result;
  });
}

function maxAttackCards(room) {
  const defender = room.players[room.game.defenderIndex];
  return defender ? Math.min(HAND_SIZE, defender.hand.length) : 0;
}

function canAttack(room, card) {
  if (room.game.table.length === 0) return true;
  if (room.game.table.length >= maxAttackCards(room)) return false;
  return tableValues(room).includes(card.val);
}

function canDefend(attack, defend, trumpSuit) {
  // В режиме 52 + джокеры: красный джокер бьёт любую красную карту,
  // чёрный джокер — любую чёрную. Джокер не может бить сам джокер.
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

function dealCards(room) {
  const order = [room.game.attackerIndex, room.game.defenderIndex];

  for (const index of order) {
    const player = room.players[index];
    if (!player) continue;

    while (player.hand.length < HAND_SIZE && room.game.deck.length > 0) {
      player.hand.push(room.game.deck.pop());
    }
  }
}

function determineFirstAttacker(room) {
  const trumpSuit = room.game.trumpCard.suit;
  let lowestRank = Infinity;
  let attacker = Math.floor(Math.random() * MAX_PLAYERS);

  room.players.forEach((player, index) => {
    for (const card of player.hand) {
      if (card.suit === trumpSuit && valueRank[card.val] < lowestRank) {
        lowestRank = valueRank[card.val];
        attacker = index;
      }
    }
  });

  room.game.attackerIndex = attacker;
  room.game.defenderIndex = (attacker + 1) % MAX_PLAYERS;
}

function startGame(room) {
  room.game = newGameState();
  room.game.status = 'playing';
  room.game.deck = createDeck(room.mode);
  // Джокер не может стать козырем. Если после перемешивания он оказался
  // первым, меняем его местами с первой обычной картой.
  const trumpIndex = room.game.deck.findIndex(card => !card.joker);
  if (trumpIndex > 0) {
    [room.game.deck[0], room.game.deck[trumpIndex]] = [room.game.deck[trumpIndex], room.game.deck[0]];
  }
  room.game.trumpCard = room.game.deck[0] || null;


  room.players.forEach(p => { p.hand = []; });
  dealCards(room);
  determineFirstAttacker(room);
  room.game.turn = 'attacker';

  sendGameState(room, 'start');
}

function finishGame(room, winnerIndex, loserIndex, text) {
  room.game.status = 'finished';
  room.game.winnerIndex = winnerIndex;
  room.game.loserIndex = loserIndex;
  room.game.resultText = text;
  room.game.turn = null;
}

function checkGameOver(room) {
  if (room.game.deck.length > 0) return false;

  const empty = room.players
    .map((p, i) => p.hand.length === 0 ? i : -1)
    .filter(i => i !== -1);

  if (empty.length === 2) {
    finishGame(room, null, null, 'Ничья — карты закончились у обоих!');
    return true;
  }

  if (empty.length === 1) {
    const winner = empty[0];
    const loser = winner === 0 ? 1 : 0;
    finishGame(
      room,
      winner,
      loser,
      `Победил ${room.players[winner].name || `Игрок ${winner + 1}`}!`
    );
    return true;
  }

  return false;
}

function resetAfterFinished(room) {
  room.game = newGameState();
  room.players.forEach(p => { p.hand = []; });
}

function publicStateFor(room, index, lastAction) {
  const me = room.players[index];
  const opponent = room.players[index === 0 ? 1 : 0];
  if (!me) return null;

  const isAttacker = index === room.game.attackerIndex;
  const isDefender = index === room.game.defenderIndex;

  let statusText = room.players.length < MAX_PLAYERS
    ? `🟡 Комната ${room.code} — ждём второго игрока`
    : 'Ожидание...';

  if (room.game.status === 'playing') {
    if (isAttacker) {
      statusText = room.game.turn === 'attacker'
        ? '🟢 Вы атакуете — ваш ход'
        : '🔴 Защищается соперник';
    } else if (isDefender) {
      statusText = room.game.turn === 'defender'
        ? '🟢 Вы защищаетесь'
        : '🔴 Соперник атакует';
    }
  }

  if (room.game.status === 'paused') {
    statusText = '⏸️ Соперник отключился. Ждем переподключения...';
  }

  if (room.game.status === 'finished') {
    if (room.game.winnerIndex === null) {
      statusText = '🤝 ' + room.game.resultText;
    } else if (room.game.winnerIndex === index) {
      statusText = '🏆 Вы победили!';
    } else {
      statusText = '💀 Вы проиграли!';
    }
  }

  return {
    roomCode: room.code,
    playersConnected: room.players.filter(p => p.socketId).length,
    playersTotal: room.players.length,
    myHand: me.hand || [],
    opponentCardCount: opponent?.hand.length || 0,
    gameMode: room.mode,
    gameModeLabel: MODE_CONFIG[room.mode]?.label || MODE_CONFIG[DEFAULT_MODE].label,
    opponentConnected: Boolean(opponent?.socketId),
    trumpCard: room.game.trumpCard,
    deckCount: room.game.deck.length,
    table: room.game.table,
    status: room.game.status,
    statusText,
    turn: room.game.turn,
    isMyTurn:
      room.game.status === 'playing' &&
      (
        (isAttacker && room.game.turn === 'attacker') ||
        (isDefender && room.game.turn === 'defender')
      ),
    role: isAttacker ? 'Атакующий' : isDefender ? 'Защищающийся' : 'Игрок',
    canPass:
      room.game.status === 'playing' &&
      isAttacker &&
      room.game.turn === 'attacker' &&
      room.game.table.length > 0 &&
      !hasUndefended(room),
    canTake:
      room.game.status === 'playing' &&
      isDefender &&
      room.game.turn === 'defender' &&
      room.game.table.length > 0 &&
      hasUndefended(room),
    canRestart: room.game.status === 'finished',
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

function openRoomList() {
  return [...rooms.values()]
    .map(roomInfo)
    .filter(r => r.status === 'waiting' && r.players < MAX_PLAYERS)
    .sort((a, b) => a.code.localeCompare(b.code));
}

function sendRoomListTo(socket) {
  socket.emit('roomList', openRoomList());
}

function sendLobby(socket, message = '') {
  socket.emit('roomLobby', {
    rooms: openRoomList(),
    message
  });
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

    room.players = room.players.filter(p => p !== player);

    // Если один из игроков реально вышел из комнаты, текущая партия для оставшегося
    // больше не продолжается. Саму комнату можно использовать снова только если
    // в ней остался игрок — она удалится, когда уйдет последний.
    if (room.players.length === 1 && room.game.status === 'playing') {
      room.game.status = 'paused';
      sendGameState(room, 'disconnect');
    }
  }

  socket.leave(room.code);
  socket.data.roomCode = null;

  // При явном выходе комната закрывается целиком. Это предотвращает
  // накопление старых комнат: если игрок покинул комнату, она больше
  // не появляется в общем списке.
  if (reason === 'leave' || reason === 'switch') {
    const remaining = [...room.players];
    removeRoom(room);

    for (const p of remaining) {
      if (p.socketId) {
        const other = io.sockets.sockets.get(p.socketId);
        if (other) {
          other.data.roomCode = null;
          other.leave(room.code);
          other.emit('roomClosed', 'Комната закрыта, потому что игрок вышел.');
          sendLobby(other);
        }
      }
    }
  } else {
    maybeRemoveEmptyRoom(room);
    broadcastRoomList();
  }
}

function joinRoom(socket, payload) {
  const userId = typeof payload === 'string' ? payload : payload?.userId;
  const name = typeof payload === 'object' && payload?.name
    ? String(payload.name).slice(0, 20)
    : 'Игрок';
  const requestedCode = normalizeRoomCode(typeof payload === 'object' ? payload?.roomCode : '');

  if (!userId) return socket.emit('roomError', 'Не удалось определить игрока.');

  // Один сокет может быть только в одной комнате.
  if (socket.data.roomCode && socket.data.roomCode !== requestedCode) {
    leaveCurrentRoom(socket, 'switch');
  }

  let room = rooms.get(requestedCode);
  if (!room) {
    return socket.emit('roomError', 'Комната не найдена.');
  }

  // Если этот пользователь уже числится в комнате, восстанавливаем соединение.
  let player = room.players.find(p => p.userId === userId);

  if (player) {
    // Если тот же userId открыт в другой вкладке/устройстве — старый сокет отключаем.
    if (player.socketId && player.socketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(player.socketId);
      if (oldSocket) oldSocket.disconnect(true);
      player.socketId = null;
    }

    const timer = room.reconnectTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      room.reconnectTimers.delete(userId);
    }

    player.socketId = socket.id;
    player.name = name || player.name;
  } else {
    const activePlayers = room.players.filter(p => p.socketId).length;
    if (activePlayers >= MAX_PLAYERS || room.players.length >= MAX_PLAYERS) {
      return socket.emit('roomError', 'Комната уже заполнена (2/2).');
    }

    player = { userId, name, socketId: socket.id, hand: [] };
    room.players.push(player);
  }

  socket.data.roomCode = room.code;
  socket.data.userId = userId;
  socket.join(room.code);

  if (room.players.length === MAX_PLAYERS && room.game.status === 'waiting') {
    startGame(room);
  } else if (room.game.status === 'paused' && bothPlayersPresent(room)) {
    room.game.status = 'playing';
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

  socket.on('createRoom', mode => {
    const room = createRoom(mode);
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
    if (index === -1 || !bothPlayersPresent(room)) return;
    if (room.game.status !== 'finished') return;
    resetAfterFinished(room);
    startGame(room);
  });

  socket.on('playCard', cardIndex => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.game.status !== 'playing') return sendGameState(room);

    const index = playerIndexBySocket(room, socket.id);
    const player = room.players[index];

    if (!player || !Number.isInteger(cardIndex)) return sendGameState(room);

    const isAttacker = index === room.game.attackerIndex && room.game.turn === 'attacker';
    const isDefender = index === room.game.defenderIndex && room.game.turn === 'defender';
    if (!isAttacker && !isDefender) return sendGameState(room);

    const card = player.hand[cardIndex];
    if (!card) return sendGameState(room);

    if (isAttacker) {
      if (!canAttack(room, card)) return sendGameState(room);

      const attackCard = player.hand.splice(cardIndex, 1)[0];
      room.game.table.push({ attack: attackCard, defend: null });
      room.game.turn = 'defender';
      sendGameState(room, 'play');
      return;
    }

    if (isDefender) {
      const pair = room.game.table.find(p => p.defend === null);
      if (!pair || !canDefend(pair.attack, card, room.game.trumpCard?.suit)) {
        return sendGameState(room);
      }

      pair.defend = player.hand.splice(cardIndex, 1)[0];
      room.game.turn = 'attacker';
      sendGameState(room, 'defend');
    }
  });

  socket.on('bito', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.game.status !== 'playing') return;

    const index = playerIndexBySocket(room, socket.id);
    if (
      index !== room.game.attackerIndex ||
      room.game.turn !== 'attacker' ||
      room.game.table.length === 0 ||
      hasUndefended(room)
    ) return sendGameState(room);

    room.game.table = [];

    // По правилам первым добирает карты тот, кто атаковал в этом круге,
    // поэтому раздаём до смены ролей, а не после.
    dealCards(room);

    const oldAttacker = room.game.attackerIndex;
    room.game.attackerIndex = room.game.defenderIndex;
    room.game.defenderIndex = oldAttacker;
    room.game.turn = 'attacker';

    if (!checkGameOver(room)) sendGameState(room, 'bito');
    else sendGameState(room, 'gameOver');
  });

  socket.on('take', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.game.status !== 'playing') return;

    const index = playerIndexBySocket(room, socket.id);
    if (
      index !== room.game.defenderIndex ||
      room.game.turn !== 'defender' ||
      room.game.table.length === 0 ||
      !hasUndefended(room)
    ) return sendGameState(room);

    const defender = room.players[index];
    for (const pair of room.game.table) {
      defender.hand.push(pair.attack);
      if (pair.defend) defender.hand.push(pair.defend);
    }

    room.game.table = [];
    room.game.turn = 'attacker';
    dealCards(room);

    if (!checkGameOver(room)) sendGameState(room, 'take');
    else sendGameState(room, 'gameOver');
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    const userId = socket.data.userId;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!room) return;

    const player = playerBySocket(room, socket.id);
    if (!player) return;

    // Не удаляем игрока мгновенно: даем 60 секунд на восстановление связи.
    player.socketId = null;

    if (room.game.status === 'playing') {
      room.game.status = 'paused';
      sendGameState(room, 'disconnect');
    }

    const timer = setTimeout(() => {
      const currentRoom = rooms.get(roomCode);
      if (!currentRoom) return;

      const current = currentRoom.players.find(p => p.userId === userId);
      if (current && !current.socketId) {
        currentRoom.players = currentRoom.players.filter(p => p !== current);

        // После окончания окна переподключения комната закрывается,
        // даже если в ней остался один игрок. Так список комнат не засоряется.
        const remaining = currentRoom.players.filter(p => p !== current);
        for (const p of remaining) {
          if (p.socketId) {
            const other = io.sockets.sockets.get(p.socketId);
            if (other) {
              other.data.roomCode = null;
              other.leave(roomCode);
              other.emit('roomClosed', 'Комната закрыта: соперник вышел.');
              sendLobby(other);
            }
          }
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
  console.log('Комнаты: включены');
  console.log('====================================\n');
});

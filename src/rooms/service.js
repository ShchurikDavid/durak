const crypto = require('node:crypto');
const {
  ROOM_CODE_LENGTH,
  RECONNECT_GRACE_MS,
  MODE_CONFIG,
  DEFAULT_MODE,
  GAME_TYPES
} = require('../config');
const { newGameState } = require('../game/state');
const {
  normalizeMode,
  normalizePlayerCount,
  normalizeRoomCode,
  playerBySocket
} = require('../game/rules');
const { publicStateFor } = require('../game/public-state');
const { createGameEngine } = require('../game/engine');

function createRoomService(
  io,
  {
    setTimeout = globalThis.setTimeout,
    clearTimeout = globalThis.clearTimeout,
    random = Math.random
  } = {}
) {
  const rooms = new Map();
  const engine = createGameEngine({
    onState: sendGameState,
    hasRoom: (code) => rooms.has(code),
    setTimeout,
    clearTimeout,
    random
  });
  const { clearTurnTimer, startGame, scheduleTurnTimer } = engine;
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
      gameType: data.gameType === 'transfer' ? 'transfer' : 'throwIn',
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
      players: room.players.filter((player) => player.socketId).length,
      maxPlayers: room.maxPlayers,
      mode: room.mode,
      gameType: room.gameType,
      gameTypeLabel: GAME_TYPES[room.gameType],
      modeLabel: MODE_CONFIG[room.mode]?.label || MODE_CONFIG[DEFAULT_MODE].label,
      status: ['playing', 'paused', 'timeout'].includes(room.game.status)
        ? 'playing'
        : room.game.status
    };
  }

  function openRoomList() {
    return [...rooms.values()]
      .map(roomInfo)
      .filter((room) => room.status === 'waiting' && room.players < room.maxPlayers)
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
    engine.clearTimeoutTimer(room);
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

    if (player?.surrendered) {
      player.socketId = null;
      socket.leave(room.code);
      socket.data.roomCode = null;
      sendGameState(room, 'disconnect');
      return;
    }

    if (player) {
      const timer = room.reconnectTimers.get(player.userId);
      if (timer) {
        clearTimeout(timer);
        room.reconnectTimers.delete(player.userId);
      }

      room.players = room.players.filter((item) => item !== player);

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
    const name =
      typeof payload === 'object' && payload?.name ? String(payload.name).slice(0, 20) : 'Игрок';
    const requestedCode = normalizeRoomCode(typeof payload === 'object' ? payload?.roomCode : '');

    if (typeof userId !== 'string' || !userId.trim() || userId.length > 128) {
      return socket.emit('roomError', 'Не удалось определить игрока.');
    }

    const room = rooms.get(requestedCode);
    if (!room) {
      return socket.emit('roomError', 'Комната не найдена.');
    }

    let player = room.players.find((p) => p.userId === userId);
    if (!player && room.players.length >= room.maxPlayers) {
      return socket.emit(
        'roomError',
        `Комната уже заполнена (${room.maxPlayers}/${room.maxPlayers}).`
      );
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
        return socket.emit(
          'roomError',
          `Комната уже заполнена (${room.maxPlayers}/${room.maxPlayers}).`
        );
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
    } else if (
      room.game.status === 'paused' &&
      room.players.every((p) => p.surrendered || p.socketId)
    ) {
      room.game.status = 'playing';
      scheduleTurnTimer(room);
      sendGameState(room, 'reconnect');
    } else {
      sendGameState(room, 'reconnect');
    }

    broadcastRoomList();
    socket.emit('joinedRoom', { code: room.code });
  }
  function disconnectPlayer(socket) {
    const roomCode = socket.data.roomCode;
    const userId = socket.data.userId;
    const room = roomCode ? rooms.get(roomCode) : null;

    if (!room) return;

    const player = playerBySocket(room, socket.id);
    if (!player) return;

    player.socketId = null;
    if (player.surrendered) {
      sendGameState(room, 'disconnect');
      return;
    }

    if (room.game.status === 'playing') {
      clearTurnTimer(room);
      room.game.status = 'paused';
    }
    sendGameState(room, 'disconnect');

    const timer = setTimeout(() => {
      const currentRoom = rooms.get(roomCode);
      if (!currentRoom) return;

      const current = currentRoom.players.find((p) => p.userId === userId);

      if (current && !current.socketId) {
        currentRoom.players = currentRoom.players.filter((p) => p !== current);

        const remaining = currentRoom.players.filter((p) => p.socketId);
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
  }
  function renamePlayer(userId, name) {
    for (const room of rooms.values()) {
      const player = room.players.find((item) => item.userId === userId);
      if (!player) continue;
      player.name = name;
      sendGameState(room);
    }
  }
  function dispose() {
    for (const room of [...rooms.values()]) removeRoom(room);
  }
  return {
    rooms,
    engine,
    createRoom,
    sendGameState,
    roomInfo,
    openRoomList,
    broadcastRoomList,
    sendLobby,
    removeRoom,
    leaveCurrentRoom,
    joinRoom,
    disconnectPlayer,
    renamePlayer,
    dispose
  };
}
module.exports = { createRoomService };

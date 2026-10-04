const {
  playerIndexBySocket,
  allPlayersPresent,
  hasUndefended,
  canAttack,
  canDefend,
  canTransfer,
  nextPlayerIndex
} = require('../game/rules');

function registerSocketHandlers(io, service) {
  const {
    rooms,
    sendLobby,
    createRoom,
    joinRoom,
    leaveCurrentRoom,
    sendGameState,
    disconnectPlayer
  } = service;
  const {
    resetAfterFinished,
    startGame,
    scheduleTurnTimer,
    clearTurnTimer,
    performSurrender,
    performBito,
    performTake,
    checkGameOver
  } = service.engine;
  io.on('connection', (socket) => {
    sendLobby(socket);

    socket.on('getRooms', () => sendLobby(socket));

    let lastRoomCreated = 0;
    socket.on('createRoom', (payload) => {
      if (rooms.size >= 500 || Date.now() - lastRoomCreated < 5000)
        return socket.emit('roomError', 'Слишком много комнат. Попробуйте позже.');
      lastRoomCreated = Date.now();
      const room = createRoom(payload);
      socket.emit('roomCreated', { code: room.code });
    });

    socket.on('joinRoom', (payload) => {
      const identity = socket.data.identity;
      if (!identity) return joinRoom(socket, payload);
      const name = identity.name || payload?.name || 'Игрок';
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        name.trim().length > 20 ||
        /[\x00-\x1f\x7f]/.test(name)
      )
        return socket.emit('roomError', 'Введите ник от 1 до 20 символов.');
      joinRoom(socket, {
        roomCode: payload?.roomCode,
        userId: identity.player_id,
        name: name.trim()
      });
    });

    socket.on('leaveRoom', () => {
      const room = rooms.get(socket.data.roomCode);
      const player = room?.players[playerIndexBySocket(room, socket.id)];
      if (
        room &&
        player &&
        !['waiting', 'finished'].includes(room.game.status) &&
        !player.surrendered
      ) {
        socket.emit('roomError', 'Сначала нажмите «Сдаться», затем можно выйти.');
        return sendGameState(room);
      }
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

    socket.on('playCard', (cardIndex) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.game.status !== 'playing') return;

      const index = playerIndexBySocket(room, socket.id);
      const player = room.players[index];

      if (!player || !Number.isInteger(cardIndex)) return sendGameState(room);

      const card = player.hand[cardIndex];
      if (!card) return sendGameState(room);

      if (index === room.game.defenderIndex && hasUndefended(room)) {
        const pair = room.game.table.find((item) => item.defend === null);

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

        if (room.game.table.length === 0) room.game.roundAttackerIndex = index;
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

    socket.on('transferCard', (cardIndex) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.game.status !== 'playing') return;
      const index = playerIndexBySocket(room, socket.id);
      const player = room.players[index];
      if (
        !player ||
        !Number.isInteger(cardIndex) ||
        !canTransfer(room, index, player.hand[cardIndex])
      ) {
        return sendGameState(room);
      }
      const next = nextPlayerIndex(room, index);
      room.game.table.push({ attack: player.hand.splice(cardIndex, 1)[0], defend: null });
      room.game.attackerIndex = index;
      room.game.defenderIndex = next;
      scheduleTurnTimer(room);
      sendGameState(room, 'transfer');
    });

    for (const [event, resume] of [
      ['voteTimeout', false],
      ['voteResume', true]
    ]) {
      socket.on(event, () => {
        const room = rooms.get(socket.data.roomCode);
        if (!room) return;
        if (!service.engine.voteTimeout(room, playerIndexBySocket(room, socket.id), resume))
          sendGameState(room);
      });
    }

    socket.on('surrender', () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return;
      const index = playerIndexBySocket(room, socket.id);
      const changed = performSurrender(room, index);
      sendGameState(room, changed ? 'surrender' : null);
    });

    socket.on('bito', () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.game.status !== 'playing') return;

      const index = playerIndexBySocket(room, socket.id);

      // In podkidnoy, any attacker (non-defender) can say bito when all cards are defended
      const isAttacker =
        index >= 0 && !room.players[index].surrendered && index !== room.game.defenderIndex;

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

    socket.on('disconnect', () => disconnectPlayer(socket));
  });
}
module.exports = { registerSocketHandlers };

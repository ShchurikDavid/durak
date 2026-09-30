const { createGameEngine } = require('../src/game/engine');
const { newGameState } = require('../src/game/state');
const { publicStateFor } = require('../src/game/public-state');
const { registerSocketHandlers } = require('../src/socket/handlers');

const commands = new Set([
  'playCard',
  'transferCard',
  'bito',
  'take',
  'voteTimeout',
  'voteResume',
  'surrender',
  'restartGame'
]);
function createBluetoothHost({ name, mode, maxPlayers, gameType, onState, send, close }) {
  let disposed = false;
  let connect;
  const sockets = new Map();
  const room = {
    code: 'BLUETOOTH',
    mode,
    maxPlayers,
    gameType,
    game: newGameState(),
    reconnectTimers: new Map(),
    players: []
  };
  const engine = createGameEngine({ onState: publish, hasRoom: () => !disposed });
  registerSocketHandlers(
    {
      sockets: { sockets },
      on: (_event, fn) => {
        connect = fn;
      }
    },
    {
      rooms: new Map([[room.code, room]]),
      engine,
      sendLobby() {},
      createRoom() {},
      joinRoom() {},
      leaveCurrentRoom() {},
      disconnectPlayer() {},
      sendGameState: publish
    }
  );
  function add(id, nickname) {
    room.players.push({ userId: id, socketId: id, name: nickname, hand: [] });
    const handlers = {};
    const socket = {
      id,
      data: { roomCode: room.code },
      on: (event, fn) => {
        handlers[event] = fn;
      },
      emit() {},
      handlers
    };
    sockets.set(id, socket);
    connect(socket);
  }
  function publish(_room, action = null) {
    if (disposed) return;
    room.players.forEach((player, index) => {
      const state = JSON.parse(
        JSON.stringify({ ...publicStateFor(room, index, action), bluetooth: true })
      );
      if (index === 0) onState(state);
      else send(player.socketId, { type: 'state', state, sentAt: Date.now() });
    });
  }
  function receive(id, packet) {
    if (disposed || !packet || typeof packet !== 'object') return;
    const nickname =
      typeof packet.name === 'string'
        ? packet.name
            .trim()
            .slice(0, 20)
            .replace(/[\x00-\x1f\x7f]/g, '')
        : '';
    if (packet.type === 'hello' && !sockets.has(id)) {
      if (
        packet.version !== 1 ||
        !nickname ||
        room.players.length >= maxPlayers ||
        room.game.status !== 'waiting'
      ) {
        send(id, { type: 'closed', message: 'Стол уже занят или версия приложения отличается.' });
        return;
      }
      add(id, nickname);
      if (room.players.length === maxPlayers) engine.startGame(room);
      else publish();
      return;
    }
    if (!sockets.has(id)) return;
    if (packet.type === 'rename' && nickname) {
      room.players.find((player) => player.socketId === id).name = nickname;
      publish();
    }
    if (packet.type === 'command' && commands.has(packet.event)) {
      if (['playCard', 'transferCard'].includes(packet.event) && !Number.isInteger(packet.payload))
        return;
      sockets.get(id).handlers[packet.event]?.(packet.payload);
      publish();
    }
  }
  function dispose() {
    disposed = true;
    engine.clearTurnTimer(room);
    engine.clearTimeoutTimer(room);
  }
  add('host', name);
  publish();
  return {
    receive,
    send: (event, payload) => receive('host', { type: 'command', event, payload }),
    rename: (value) => receive('host', { type: 'rename', name: value }),
    disconnected(id) {
      if (!sockets.has(id) || disposed) return;
      if (room.game.status === 'waiting') {
        sockets.delete(id);
        room.players = room.players.filter((player) => player.socketId !== id);
        publish();
      } else {
        dispose();
        close('Игрок отключился от Bluetooth. Создайте новую партию.');
      }
    },
    dispose
  };
}
module.exports = { createBluetoothHost };

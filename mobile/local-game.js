// The existing engine and command handlers run locally without HTTP or a WebView.
const { createGameEngine } = require('../src/game/engine');
const { newGameState } = require('../src/game/state');
const { publicStateFor } = require('../src/game/public-state');
const { registerSocketHandlers } = require('../src/socket/handlers');
const { canAttack, canDefend, canTransfer, hasUndefended } = require('../src/game/rules');
const BOT_NAMES = [
  'Мира',
  'Лев',
  'Ася',
  'Макс',
  'Соня',
  'Тимур',
  'Лис',
  'Ника',
  'Рома',
  'Алиса',
  'Марк',
  'Вера',
  'Костя',
  'Яна',
  'Феликс',
  'Злата'
];

function playableIndexes(room, index) {
  if (room.game.status !== 'playing') return [];
  const defending = index === room.game.defenderIndex;
  const attack = room.game.table.find((pair) => !pair.defend)?.attack;
  return room.players[index].hand.flatMap((card, i) =>
    (
      defending
        ? attack && canDefend(attack, card, room.game.trumpCard?.suit)
        : canAttack(room, index, card)
    )
      ? [i]
      : []
  );
}

function createLocalGame({
  name = 'Игрок',
  mode = '36',
  maxPlayers = 2,
  gameType = 'throwIn',
  onState = (_state) => {},
  random = Math.random,
  botDelay = 650,
  setTimeout: later = globalThis.setTimeout,
  clearTimeout: cancel = globalThis.clearTimeout
} = {}) {
  let disposed = false;
  let botTimer;
  let connect;
  const sockets = new Map();
  const availableNames = BOT_NAMES.filter((value) => value !== name);
  const room = {
    code: 'LOCAL',
    mode,
    maxPlayers,
    gameType,
    game: newGameState(),
    reconnectTimers: new Map(),
    players: Array.from({ length: maxPlayers }, (_, index) => ({
      userId: `local-${index}`,
      socketId: `local-${index}`,
      name: index
        ? availableNames.splice(Math.floor(random() * availableNames.length), 1)[0]
        : name,
      isBot: index > 0,
      hand: []
    }))
  };
  const engine = createGameEngine({
    onState: publish,
    hasRoom: () => !disposed,
    random,
    setTimeout: later,
    clearTimeout: cancel
  });
  const io = {
    sockets: { sockets },
    on: (event, handler) => {
      if (event === 'connection') connect = handler;
    }
  };
  const service = {
    rooms: new Map([['LOCAL', room]]),
    engine,
    sendLobby() {},
    createRoom() {},
    joinRoom() {},
    leaveCurrentRoom() {},
    disconnectPlayer() {},
    sendGameState: publish
  };
  registerSocketHandlers(io, service);
  for (const player of room.players) {
    const handlers = {};
    const socket = {
      id: player.socketId,
      data: { roomCode: 'LOCAL' },
      on: (event, fn) => {
        handlers[event] = fn;
      },
      emit() {},
      handlers
    };
    sockets.set(socket.id, socket);
    connect(socket);
  }
  function waitsForHumanBito() {
    const human = room.players[0];
    return (
      room.game.status === 'playing' &&
      !human.surrendered &&
      (human.hand.length > 0 || room.game.deck.length > 0) &&
      room.game.table.length > 0 &&
      !hasUndefended(room)
    );
  }
  function humanCanConfirmDefense() {
    return (
      waitsForHumanBito() &&
      room.game.defenderIndex === 0 &&
      playableIndexes(room, room.game.attackerIndex).length === 0
    );
  }
  function snapshot(index = 0, action = null) {
    const state = publicStateFor(room, index, action);
    return {
      ...state,
      canPass: state.canPass || (index === 0 && humanCanConfirmDefense()),
      playableCardIndexes: playableIndexes(room, index),
      local: true
    };
  }
  function publish(_room, action = null) {
    if (disposed) return;
    if (waitsForHumanBito()) engine.clearTurnTimer(room);
    onState?.(snapshot(0, action));
    cancel(botTimer);
    if (room.game.status === 'playing' || room.game.status === 'timeout')
      botTimer = later(stepBots, botDelay);
  }
  function send(index, event, payload) {
    if (!disposed) sockets.get(`local-${index}`).handlers[event]?.(payload);
  }
  function stepBots() {
    if (disposed) return;
    for (let index = 1; index < maxPlayers; index++) {
      const state = snapshot(index);
      if (state.timeout.canVote && state.timeout.votes > 0) {
        send(index, state.timeout.active ? 'voteResume' : 'voteTimeout');
        return;
      }
    }
    if (room.game.status !== 'playing') return;
    const defender = room.game.defenderIndex;
    if (hasUndefended(room)) {
      if (defender === 0) return;
      const hand = room.players[defender].hand;
      const transfer = hand.findIndex((card) => canTransfer(room, defender, card));
      const playable = playableIndexes(room, defender);
      if (playable.length) send(defender, 'playCard', playable[0]);
      else if (transfer >= 0) send(defender, 'transferCard', transfer);
      else send(defender, 'take');
      return;
    }
    const attacker = room.game.attackerIndex;
    if (attacker === 0) return;
    const playable = playableIndexes(room, attacker);
    if (playable.length) send(attacker, 'playCard', playable[0]);
    else if (!waitsForHumanBito() && snapshot(attacker).canPass) send(attacker, 'bito');
  }
  engine.startGame(room);
  return {
    send: (event, payload) =>
      send(
        event === 'bito' && humanCanConfirmDefense() ? room.game.attackerIndex : 0,
        event,
        payload
      ),
    snapshot,
    rename(value) {
      if (disposed) return;
      room.players[0].name = value;
      publish();
    },
    dispose() {
      disposed = true;
      cancel(botTimer);
      engine.clearTurnTimer(room);
      engine.clearTimeoutTimer(room);
    }
  };
}
module.exports = { createLocalGame, playableIndexes };

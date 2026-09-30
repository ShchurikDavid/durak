const { TURN_TIME_MS } = require('../config');
const { newGameState } = require('./state');
const {
  timeoutVoters,
  canSurrender,
  hasUndefended,
  nextPlayerIndex,
  dealCards,
  createDeck,
  determineFirstAttacker
} = require('./rules');

// One engine per application; transport is supplied through onState.
function createGameEngine({
  onState,
  hasRoom,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
  random = Math.random
}) {
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

    const duration = room.game.resumeTurnMs ?? TURN_TIME_MS;
    room.game.resumeTurnMs = null;
    room.game.turnDeadline = Date.now() + duration;
    room.turnTimer = setTimeout(() => handleTurnTimeout(room), duration + 30);
  }

  function clearTimeoutTimer(room) {
    if (room.timeoutTimer) clearTimeout(room.timeoutTimer);
    room.timeoutTimer = null;
  }

  function endTimeout(room) {
    if (!hasRoom(room.code) || room.game.status !== 'timeout') return false;
    clearTimeoutTimer(room);
    const elapsed = Date.now() - room.game.timeoutStartedAt;
    room.game.matchStartedAt += elapsed;
    room.game.roundStartedAt += elapsed;
    room.game.timeoutDeadline = null;
    room.game.timeoutStartedAt = null;
    room.game.timeoutVotes = [];
    room.game.resumeVotes = [];
    room.game.status = room.players.every((p) => p.surrendered || p.socketId)
      ? 'playing'
      : 'paused';
    if (room.game.status === 'playing') scheduleTurnTimer(room);
    onState(room, 'timeout-ended');
    return true;
  }

  function voteTimeout(room, index, resume = false) {
    if (room.game.status !== (resume ? 'timeout' : 'playing')) return false;
    const voters = timeoutVoters(room);
    if (!voters.includes(index) || !room.players[index].socketId) return false;
    const key = resume ? 'resumeVotes' : 'timeoutVotes';
    room.game[key] = room.game[key].filter((vote) => voters.includes(vote));
    if (!room.game[key].includes(index)) room.game[key].push(index);
    if (room.game[key].length >= Math.floor(voters.length / 2) + 1) {
      if (resume) return endTimeout(room);
      room.game.resumeTurnMs = Math.max(
        0,
        (room.game.turnDeadline ?? Date.now() + TURN_TIME_MS) - Date.now()
      );
      clearTurnTimer(room);
      room.game.status = 'timeout';
      room.game.timeoutStartedAt = Date.now();
      room.game.timeoutDeadline = Date.now() + 60000;
      room.game.resumeVotes = [];
      room.timeoutTimer = setTimeout(() => endTimeout(room), 60000);
    }
    onState(room, resume ? 'resume-vote' : 'timeout-vote');
    return true;
  }

  function performBito(room) {
    if (room.game.status !== 'playing' || room.game.table.length === 0 || hasUndefended(room))
      return false;

    const oldDefender = room.game.defenderIndex;
    addToDiscard(room);
    room.game.table = [];
    dealCards(room);
    room.game.roundAttackerIndex = null;

    const newAttacker =
      room.players[oldDefender].hand.length > 0 ? oldDefender : nextPlayerIndex(room, oldDefender);
    const newDefender = nextPlayerIndex(room, newAttacker);

    room.game.attackerIndex = newAttacker;
    room.game.defenderIndex = newDefender;
    room.game.roundNumber += 1;
    room.game.roundStartedAt = Date.now();
    room.game.turn = 'attacker';

    return true;
  }

  function performTake(room) {
    if (room.game.status !== 'playing' || room.game.table.length === 0 || !hasUndefended(room))
      return false;

    const defenderIndex = room.game.defenderIndex;
    const defender = room.players[defenderIndex];
    if (!defender) return false;

    for (const pair of room.game.table) {
      defender.hand.push(pair.attack);
      if (pair.defend) defender.hand.push(pair.defend);
    }

    room.game.table = [];
    dealCards(room);
    room.game.roundAttackerIndex = null;

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
      !hasRoom(room.code) ||
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
          onState(room, 'gameOver');
        } else {
          scheduleTurnTimer(room);
          onState(room, 'timeout-take');
        }
      }
      return;
    }

    // Все карты защищены - можно бито
    if (room.game.table.length > 0 && !hasUndefended(room)) {
      if (performBito(room)) {
        if (checkGameOver(room)) {
          onState(room, 'gameOver');
        } else {
          scheduleTurnTimer(room);
          onState(room, 'timeout-bito');
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
    onState(room, 'timeout-pass');
  }

  function startGame(room) {
    clearTimeoutTimer(room);
    room.game = newGameState();
    room.game.status = 'playing';
    room.game.mode = room.mode;
    room.game.roundStartedAt = Date.now();
    room.game.matchStartedAt = Date.now();
    room.game.deck = createDeck(room.mode, random);

    const trumpIndex = room.game.deck.findIndex((card) => !card.joker);
    if (trumpIndex > 0) {
      [room.game.deck[0], room.game.deck[trumpIndex]] = [
        room.game.deck[trumpIndex],
        room.game.deck[0]
      ];
    }

    room.game.trumpCard = room.game.deck[0] || null;

    room.players.forEach((player) => {
      player.hand = [];
      player.surrendered = false;
    });

    // Стартовая раздача — по кругу от случайного места.
    const startIndex = Math.floor(random() * room.players.length);
    room.game.attackerIndex = startIndex;
    room.game.defenderIndex = nextPlayerIndex(room, startIndex);
    dealCards(room, startIndex);
    determineFirstAttacker(room);

    room.game.turn = 'attacker';
    scheduleTurnTimer(room);
    onState(room, 'start');
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

  function performSurrender(room, index) {
    if (!canSurrender(room, index)) return false;
    const player = room.players[index];
    player.surrendered = true;
    const cards = player.hand.splice(0);
    room.game.discard.push(...cards);
    room.game.discardPreview = room.game.discard.slice(-6);

    if (index === room.game.defenderIndex) {
      addToDiscard(room);
      room.game.table = [];
      dealCards(room);
      room.game.roundAttackerIndex = null;
      room.game.attackerIndex = nextPlayerIndex(room, index);
      room.game.defenderIndex = nextPlayerIndex(room, room.game.attackerIndex);
      room.game.roundNumber += 1;
      room.game.roundStartedAt = Date.now();
    } else if (index === room.game.attackerIndex) {
      if (room.game.table.length === 0) {
        room.game.attackerIndex = room.game.defenderIndex;
        room.game.defenderIndex = nextPlayerIndex(room, room.game.attackerIndex);
      } else {
        room.game.attackerIndex = nextPlayerIndex(room, room.game.defenderIndex);
      }
    }
    if (!checkGameOver(room)) scheduleTurnTimer(room);
    return true;
  }

  function finishGame(room, loserIndex, text) {
    clearTurnTimer(room);
    clearTimeoutTimer(room);
    room.game.status = 'finished';
    room.game.loserIndex = loserIndex;
    room.game.winnerIndex = null;
    room.game.resultText = text;
    room.game.turn = null;
  }

  function checkGameOver(room) {
    if (room.game.deck.length > 0 || room.game.table.length > 0) return false;

    const remaining = room.players
      .map((player, index) => (player.hand.length > 0 ? index : -1))
      .filter((index) => index !== -1);

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

    if (remaining.every((index) => room.players[index].hand.every((card) => card.joker))) {
      finishGame(room, null, '🤝 Остались только джокеры — ничья.');
      return true;
    }

    return false;
  }

  function resetAfterFinished(room) {
    clearTimeoutTimer(room);
    clearTurnTimer(room);
    room.game = newGameState();
    room.players.forEach((player) => {
      player.hand = [];
      player.surrendered = false;
    });
  }
  return {
    voteTimeout,
    endTimeout,
    clearTimeoutTimer,
    clearTurnTimer,
    scheduleTurnTimer,
    performSurrender,
    performBito,
    performTake,
    handleTurnTimeout,
    startGame,
    addToDiscard,
    finishGame,
    checkGameOver,
    resetAfterFinished
  };
}
module.exports = { createGameEngine };

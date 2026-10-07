const { MODE_CONFIG, DEFAULT_MODE, GAME_TYPES } = require('../config');
const {
  timeoutVoters,
  canSurrender,
  activePlayers,
  allPlayersPresent,
  uniqueTableValues,
  currentAttackLimit,
  hasUndefended,
  canAttack,
  canDefend,
  canTransfer
} = require('./rules');
function publicStateFor(room, index, lastAction) {
  const me = room.players[index];
  if (!me) return null;

  const connectedCount = activePlayers(room).length;
  const isAttacker = index === room.game.attackerIndex;
  const isDefender = index === room.game.defenderIndex;
  const attackRanks = uniqueTableValues(room);
  const attackLimit = currentAttackLimit(room);
  const transferCardIndexes = me.hand.flatMap((card, cardIndex) =>
    canTransfer(room, index, card) ? [cardIndex] : []
  );

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
      statusText = hasOpenDefense ? '🟢 Ваш ход — защищайтесь' : '🔴 Соперник атакует';
      if (transferCardIndexes.length) statusText = '🟢 Отбивайтесь или переводите';
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

  if (me.surrendered) statusText = '🏳️ Вы сдались — наблюдаете за игрой';

  const voters = timeoutVoters(room);
  const resume = room.game.status === 'timeout';
  const votes = (resume ? room.game.resumeVotes : room.game.timeoutVotes).filter((vote) =>
    voters.includes(vote)
  );
  if (resume) statusText = '⏸ Тайм-аут — игра приостановлена';

  return {
    timeout: {
      active: resume,
      deadline: room.game.timeoutDeadline,
      votes: votes.length,
      required: Math.floor(voters.length / 2) + 1,
      voted: votes.includes(index),
      canVote:
        (resume || room.game.status === 'playing') &&
        voters.includes(index) &&
        !votes.includes(index)
    },
    surrendered: Boolean(me.surrendered),
    canSurrender: canSurrender(room, index),
    roomCode: room.code,
    roomName: room.name || '',
    matchId: room.game.matchId,
    finishedAt: room.game.finishedAt,
    playersConnected: connectedCount,
    playersTotal: room.players.length,
    maxPlayers: room.maxPlayers,
    myIndex: index,
    myHand: me.hand || [],
    playableCardIndexes:
      room.game.status !== 'playing'
        ? []
        : me.hand.flatMap((card, cardIndex) => {
            const attack = room.game.table.find((pair) => pair.defend === null)?.attack;
            const allowed = isDefender
              ? attack && canDefend(attack, card, room.game.trumpCard?.suit)
              : canAttack(room, index, card);
            return allowed ? [cardIndex] : [];
          }),
    players: room.players.map((player, playerIndex) => ({
      index: playerIndex,
      isBot: Boolean(player.isBot),
      name: player.name || `Игрок ${playerIndex + 1}`,
      connected: Boolean(player.socketId),
      surrendered: Boolean(player.surrendered),
      cardCount: player.hand.length,
      isMe: playerIndex === index,
      isAttacker: playerIndex === room.game.attackerIndex,
      isDefender: playerIndex === room.game.defenderIndex
    })),
    gameMode: room.mode,
    gameType: room.gameType || 'throwIn',
    gameTypeLabel: GAME_TYPES[room.gameType] || GAME_TYPES.throwIn,
    transferCardIndexes,
    canTransfer: transferCardIndexes.length > 0,
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
    isMyTurn:
      room.game.status === 'playing' &&
      (isDefender ? hasUndefended(room) : me.hand.some((card) => canAttack(room, index, card))),
    role: me.surrendered ? 'Наблюдатель' : isDefender ? 'Защищающийся' : 'Атакующий',
    canPass:
      !me.surrendered &&
      room.game.status === 'playing' &&
      !isDefender &&
      room.game.turn === 'attacker' &&
      room.game.table.length > 0 &&
      !hasUndefended(room),
    canTake:
      room.game.status === 'playing' &&
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
module.exports = { publicStateFor };

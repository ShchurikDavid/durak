const { DEFAULT_MODE } = require('../config');

function newGameState() {
  return {
    status: 'waiting',
    timeoutVotes: [],
    resumeVotes: [],
    timeoutDeadline: null,
    timeoutStartedAt: null,
    resumeTurnMs: null,
    deck: [],
    trumpCard: null,
    table: [],
    discard: [],
    discardPreview: [],
    attackerIndex: 0,
    roundAttackerIndex: null,
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

module.exports = { newGameState };

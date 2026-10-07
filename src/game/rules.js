const {
  HAND_SIZE,
  ROOM_CODE_LENGTH,
  MIN_PLAYERS,
  MAX_PLAYERS,
  suits,
  MODE_CONFIG,
  DEFAULT_MODE,
  valueRank
} = require('../config');

function normalizeMode(value) {
  const mode =
    typeof value === 'string' || typeof value === 'number' ? String(value) : DEFAULT_MODE;
  return Object.hasOwn(MODE_CONFIG, mode) ? mode : DEFAULT_MODE;
}

function normalizePlayerCount(value) {
  const count = typeof value === 'string' || typeof value === 'number' ? Number(value) : 2;
  return Number.isInteger(count) ? Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, count)) : 2;
}

function normalizeRoomCode(value) {
  return (typeof value === 'string' ? value : '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

function playerBySocket(room, socketId) {
  return room.players.find((p) => p.socketId === socketId);
}

function playerIndexBySocket(room, socketId) {
  return room.players.findIndex((p) => p.socketId === socketId);
}

function activePlayers(room) {
  return room.players.filter((p) => p.socketId);
}

function allPlayersPresent(room) {
  return room.players.length === room.maxPlayers && room.players.every((p) => Boolean(p.socketId));
}

function nextPlayerIndex(room, fromIndex) {
  const total = room.players.length;
  if (!total) return 0;

  for (let step = 1; step <= total; step++) {
    const index = (fromIndex + step) % total;
    const player = room.players[index];
    if (
      player?.socketId &&
      !player.surrendered &&
      (room.game.deck.length > 0 || player.hand.length > 0)
    )
      return index;
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

function shuffle(cards, random = Math.random) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createDeck(mode, random = Math.random) {
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

  return shuffle(deck, random);
}

function hasUndefended(room) {
  return room.game.table.some((pair) => pair.defend === null);
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
  const defendedCount = room.game.table.filter((pair) => pair.defend !== null).length;
  const roundLimit = room.game.discard.length === 0 ? room.game.firstRoundLimit : HAND_SIZE;
  // Уже сыгранные карты защиты тоже входят в руку на начало захода.
  return Math.min(roundLimit, defenderHand + defendedCount);
}

function timeoutVoters(room) {
  return room.players.flatMap((p, index) =>
    !p.surrendered &&
    (room.game.deck.length > 0 ||
      p.hand.length > 0 ||
      (room.game.table.length > 0 &&
        (index === room.game.attackerIndex || index === room.game.defenderIndex)))
      ? [index]
      : []
  );
}

function canSurrender(room, index) {
  const player = room.players[index];
  return (
    room.game.status === 'playing' &&
    Boolean(player) &&
    !player.surrendered &&
    (room.game.deck.length > 0 || player.hand.length > 0) &&
    room.players.filter((p) => !p.surrendered && (room.game.deck.length > 0 || p.hand.length > 0))
      .length >= 2
  );
}

function canAttack(room, index, card) {
  if (!room.players[index] || room.players[index].surrendered || !card) return false;
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

function canTransfer(room, index, card) {
  if (room.players[index]?.surrendered) return false;
  if (room.gameType !== 'transfer' || room.game.status !== 'playing') return false;
  if (index !== room.game.defenderIndex || !card || card.joker) return false;
  const table = room.game.table;
  if (!table.length || table.some((pair) => pair.defend !== null || pair.attack.val !== card.val))
    return false;
  const next = nextPlayerIndex(room, index);
  if (next === index || !room.players[next]?.socketId) return false;
  const limit = room.game.discard.length === 0 ? room.game.firstRoundLimit : HAND_SIZE;
  return table.length + 1 <= Math.min(limit, room.players[next].hand.length);
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
    .filter((index) => index !== defender)
    .concat(defender);
}

function dealCards(room, firstIndex = room.game.roundAttackerIndex ?? room.game.attackerIndex) {
  for (const index of drawOrderAfterRound(room, firstIndex)) {
    const player = room.players[index];
    if (!player || player.surrendered) continue;

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

module.exports = {
  timeoutVoters,
  canSurrender,
  canTransfer,
  normalizeMode,
  normalizePlayerCount,
  normalizeRoomCode,
  playerBySocket,
  playerIndexBySocket,
  activePlayers,
  allPlayersPresent,
  nextPlayerIndex,
  orderedPlayerIndexes,
  shuffle,
  createDeck,
  hasUndefended,
  tableValues,
  uniqueTableValues,
  currentAttackLimit,
  canAttack,
  canDefend,
  drawOrderAfterRound,
  dealCards,
  determineFirstAttacker
};

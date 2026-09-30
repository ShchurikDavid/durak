const HAND_SIZE = 6;
const RECONNECT_GRACE_MS = 60_000;
const ROOM_CODE_LENGTH = 5;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const TURN_TIME_MS = 20_000;

const suits = ['S', 'H', 'D', 'C'];
const ALL_VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const MODE_CONFIG = {
  24: { label: '24 карты', values: ['9', '10', 'J', 'Q', 'K', 'A'], jokers: false },
  36: { label: '36 карт', values: ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'], jokers: false },
  52: { label: '52 карты', values: ALL_VALUES, jokers: false },
  54: { label: '52 карты + 🃏 джокеры', values: ALL_VALUES, jokers: true }
};
const DEFAULT_MODE = '36';

const valueRank = {
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14
};

const GAME_TYPES = { throwIn: 'Подкидной', transfer: 'Переводной' };

module.exports = {
  GAME_TYPES,
  HAND_SIZE,
  RECONNECT_GRACE_MS,
  ROOM_CODE_LENGTH,
  MIN_PLAYERS,
  MAX_PLAYERS,
  TURN_TIME_MS,
  suits,
  ALL_VALUES,
  MODE_CONFIG,
  DEFAULT_MODE,
  valueRank
};

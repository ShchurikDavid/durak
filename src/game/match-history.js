const resultLabels = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' };

function matchRecord(state) {
  const me = state.players.find((player) => player.index === state.myIndex);
  if (!state.matchId || !me || (state.status !== 'finished' && !me.surrendered)) return null;
  return {
    id: `${state.matchId}:${state.myIndex}`,
    date: state.finishedAt || Date.now(),
    result:
      me.surrendered || state.loserIndex === state.myIndex
        ? 'loss'
        : state.loserIndex == null
          ? 'draw'
          : 'win',
    surrendered: Boolean(me.surrendered),
    mode: state.local ? 'С ботами' : state.bluetooth ? 'Bluetooth' : 'Онлайн',
    rules: `${state.gameModeLabel} · ${state.gameTypeLabel}`,
    opponents: state.players
      .filter((player) => player.index !== state.myIndex)
      .map((player) => `${player.name}${player.isBot ? ' (бот)' : ''}`)
      .join(', ')
  };
}

function readHistory(raw) {
  try {
    const entries = JSON.parse(raw || '[]');
    return Array.isArray(entries)
      ? entries
          .filter(
            (entry) =>
              entry &&
              typeof entry.id === 'string' &&
              Number.isFinite(entry.date) &&
              Object.hasOwn(resultLabels, entry.result) &&
              typeof entry.opponents === 'string'
          )
          .slice(0, 500)
      : [];
  } catch {
    return [];
  }
}

function addMatch(history, record) {
  if (!record || history.some((entry) => entry.id === record.id)) return history;
  return [record, ...history].sort((a, b) => b.date - a.date).slice(0, 500);
}

function historySummary(history) {
  const count = (result) => history.filter((entry) => entry.result === result).length;
  return `Матчей: ${history.length} · Побед: ${count('win')} · Поражений: ${count('loss')} · Ничьих: ${count('draw')}`;
}

module.exports = { resultLabels, matchRecord, readHistory, addMatch, historySummary };

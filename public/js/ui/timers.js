import { $ } from '../core/dom.js';
let turnTimerInterval = null,
  roundTimerInterval = null;
function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60),
    s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function renderTimers(state) {
  const bar = $('timerBar'),
    turnEl = $('turnTimer'),
    roundEl = $('roundTimer');
  const playing = state?.status === 'playing';
  if (!playing) {
    if (turnTimerInterval) {
      clearInterval(turnTimerInterval);
      turnTimerInterval = null;
    }
    if (roundTimerInterval) {
      clearInterval(roundTimerInterval);
      roundTimerInterval = null;
    }
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  if (turnTimerInterval) clearInterval(turnTimerInterval);
  if (state.turnDeadline) {
    const deadline = Number(state.turnDeadline) || 0;
    const updateTurn = () => {
      const left = Math.max(0, deadline - Date.now());
      const seconds = Math.ceil(left / 1000);
      turnEl.textContent = `⏱ ${seconds}с`;
      turnEl.classList.toggle('warning', seconds <= 10 && seconds > 5);
      turnEl.classList.toggle('danger', seconds <= 5);
      if (left <= 0) {
        clearInterval(turnTimerInterval);
        turnTimerInterval = null;
      }
    };
    updateTurn();
    turnTimerInterval = setInterval(updateTurn, 200);
  } else {
    turnEl.textContent = '';
  }

  if (roundTimerInterval) clearInterval(roundTimerInterval);
  if (state.matchStartedAt) {
    const start = Number(state.matchStartedAt) || Date.now();
    const updateRound = () => {
      roundEl.textContent = `⏳ Матч: ${formatElapsed(Date.now() - start)}`;
    };
    updateRound();
    roundTimerInterval = setInterval(updateRound, 500);
  } else {
    roundEl.textContent = '';
  }
}
export function stopTimers() {
  clearInterval(turnTimerInterval);
  clearInterval(roundTimerInterval);
  turnTimerInterval = null;
  roundTimerInterval = null;
}
export { renderTimers };

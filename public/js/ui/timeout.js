import { $ } from '../core/dom.js';
import { socket } from '../core/socket.js';
import { session } from '../core/session.js';
let interval = null;
let previousFocus = null;

export function hideTimeout() {
  clearInterval(interval);
  interval = null;
  if ($('timeoutDialog').open) {
    $('timeoutDialog').close();
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  }
}

export function renderTimeout(state) {
  const vote = state.timeout;
  const button = $('voteTimeout');
  button.classList.toggle('hidden', state.status !== 'playing');
  button.disabled = !socket.connected || !vote?.canVote || session.actionPending;
  button.textContent = vote?.votes
    ? `${vote.voted ? 'Ваш голос за тайм-аут' : 'За тайм-аут'} · ${vote.votes}/${vote.required}`
    : 'Тайм-аут · 1 мин';
  button.title = 'Минутная пауза по решению большинства игроков';
  if (!vote?.active) {
    hideTimeout();
    return;
  }
  const dialog = $('timeoutDialog');
  if (!dialog.open) {
    previousFocus = document.activeElement;
    dialog.showModal();
  }
  clearInterval(interval);
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((vote.deadline - Date.now()) / 1000));
    $('timeoutCountdown').textContent =
      `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  tick();
  interval = setInterval(tick, 200);
  $('timeoutVoteCount').textContent =
    `За отмену тайм-аута: ${vote.votes} из ${vote.required} необходимых голосов`;
  $('voteResume').disabled = !socket.connected || !vote.canVote || session.actionPending;
  $('voteResume').textContent = vote.voted
    ? 'Ваш голос учтён'
    : vote.canVote
      ? 'Голосовать за продолжение'
      : 'Вы наблюдаете за игрой';
}

export function initTimeoutControls() {
  $('timeoutDialog').addEventListener('cancel', (event) => event.preventDefault());
  for (const [id, active] of [
    ['voteTimeout', false],
    ['voteResume', true]
  ]) {
    $(id).onclick = () => {
      const state = session.currentState;
      if (
        !socket.connected ||
        session.actionPending ||
        !state?.timeout?.canVote ||
        state.timeout.active !== active
      )
        return;
      session.actionPending = true;
      socket.emit(id);
      renderTimeout(state);
    };
  }
  socket.on('disconnect', () => {
    $('voteTimeout').disabled = true;
    $('voteResume').disabled = true;
  });
}

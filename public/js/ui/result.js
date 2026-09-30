import { $ } from '../core/dom.js';
import { socket } from '../core/socket.js';
import { session } from '../core/session.js';
function showResultModal(state) {
  const backdrop = $('resultBackdrop'),
    modal = backdrop.querySelector('.result-modal');
  const emoji = $('resultEmoji'),
    title = $('resultTitle'),
    sub = $('resultSub');
  modal.classList.remove('result-win', 'result-lose');

  if (state.surrendered) {
    emoji.textContent = '🏳️';
    title.textContent = 'Вы сдались';
  } else if (state.loserIndex === null || state.loserIndex === undefined) {
    emoji.textContent = '🤝';
    title.textContent = 'Ничья';
  } else if (state.loserIndex === state.myIndex) {
    emoji.textContent = '💀';
    title.textContent = 'Поражение';
    modal.classList.add('result-lose');
  } else {
    emoji.textContent = '🏆';
    title.textContent = 'Победа!';
    modal.classList.add('result-win');
  }
  sub.textContent = state.resultText || '';
  $('resultRestart').style.display = state.canRestart ? 'block' : 'none';
  backdrop.classList.remove('hidden');
}
function hideResultModal() {
  $('resultBackdrop').classList.add('hidden');
}
export function initResultControls(enterLobby) {
  $('resultRestart').onclick = () => {
    if (session.actionPending) return;
    session.actionPending = true;
    hideResultModal();
    socket.emit('restartGame');
  };
  $('resultLeave').onclick = () => {
    hideResultModal();
    socket.emit('leaveRoom');
    enterLobby();
  };
  $('resultClose').onclick = () => hideResultModal();
  $('resultBackdrop').addEventListener('click', (e) => {
    if (e.target === $('resultBackdrop')) hideResultModal();
  });
}
export { showResultModal, hideResultModal };

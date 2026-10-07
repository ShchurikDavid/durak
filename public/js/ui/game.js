import { orderedHand } from '../hand-order.js';
import { renderTimeout, initTimeoutControls } from './timeout.js';
import { highlightPlayableCards } from './highlights.js';
import { $ } from '../core/dom.js';
import { socket } from '../core/socket.js';
import { session } from '../core/session.js';
import { cardBack, makeCardImg } from '../cards.js';
import { renderTimers } from './timers.js';
import { showResultModal, hideResultModal } from './result.js';
import { renderTableUI } from './table.js';
import { captureCards, animateCards } from './motion.js';
function render(state) {
  const positions = captureCards();
  renderTimeout(state);
  const canLeave = ['waiting', 'finished'].includes(state.status) || state.surrendered;
  for (const id of ['leave', 'mobileLeave']) {
    if ($(id)) $(id).classList.toggle('hidden', !canLeave);
  }
  $('status').textContent = state.statusText || 'Ожидание...';
  $('deckCount').textContent = state.deckCount;
  $('roomBadge').textContent =
    `${state.roomName || 'Комната'} ${state.roomCode} · ${state.playersConnected}/${state.maxPlayers || state.playersTotal || 2} · ${state.gameModeLabel || '36 карт'} · ${state.gameTypeLabel || 'Подкидной'}`;
  $('transfer').classList.toggle('hidden', state.gameType !== 'transfer');
  $('transfer').disabled = !state.canTransfer || session.actionPending;
  $('transfer').textContent = session.transferMode ? 'Отмена перевода' : 'Перевести';
  $('transfer').setAttribute('aria-pressed', String(session.transferMode));
  if (session.transferMode) $('status').textContent = 'Выберите подсвеченную карту для перевода';
  renderOpponent(state);
  renderTrump(state);
  renderTable(state);
  renderHand(state);
  renderTimers(state);
  renderTableUI(state);
  animateCards(positions);
  $('surrender').classList.toggle('hidden', !state.canSurrender);
  $('surrender').disabled = !state.canSurrender || session.actionPending;
  $('bito').disabled = !state.canPass || session.actionPending;
  $('take').disabled = !state.canTake || session.actionPending;
  $('restart').style.display = state.canRestart ? 'block' : 'none';
  if (state.status === 'finished') showResultModal(state);
  else hideResultModal();
}
function fanOverlap(el, count) {
  if (count < 2) return 0;
  const backW = parseFloat(getComputedStyle(el).getPropertyValue('--back-w')) || 78;
  const available = Math.max(120, (el.clientWidth || window.innerWidth) - 20);
  const needed = backW + (count - 1) * backW * (1 - 0.34);
  if (needed <= available) return 0.34;
  const step = (available - backW) / (count - 1);
  return Math.min(0.78, Math.max(0.34, 1 - step / backW));
}
function renderOpponent(state) {
  const el = $('opponent');
  // Сервер присылает общий массив players с cardCount на каждого,
  // а не отдельное поле opponentCardCount — раньше карты соперника
  // из-за этого никогда не отображались в игре на двоих.
  const players = Array.isArray(state?.players) ? state.players : [];
  const opponent = players.find((p) => !p.isMe);
  const count = Number(opponent?.cardCount || 0);
  el.style.setProperty('--back-overlap', fanOverlap(el, count));
  const signature = `${count}:${cardBack()}`;
  if (el.dataset.signature === signature) return;
  el.dataset.signature = signature;
  el.replaceChildren();
  for (let i = 0; i < count; i++) {
    const back = document.createElement('div');
    back.className = 'back';
    back.style.backgroundImage = `url("${cardBack()}")`;
    el.appendChild(back);
  }
}
function renderTrump(state) {
  const el = $('trump');
  const signature = `${state.trumpCard?.code}:${cardBack()}`;
  if (el.dataset.signature === signature) return;
  el.dataset.signature = signature;
  el.innerHTML = '';
  if (!state.trumpCard) return;
  el.appendChild(makeCardImg(state.trumpCard.code, 'Козырь'));
}
function renderTable(state) {
  const el = $('table');
  const existing = new Map([...el.children].map((pair) => [pair.dataset.code, pair]));
  const keep = new Set(state.table.map((pair) => pair.attack.code));
  for (const [code, pair] of existing) if (!keep.has(code)) pair.remove();
  state.table.forEach((pair) => {
    const signature = `${pair.attack.code}:${pair.defend?.code}:${cardBack()}`;
    const previous = existing.get(pair.attack.code);
    if (previous?.dataset.signature === signature) return;
    const pairEl = document.createElement('div');
    pairEl.className = 'pair';
    pairEl.dataset.code = pair.attack.code;
    pairEl.dataset.signature = signature;
    pairEl.appendChild(
      makeCardImg(pair.attack.code, `${pair.attack.val}${pair.attack.suit}`, 'card attack')
    );
    if (pair.defend)
      pairEl.appendChild(
        makeCardImg(pair.defend.code, `${pair.defend.val}${pair.defend.suit}`, 'card defend')
      );
    if (previous) previous.replaceWith(pairEl);
    else el.appendChild(pairEl);
  });
}
function renderHand(state) {
  const el = $('hand');
  const existing = new Map(
    [...el.querySelectorAll('img.card')].map((img) => [img.dataset.code, img])
  );
  const entries = orderedHand(
    state.myHand || [],
    localStorage.getItem('durak.sort') || 'suit',
    state.trumpCard?.suit
  );
  const cards = entries.map(({ card }) => card);
  const keep = new Set(cards.map((card) => card.code));
  for (const [code, img] of existing) {
    if (!keep.has(code) || img.dataset.skin !== cardBack()) {
      (img.closest('.durak-card-filter') || img).remove();
      existing.delete(code);
    }
  }
  // Карты крупные, поэтому вместо переноса на вторую строку они
  // накладываются друг на друга ровно настолько, чтобы влезть в один ряд.
  const overlap = handOverlap(el, cards.length);
  el.style.setProperty('--hand-overlap', overlap);
  const cardW = parseFloat(getComputedStyle(el).getPropertyValue('--card-w')) || 120;
  const fits =
    cards.length < 2 ||
    cardW + (cards.length - 1) * cardW * (1 - overlap) <=
      (el.clientWidth || window.innerWidth) - 12;
  el.classList.toggle('scroll', !fits);
  cards.forEach((card, index) => {
    const originalIndex = entries[index].index;
    const img = existing.get(card.code) || makeCardImg(card.code, `${card.val}${card.suit}`);
    img.dataset.skin = cardBack();
    const item = img.closest('.durak-card-filter') || img;
    item.style.zIndex = String(index + 1);
    // Отступ считаем прямо в JS и пишем инлайн-стилем на каждую карту.
    // Раньше отрицательный margin вешался через CSS-селектор
    // "#hand .card:first-child" — он ломался, когда карту оборачивал
    // фильтр «можно/нельзя ходить» (первой становилась уже обёртка,
    // а не сама карта), из-за чего перекрытие переставало работать
    // и веер карт вылезал за пределы экрана на телефоне.
    item.style.marginLeft = index === 0 ? '0px' : `calc(var(--card-w) * ${overlap} * -1)`;
    img.onclick = () => {
      if (
        socket.connected &&
        session.currentState?.status === 'playing' &&
        !session.actionPending
      ) {
        if (session.transferMode && !state.transferCardIndexes?.includes(originalIndex)) return;
        session.actionPending = true;
        socket.emit(session.transferMode ? 'transferCard' : 'playCard', originalIndex);
      }
    };
    if (el.children[index] !== item) el.insertBefore(item, el.children[index] || null);
  });
  highlightPlayableCards(state);
}
function handOverlap(el, count) {
  if (count < 2) return 0;
  const cardW = parseFloat(getComputedStyle(el).getPropertyValue('--card-w')) || 120;
  const gap = parseFloat(getComputedStyle(el).getPropertyValue('--gap')) || 8;
  const available = Math.max(160, (el.clientWidth || window.innerWidth) - 12);
  const needed = count * cardW + (count - 1) * gap;
  if (needed <= available) return 0;
  const step = (available - cardW) / (count - 1);
  return Math.min(0.78, Math.max(0, (cardW + gap - step) / cardW));
}
export function initGameControls(enterLobby) {
  initTimeoutControls();
  $('surrender').onclick = () => {
    if (!socket.connected || session.actionPending || !session.currentState?.canSurrender) return;
    if (!confirm('Сдаться? Ваши карты уйдут в отбой, а вы останетесь наблюдать за игрой.')) return;
    session.actionPending = true;
    session.transferMode = false;
    socket.emit('surrender');
    render(session.currentState);
  };
  $('transfer').onclick = () => {
    if (!socket.connected || session.actionPending || !session.currentState?.canTransfer) return;
    session.transferMode = !session.transferMode;
    render(session.currentState);
  };
  $('bito').onclick = () => {
    if (session.actionPending) return;
    session.actionPending = true;
    socket.emit('bito');
  };
  $('take').onclick = () => {
    if (session.actionPending) return;
    session.actionPending = true;
    socket.emit('take');
  };
  $('restart').onclick = () => {
    if (session.actionPending) return;
    session.actionPending = true;
    socket.emit('restartGame');
  };
  $('leave').onclick = () => {
    const state = session.currentState;
    if (state && !['waiting', 'finished'].includes(state.status) && !state.surrendered) return;
    if (confirm('Выйти из комнаты?')) {
      socket.emit('leaveRoom');
      enterLobby();
    }
  };

  // При повороте экрана пересчитываем веер соперника под новую ширину.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (session.currentState) {
        renderOpponent(session.currentState);
        renderHand(session.currentState);
      }
    }, 120);
  });
}
export { render };

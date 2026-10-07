import { $, showToast } from './core/dom.js';
import { socket } from './core/socket.js';
import { session } from './core/session.js';
import { getUserId, getName } from './core/identity.js';
import { playSound } from './settings.js';
import { render } from './ui/game.js';
import { showResultModal, hideResultModal } from './ui/result.js';
import { hideTimeout } from './ui/timeout.js';
import { stopTimers } from './ui/timers.js';
const lobby = $('lobby'),
  game = $('game');
const userId = getUserId();
function joinRoom(code) {
  socket.emit('joinRoom', { userId, name: getName(), roomCode: code });
}
function setRoomInUrl(code) {
  history.replaceState(null, '', `${location.pathname}?room=${encodeURIComponent(code)}`);
}
function roomFromUrl() {
  return new URLSearchParams(location.search).get('room')?.toUpperCase() || '';
}

function enterGame(code) {
  lobby.classList.add('hidden');
  game.classList.remove('hidden');
  if (session.currentState?.roomCode === code) render(session.currentState);
  else $('roomBadge').textContent = 'Комната ' + code;
  setRoomInUrl(code);
  localStorage.setItem('durak_room_code', code);
  if (session.currentState?.status === 'finished') showResultModal(session.currentState);
  else hideResultModal();
}
async function shareText(text, fallbackText) {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Дурак', text });
      return;
    }
    await navigator.clipboard.writeText(text);
    showToast(fallbackText || 'Ссылка скопирована!');
  } catch (error) {
    if (error?.name !== 'AbortError') window.prompt('Скопируйте ссылку:', text);
  }
}

function roomInviteUrl(code) {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
}
function enterLobby() {
  hideTimeout();
  game.classList.add('hidden');
  lobby.classList.remove('hidden');
  history.replaceState(null, '', location.pathname);
  localStorage.removeItem('durak_room_code');
  session.currentState = null;
  session.actionPending = false;
  session.transferMode = false;
  stopTimers();
  hideResultModal();
}
let cachedRooms = [];
let onlyFriends = false;
let friendIds = new Set();
let filterRevision = 0;
function renderRoomList(rooms) {
  cachedRooms = rooms;
  if (onlyFriends) rooms = rooms.filter((room) => friendIds.has(room.hostId));
  $('roomCount').textContent = String(rooms.length);
  const el = $('roomList');
  el.innerHTML = '';
  if (!rooms.length) {
    el.innerHTML = '<div class="empty">Пока нет открытых комнат</div>';
    return;
  }
  rooms.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'room';
    const avatar = document.createElement('span');
    avatar.className = 'room-avatar';
    avatar.translate = false;
    avatar.textContent = (r.hostName || r.name || r.code).slice(0, 2).toUpperCase();
    row.append(avatar);
    const left = document.createElement('div');
    left.className = 'room-details';
    for (const [className, text] of [
      ['room-code', r.name || r.code],
      ['room-host', r.hostName || ''],
      [
        'room-meta',
        `${r.code} · ${r.players}/${r.maxPlayers} · ${r.players >= r.maxPlayers ? 'Заполнена' : r.players === 1 ? 'Ждём соперника' : 'Свободна'}`
      ],
      ['room-mode', `${r.modeLabel || '36 карт'} · ${r.gameTypeLabel || 'Подкидной'}`]
    ]) {
      const item = document.createElement('div');
      item.className = className;
      item.textContent = text;
      if (['room-code', 'room-host'].includes(className)) item.translate = false;
      left.append(item);
    }
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.textContent = 'Присоединиться';
    btn.disabled = r.players >= r.maxPlayers;
    btn.onclick = () => joinRoom(r.code);
    row.append(left, btn);
    el.appendChild(row);
  });
}
export function initLobby() {
  $('allTables').onclick = () => {
    filterRevision++;
    onlyFriends = false;
    $('allTables').setAttribute('aria-pressed', 'true');
    $('friendTables').setAttribute('aria-pressed', 'false');
    renderRoomList(cachedRooms);
  };
  $('friendTables').onclick = async () => {
    const revision = ++filterRevision;
    try {
      const response = await fetch('/api/auth/friends');
      const data = await response.json();
      if (revision !== filterRevision) return;
      if (!response.ok) throw new Error(data.error);
      friendIds = new Set(data.friends.filter((f) => f.status === 'accepted').map((f) => f.id));
      onlyFriends = true;
      $('allTables').setAttribute('aria-pressed', 'false');
      $('friendTables').setAttribute('aria-pressed', 'true');
      renderRoomList(cachedRooms);
    } catch (error) {
      if (revision !== filterRevision) return;
      showToast(error.message);
    }
  };
  socket.on('connect', () => {
    session.actionPending = false;
    const remembered = roomFromUrl() || localStorage.getItem('durak_room_code');
    if (remembered) joinRoom(remembered);
    socket.emit('getRooms');
  });
  socket.on('disconnect', () => {
    if (!game.classList.contains('hidden'))
      $('status').textContent = '⚠️ Связь потеряна. Переподключение...';
  });
  socket.on('roomCreated', ({ code }) => {
    joinRoom(code);
  });
  socket.on('joinedRoom', ({ code }) => enterGame(code));
  socket.on('roomError', (msg) => {
    // Раньше код несуществующей комнаты оставался в localStorage, и клиент
    // пытался войти в неё при каждом переподключении.
    if (session.currentState === null) localStorage.removeItem('durak_room_code');
    showToast(msg);
    if (session.currentState === null) enterLobby();
  });
  socket.on('gameFull', () => showToast('Комната уже заполнена.'));
  socket.on('roomClosed', (msg) => {
    localStorage.removeItem('durak_room_code');
    session.currentState = null;
    enterLobby();
    showToast(msg || 'Комната закрыта.');
  });
  socket.on('roomList', renderRoomList);
  socket.on('roomLobby', (data) => {
    renderRoomList(data.rooms || []);
    if (data.message) showToast(data.message);
  });
  socket.on('updateState', (state) => {
    session.transferMode = false;
    session.currentState = state;
    session.actionPending = false;
    if (
      state.lastAction &&
      state.lastAction !== 'start' &&
      state.lastAction !== 'reconnect' &&
      state.lastAction !== 'disconnect' &&
      state.lastAction !== 'gameOver'
    )
      playSound(state.lastAction);
    render(state);
  });
  $('shareLobby').onclick = () => shareText(location.href, 'Ссылка на игру скопирована!');

  $('shareRoom').onclick = () => {
    const code = session.currentState?.roomCode || localStorage.getItem('durak_room_code');
    if (!code) return;
    shareText(roomInviteUrl(code), `Приглашение в комнату ${code} скопировано!`);
  };
  $('joinByCode').onclick = () => joinCode();
  $('roomCodeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinCode();
  });
  function joinCode() {
    const code = $('roomCodeInput').value.trim().toUpperCase();
    if (!code) return showToast('Введите код комнаты');
    joinRoom(code);
  }
}
export { enterLobby };

import { $, showToast } from '../core/dom.js';
import { socket } from '../core/socket.js';

export function initCreateRoomDialog() {
  const dialog = $('createRoomDialog');
  const form = $('createRoomForm');
  const submit = $('confirmCreateRoom');
  let pending = false;
  function reset() {
    pending = false;
    submit.disabled = false;
    submit.textContent = 'Создать комнату';
  }
  $('createRoom').onclick = () => dialog.showModal();
  $('cancelCreateRoom').onclick = () => dialog.close();
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  });
  form.addEventListener('change', () => {
    const transfer = new FormData(form).get('gameType') === 'transfer';
    $('gameTypeHint').textContent = transfer
      ? 'До начала защиты можно перевести атаку следующему игроку картой того же значения. Нажмите «Перевести» и выберите карту.'
      : 'Подкидывайте карты тех же значений, что уже есть на столе.';
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending) return;
    if (!socket.connected) return showToast('Нет связи с сервером. Дождитесь подключения.');
    const data = new FormData(form);
    pending = true;
    submit.disabled = true;
    submit.textContent = 'Создаём…';
    socket.emit('createRoom', {
      name: data.get('roomName'),
      mode: data.get('gameMode'),
      maxPlayers: Number(data.get('maxPlayers')),
      gameType: data.get('gameType')
    });
  });
  socket.on('roomCreated', () => {
    reset();
    dialog.close();
  });
  socket.on('roomError', reset);
  socket.on('disconnect', reset);
}

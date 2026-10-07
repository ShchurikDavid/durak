import { $ } from './core/dom.js';
export function initFriends() {
  let code = '';
  let busy = false;
  let generation = 0;
  async function request(body) {
    const response = await fetch('/api/auth/friends', {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Ошибка сервера');
    return data;
  }
  async function refresh() {
    const current = ++generation;
    code = '';
    $('friendCode').textContent = '';
    $('copyFriendCode').hidden = true;
    $('friendForm').hidden = true;
    $('friendsMessage').textContent = 'Загрузка…';
    $('friendsList').replaceChildren();
    try {
      const data = await request();
      if (current !== generation || !$('friendsDialog').open) return;
      code = data.code;
      $('friendCode').textContent = code;
      $('friendForm').hidden = false;
      $('copyFriendCode').hidden = false;
      $('friendsMessage').textContent = data.friends.length
        ? ''
        : 'Пока нет друзей. Отправьте первую заявку.';
      for (const friend of data.friends) {
        const row = document.createElement('div');
        row.className = 'friend-row';
        const name = document.createElement('strong');
        name.textContent = friend.name;
        name.translate = false;
        const status = document.createElement('small');
        status.textContent =
          friend.status === 'accepted'
            ? 'В друзьях'
            : friend.incoming
              ? 'Входящая заявка'
              : 'Заявка отправлена';
        row.append(name, status);
        for (const [action, label] of friend.status === 'pending' && friend.incoming
          ? [
              ['accept', 'Принять'],
              ['remove', 'Отклонить']
            ]
          : [['remove', friend.status === 'accepted' ? 'Удалить' : 'Отменить']]) {
          const button = document.createElement('button');
          button.className = 'btn';
          button.textContent = label;
          button.onclick = () => mutate({ action, code: friend.id });
          row.append(button);
        }
        $('friendsList').append(row);
      }
    } catch (error) {
      if (current !== generation) return;
      code = '';
      $('friendCode').textContent = '';
      $('friendForm').hidden = true;
      $('copyFriendCode').hidden = true;
      $('friendsMessage').textContent = error.message;
    }
  }
  async function mutate(body) {
    if (busy) return;
    busy = true;
    try {
      await request(body);
      $('friendInput').value = '';
      await refresh();
    } catch (error) {
      $('friendsMessage').textContent = error.message;
    } finally {
      busy = false;
    }
  }
  $('openFriends').onclick = () => {
    $('friendsDialog').showModal();
    refresh();
  };
  $('closeFriends').onclick = () => {
    generation++;
    $('friendsDialog').close();
  };
  $('friendsDialog').addEventListener('close', () => {
    generation++;
  });
  $('refreshFriends').onclick = refresh;
  $('friendForm').onsubmit = (event) => {
    event.preventDefault();
    mutate({ action: 'request', code: $('friendInput').value.trim().toLowerCase() });
  };
  $('copyFriendCode').onclick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      $('friendsMessage').textContent = 'Код скопирован';
    } catch {
      $('friendsMessage').textContent = 'Выделите и скопируйте код выше.';
    }
  };
}

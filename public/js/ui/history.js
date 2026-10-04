import { socket } from '../core/socket.js';
import { $ } from '../core/dom.js';

export function initHistory() {
  let account = null;
  let revision = 0;
  const panel = $('matchHistory');
  const dialog = $('historyDialog');
  $('openHistory').onclick = () => {
    dialog.showModal();
    refresh();
  };
  $('closeHistory').onclick = () => dialog.close();
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dialog.close();
  });
  const labels = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' };
  function line(text, tag = 'p') {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  }
  async function refresh() {
    const current = ++revision;
    panel.replaceChildren();
    if (!account) {
      panel.append(line('Войдите в аккаунт, чтобы смотреть статистику матчей.'));
      const link = document.createElement('a');
      link.href = '#authDialog';
      link.textContent = 'ВОЙДИТЕ';
      link.className = 'btn';
      link.onclick = (event) => {
        event.preventDefault();
        dialog.close();
        $('openAuth').click();
      };
      panel.append(link);
      return;
    }
    panel.append(line('Загрузка статистики…'));
    try {
      const response = await fetch('/api/auth/history');
      if (current !== revision) return;
      if (response.status === 401) {
        account = null;
        refresh();
        return;
      }
      if (!response.ok) throw new Error();
      const { history } = await response.json();
      if (current !== revision) return;
      panel.replaceChildren();
      const count = (result) => history.filter((entry) => entry.result === result).length;
      panel.append(
        line(
          `Матчей: ${history.length} · Побед: ${count('win')} · Поражений: ${count('loss')} · Ничьих: ${count('draw')}`
        )
      );
      panel.append(line('Последние 500 матчей аккаунта, включая игры с ботами.'));
      if (!history.length) panel.append(line('Здесь появятся результаты новых матчей.'));
      for (const entry of history) {
        const row = document.createElement('article');
        row.className = `panel history-${Object.hasOwn(labels, entry.result) ? entry.result : 'draw'}`;
        row.append(
          line(`${labels[entry.result]}${entry.surrendered ? ' · Вы сдались' : ''}`, 'h3'),
          line(`${new Date(entry.date).toLocaleString('ru-RU')} · ${entry.mode}`),
          line(`Соперники: ${entry.opponents}`),
          line(entry.rules)
        );
        panel.append(row);
      }
    } catch {
      if (current !== revision) return;
      panel.replaceChildren(line('Не удалось загрузить статистику.'));
      const retry = line('Повторить', 'button');
      retry.className = 'btn';
      retry.onclick = refresh;
      panel.append(retry);
    }
  }
  window.addEventListener('accountChanged', (event) => {
    account = event.detail;
    refresh();
  });
  socket.on('updateState', (state) => {
    if (state.status === 'finished' || state.surrendered) refresh();
  });
  socket.on('authExpired', () => {
    account = null;
    refresh();
  });
  refresh();
}

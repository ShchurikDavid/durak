import { $ } from '../core/dom.js';
function pluralCards(n) {
  const num = Number(n) || 0;
  if (num % 10 === 1 && num % 100 !== 11) return 'карта';
  if (num % 10 >= 2 && num % 10 <= 4 && !(num % 100 >= 12 && num % 100 <= 14)) return 'карты';
  return 'карт';
}

function ensureMiniSeats() {
  const arena = $('arena');
  const table = $('table');
  if (!arena || !table) return null;

  let root = document.getElementById('miniSeats');
  if (!root) {
    // #miniSeats must be a SIBLING of #table, never its child: renderTable()
    // wipes #table's innerHTML on every state update, which would destroy
    // persistent seat markup placed inside it.
    root = document.createElement('div');
    root.id = 'miniSeats';
    for (let seat = 0; seat < 4; seat++) {
      const item = document.createElement('div');
      item.className = 'mini-seat';
      item.dataset.seat = String(seat);
      item.innerHTML = `
          <div class="mini-seat-name"></div>
          <div class="mini-seat-role"></div>
          <div class="mini-seat-backs"></div>
          <div class="mini-seat-count"></div>
        `;
      root.appendChild(item);
    }
    arena.appendChild(root);
  } else if (root.parentElement !== arena) {
    arena.appendChild(root);
  }
  return root;
}

function positionMiniSeats(root, table) {
  const arena = $('arena');
  if (!root || !table || !arena) return;
  const tableRect = table.getBoundingClientRect();
  const arenaRect = arena.getBoundingClientRect();
  root.style.left = tableRect.left - arenaRect.left + 'px';
  root.style.top = tableRect.top - arenaRect.top + 'px';
  root.style.width = tableRect.width + 'px';
  root.style.height = tableRect.height + 'px';
}

// Right when the game view first appears (or when a new player joins and
// the layout reflows: opponent panel hides, hand/arena resize, etc.), a
// synchronous getBoundingClientRect() read can land a frame too early and
// capture a stale/mid-transition box — the seats then cluster near the
// table's old (e.g. hidden-state) position until some later event happens
// to remeasure. A ResizeObserver watches #table's real rendered geometry
// directly and repositions the seats the moment it actually changes,
// including that very first layout pass, so there's no wrong-then-correct
// flash to chase.
let tableResizeObserver = null;
function ensureTableResizeObserver(table) {
  if (tableResizeObserver || typeof ResizeObserver === 'undefined') return;
  tableResizeObserver = new ResizeObserver(() => {
    const root = document.getElementById('miniSeats');
    const currentTable = $('table');
    if (root && currentTable) positionMiniSeats(root, currentTable);
  });
  tableResizeObserver.observe(table);
}

function participantRole(state, player) {
  if (player.surrendered) return { label: 'Сдался · наблюдает', kind: '' };
  if (!player.connected) return { label: 'Нет связи', kind: '' };
  if (state.status === 'waiting') return { label: 'Ожидает', kind: '' };
  if (state.status === 'paused') return { label: 'Пауза', kind: '' };
  if (state.status === 'finished')
    return {
      label:
        state.loserIndex == null
          ? 'Ничья'
          : state.loserIndex === player.index
            ? 'Проиграл'
            : 'Победил',
      kind: ''
    };
  const table = state.table || [];
  if (!player.cardCount && !state.deckCount && !table.length)
    return { label: 'Закончил', kind: '' };
  if (player.index === state.defenderIndex)
    return {
      label: table.some((pair) => !pair.defend) ? 'Отбивается' : 'Защищается',
      kind: 'defender'
    };
  if (player.index === state.attackerIndex) return { label: 'Ходит', kind: 'attacker' };
  return { label: table.length && player.cardCount ? 'Подкидывает' : 'Ожидает', kind: '' };
}

function renderPlayersAroundTable(state) {
  const table = $('table');
  if (!table || !Array.isArray(state?.players)) return;

  const root = ensureMiniSeats();
  if (!root) return;
  root.style.setProperty('--seat-count', String(state.players.length || 3));
  positionMiniSeats(root, table);
  ensureTableResizeObserver(table);

  const isMulti = Number(state.maxPlayers || state.playersTotal || state.players?.length || 2) > 2;
  const game = $('game');
  game.classList.toggle('durak-mp', isMulti);
  game.classList.toggle('durak-2p', !isMulti);

  root.style.display = isMulti ? 'block' : 'none';
  if (!isMulti) return;

  const seats = [...root.querySelectorAll('.mini-seat')];
  const players = [...state.players];
  const myIndex = players.findIndex((p) => p.isMe);

  seats.forEach((seat) => {
    seat.classList.remove('me', 'defender', 'attacker');
    const seatIndex = Number(seat.dataset.seat || 0);
    let player = null;

    if (players.length > 0) {
      // нормальное распределение по углам стола
      const order = [];
      for (let i = 0; i < players.length; i++) {
        const rel = (i - myIndex + players.length) % players.length;
        order.push({ rel, player: players[i] });
      }
      const found = order.find((item) => item.rel === seatIndex);
      if (found) player = found.player;
    }

    if (!player) {
      seat.style.display = 'none';
      return;
    }

    seat.style.display = 'flex';
    seat.classList.toggle('me', Boolean(player.isMe));
    const role = participantRole(state, player);
    if (role.kind) seat.classList.add(role.kind);
    seat.querySelector('.mini-seat-role').textContent = role.label;

    const name = seat.querySelector('.mini-seat-name');
    const count = seat.querySelector('.mini-seat-count');
    const backs = seat.querySelector('.mini-seat-backs');

    name.textContent = player.isMe ? 'Вы' : player.name || `Игрок ${player.index + 1}`;
    const cards = Number(player.cardCount || 0);
    count.textContent = `${cards} ${pluralCards(cards)}`;

    backs.innerHTML = '';
    for (let i = 0; i < Math.min(cards, 6); i++) {
      const back = document.createElement('span');
      back.className = 'mini-back';
      backs.appendChild(back);
    }
  });
}

export { renderPlayersAroundTable };

(() => {
  'use strict';

  const PATREON_URL = 'https://www.patreon.com/cw/Durakcardsgame';
  const SITE_AVATAR = '/site-avatar.jpg';
  const PATREON_LOGO = '/patreon-logo.png';
  const $ = id => document.getElementById(id);
  const lobby = $('lobby');
  const createButton = $('createRoom');

  if (!lobby || !createButton || typeof socket === 'undefined') return;

  function addSiteIcons() {
    const head = document.head;
    if (!head.querySelector('link[data-durak-avatar]')) {
      const icon = document.createElement('link');
      icon.rel = 'icon';
      icon.type = 'image/jpeg';
      icon.href = SITE_AVATAR;
      icon.dataset.durakAvatar = '1';
      head.appendChild(icon);
    }
    if (!head.querySelector('link[data-durak-apple]')) {
      const apple = document.createElement('link');
      apple.rel = 'apple-touch-icon';
      apple.href = SITE_AVATAR;
      apple.dataset.durakApple = '1';
      head.appendChild(apple);
    }
  }

  function relocateRoomBadge() {
    const game = $('game');
    const top = game?.querySelector('.top');
    const badge = $('roomBadge');
    if (!game || !top || !badge) return;
    let header = game.querySelector('.durak-room-header');
    if (!header) {
      header = document.createElement('div');
      header.className = 'durak-room-header';
      game.insertBefore(header, top);
    }
    if (badge.parentElement !== header) header.appendChild(badge);
  }

  function injectStyles() {
    if (document.getElementById('durakEnhancementStyles')) return;
    const style = document.createElement('style');
    style.id = 'durakEnhancementStyles';
    style.textContent = `
      /* Patreon: just the white logo in the corner, no big banner in-game/lobby. */
      .durak-patreon-float{
        position:fixed;left:12px;top:12px;z-index:1000;
        width:46px;height:46px;display:grid;place-items:center;
        border-radius:13px;background:#0b0b0b;
        border:1px solid rgba(255,255,255,.16);
        box-shadow:0 7px 20px rgba(0,0,0,.35);
        transition:transform .15s,filter .15s;
      }
      .durak-patreon-float:hover{transform:translateY(-1px);filter:brightness(1.1)}
      .durak-patreon-float img{width:25px;height:26px;object-fit:contain;display:block}

      /* Lobby player count */
      .player-count-wrap{margin-top:10px}
      .player-count-title{font-weight:900;color:var(--gold);margin:0 0 9px}
      .player-count-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
      .player-count-option{position:relative}
      .player-count-option input{position:absolute;opacity:0;pointer-events:none}
      .player-count-option label{
        display:flex;align-items:center;justify-content:center;min-height:48px;padding:8px;
        border:1px solid rgba(212,175,55,.25);border-radius:12px;
        background:rgba(255,255,255,.035);color:#fff;font-weight:900;
        cursor:pointer;transition:.15s;text-align:center
      }
      .player-count-option input:checked+label{
        border-color:var(--gold);background:rgba(212,175,55,.14);color:var(--gold);
        box-shadow:0 0 0 1px rgba(212,175,55,.25) inset
      }
      .player-count-note{font-size:.7rem;color:#9fa9a2;margin-top:7px;text-align:center}

      /* 3-4 player seats. They live inside the table, so there is no viewport geometry jump. */
      .multi-players-around{
        position:absolute;inset:0;z-index:8;pointer-events:none;
        display:block;
      }
      .multi-player-seat{
        position:absolute;width:100px;min-height:67px;padding:5px 6px;
        display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
        border:1px solid rgba(212,175,55,.30);border-radius:11px;
        background:rgba(4,12,8,.88);backdrop-filter:blur(3px);
        box-shadow:0 5px 12px rgba(0,0,0,.30);
      }
      .multi-player-seat.me{border-color:rgba(212,175,55,.58)}
      .multi-player-seat.defender{border-color:rgba(219,78,78,.68);box-shadow:0 0 0 1px rgba(219,78,78,.22),0 5px 12px rgba(0,0,0,.30)}
      .multi-seat-top{top:7px;left:50%;transform:translateX(-50%)}
      .multi-seat-right{right:8px;top:50%;transform:translateY(-50%)}
      .multi-seat-left{left:8px;top:50%;transform:translateY(-50%)}
      .multi-seat-bottom{bottom:7px;left:50%;transform:translateX(-50%)}
      .multi-player-name{width:100%;font-size:.67rem;font-weight:900;color:#fff;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .multi-backs{height:25px;display:flex;justify-content:center;align-items:center}
      .mini-back{
        width:17px;height:24px;flex:0 0 auto;border-radius:3px;border:1px solid #fff;
        background:url('/cards/bicycle-classic/backs/red.png') center/cover no-repeat;
        margin-left:-7px;box-shadow:0 2px 4px rgba(0,0,0,.45)
      }
      .mini-back:first-child{margin-left:0}
      .multi-player-state{font-size:.57rem;font-weight:800;color:#c7cfca;text-align:center;line-height:1.05;white-space:nowrap}
      .multi-player-seat.defender .multi-player-state{color:#ff9c9c}
      .multi-player-seat:not(.defender) .multi-player-state.attacking{color:#b9edbd}
      .mini-count{font-size:.55rem;color:var(--gold);font-weight:900;line-height:1}

      /* No player seats/panels in a 2-player game. Original opponent backs stay visible. */
      #multiPlayers{display:none!important}
      #game.durak-2p #multiPlayers{display:none!important}
      #game.durak-mp #opponent,#game.durak-mp .opponent-label{display:none!important}


      /* Room badge: own row, always centered and never clipped by the status layout. */
      .durak-room-header{
        width:100%;min-height:42px;display:flex;align-items:center;justify-content:center;
        padding:3px 52px 0;position:relative;z-index:5;
      }
      #game .top #roomBadge{position:static!important;left:auto!important;right:auto!important;top:auto!important;
        transform:none!important;max-width:min(92vw,520px)!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        margin:0 auto!important;text-align:center;z-index:auto;
      }
      #game > .durak-room-header #roomBadge{
        position:static!important;display:block;max-width:min(92vw,520px)!important;
        padding:7px 12px;
      }

      /* Mobile top actions: invite + exit immediately below the status bar. */
      .mobile-top-actions{display:none}

      @media(max-width:600px){
        .durak-patreon-float{left:8px;top:8px;width:40px;height:40px;border-radius:11px}
        .durak-patreon-float img{width:22px;height:23px}
        .player-count-grid{gap:6px}
        .player-count-option label{min-height:45px;font-size:.78rem}

        #game > .durak-room-header{min-height:50px;padding:6px 8px 2px}
        #game > .durak-room-header #roomBadge{max-width:calc(100vw - 26px)!important;font-size:.78rem;padding:7px 10px}
        #game .top{min-height:54px}
        .mobile-top-actions{
          display:grid;grid-template-columns:1fr 1fr;gap:7px;
          width:100%;margin:1px 0 2px;
        }
        .mobile-top-actions .btn{min-height:42px;font-size:.72rem}
        .mobile-top-actions #mobileShare{background:linear-gradient(135deg,#1976d2,#0d47a1);border-color:#42a5f5}
        .mobile-top-actions #mobileLeave{background:#252525;border-color:#555}

        /* Stable mobile arena: table always keeps one aspect ratio instead of min-height fighting the viewport. */
        #game #arena{
          display:grid!important;
          grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;
          grid-template-rows:auto auto;
          grid-template-areas:"table table" "actions info";
          gap:7px!important;align-items:center;
          min-height:0!important;
          width:100%;
        }
        #game #table{
          grid-area:table!important;
          width:100%!important;
          height:auto!important;
          min-height:0!important;
          aspect-ratio:1.72 / 1!important;
          padding:9px!important;
          border-width:6px!important;
          border-radius:28% / 20%!important;
          overflow:hidden!important;
        }
        #game #table::before{inset:5px!important;border-radius:28% / 20%!important}
        #game .actions{grid-area:actions!important;min-width:0;gap:7px}
        #game .info{grid-area:info!important;min-width:0;min-height:62px!important;padding:6px!important;overflow:hidden}
        #game #trump img{width:48px!important;height:67px!important}
        #game #hand{width:100%;min-height:0;padding-top:3px}
        #game .multi-players-around{inset:0}
        #game .multi-player-seat{width:82px;min-height:57px;padding:4px 5px}
        #game .multi-seat-top{top:6px}
        #game .multi-seat-right{right:5px}
        #game .multi-seat-left{left:5px}
        #game .multi-seat-bottom{bottom:6px}
        #game .multi-player-name{font-size:.57rem}
        #game .multi-player-state{font-size:.5rem}
        #game .mini-back{width:14px;height:20px;margin-left:-6px}
        #game .multi-backs{height:21px}
        #game .mini-count{font-size:.48rem}

        /* Hide the desktop versions while keeping Bito/Take/New game in their original area. */
        #shareRoom,#leave{display:none!important}
      }

      @media(max-width:380px){
        #game #table{aspect-ratio:1.58 / 1!important}
        #game .multi-player-seat{width:72px;min-height:52px}
        #game .multi-player-name{font-size:.52rem}
        #game .multi-player-state{font-size:.45rem}
        #game .mini-back{width:12px;height:17px;margin-left:-5px}
        .mobile-top-actions .btn{font-size:.64rem}
      }

      @media(max-height:620px) and (orientation:landscape){
        #game #arena{grid-template-columns:100px minmax(0,1fr) 110px!important;grid-template-areas:none;display:grid!important;min-height:0!important}
        #game #table{grid-area:auto!important;aspect-ratio:1.85 / 1!important;max-height:62vh}
        #game .actions,#game .info{grid-area:auto!important}
      }

      /* Card filters: a visible translucent film over the card, never card opacity. */
      #game #hand .durak-card-filter{
        position:relative;
        display:block;
        line-height:0;
        width:var(--card-w);
        height:calc(var(--card-w)*1.4);
        flex:0 0 var(--card-w);
        min-width:var(--card-w);
        min-height:calc(var(--card-w)*1.4);
        vertical-align:bottom;
        overflow:visible;
      }
      #game #hand .durak-card-filter::after{
        content:"";
        position:absolute;
        inset:0;
        z-index:3;
        pointer-events:none;
        border-radius:8px;
        opacity:0;
        transition:opacity .14s ease, background .14s ease;
      }
      #game #hand .durak-card-filter.can::after{
        opacity:1;
        background:rgba(174,232,184,.30);
        box-shadow:inset 0 0 0 1px rgba(190,244,198,.28);
      }
      #game #hand .durak-card-filter.cant::after{
        opacity:1;
        background:rgba(86,94,88,.30);
        box-shadow:inset 0 0 0 1px rgba(120,128,122,.14);
      }
      #game #hand .durak-card-filter .card{display:block}
      #game #hand .durak-card-can,
      #game #hand .durak-card-cant{
        filter:none!important;
        opacity:1!important;
      }

      /* Mobile hand: keep every card fully inside the viewport even on wide-DPI phones. */
      @media(max-width:900px){
        #game #hand{
          width:100%!important;
          max-width:100%!important;
          flex-wrap:nowrap!important;
          justify-content:center!important;
          gap:2px!important;
          overflow:hidden!important;
          padding-left:3px!important;
          padding-right:3px!important;
        }
        #game #hand .durak-card-filter{
          width:min(74px,calc((100vw - 34px)/6))!important;
          height:calc(min(74px,calc((100vw - 34px)/6))*1.4)!important;
          min-width:min(74px,calc((100vw - 34px)/6))!important;
          min-height:calc(min(74px,calc((100vw - 34px)/6))*1.4)!important;
          flex:0 0 min(74px,calc((100vw - 34px)/6))!important;
        }
        #game #hand .card{
          width:100%!important;
          max-width:100%!important;
          height:auto!important;
          flex:none!important;
        }
      }

      @media(max-width:600px){
        #status{font-size:.94rem!important}
      }
    `;
    document.head.appendChild(style);
  }

  function removeOldPatreon() {
    const old = document.getElementById('durakPatreon');
    if (old) old.remove();
  }

  function injectPatreon() {
    removeOldPatreon();
    if (document.getElementById('durakPatreonFloat')) return;
    const link = document.createElement('a');
    link.id = 'durakPatreonFloat';
    link.className = 'durak-patreon-float';
    link.href = PATREON_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = 'Поддержать проект на Patreon';
    link.setAttribute('aria-label', 'Поддержать проект на Patreon');
    link.innerHTML = `<img src="${PATREON_LOGO}" alt="Patreon">`;
    document.body.appendChild(link);
  }

  function injectPlayerCount() {
    if (document.getElementById('playerCountWrap')) return;
    const title = lobby.querySelector('.mode-title');
    if (!title || !title.parentElement) return;

    const wrap = document.createElement('div');
    wrap.id = 'playerCountWrap';
    wrap.className = 'player-count-wrap';
    wrap.innerHTML = `
      <div class="player-count-title">👥 Количество игроков</div>
      <div class="player-count-grid">
        <div class="player-count-option"><input type="radio" name="maxPlayers" id="players2" value="2" checked><label for="players2">2 игрока</label></div>
        <div class="player-count-option"><input type="radio" name="maxPlayers" id="players3" value="3"><label for="players3">3 игрока</label></div>
        <div class="player-count-option"><input type="radio" name="maxPlayers" id="players4" value="4"><label for="players4">4 игрока</label></div>
      </div>
      <div class="player-count-note">Все игроки подключаются в одну комнату. Игра начинается, когда собралось выбранное количество.</div>
    `;
    title.parentElement.insertBefore(wrap, createButton);
  }

  function selectedPlayerCount() {
    return Number(document.querySelector('input[name="maxPlayers"]:checked')?.value || 2);
  }

  createButton.onclick = () => {
    const mode = typeof selectedGameMode === 'function'
      ? selectedGameMode()
      : (document.querySelector('input[name="gameMode"]:checked')?.value || '36');
    socket.emit('createRoom', { mode, maxPlayers: selectedPlayerCount() });
  };

  function createMobileActions() {
    if ($('mobileTopActions')) return;
    const top = document.querySelector('#game .top');
    if (!top) return;
    const wrap = document.createElement('div');
    wrap.id = 'mobileTopActions';
    wrap.className = 'mobile-top-actions';
    wrap.innerHTML = `
      <button id="mobileShare" class="btn" type="button">🔗 Пригласить</button>
      <button id="mobileLeave" class="btn" type="button">Выйти</button>
    `;
    top.insertAdjacentElement('afterend', wrap);

    $('mobileShare').onclick = () => $('shareRoom')?.click();
    $('mobileLeave').onclick = () => $('leave')?.click();
  }

  function seatClassesForPlayers(players, player) {
    const count = players.length;
    const myIndex = Math.max(0, players.findIndex(p => p.isMe));
    const relative = (players.indexOf(player) - myIndex + count) % count;

    if (relative === 0) return 'multi-seat-bottom';
    if (count === 3) return relative === 1 ? 'multi-seat-top' : 'multi-seat-right';
    if (relative === 1) return 'multi-seat-top';
    if (relative === 2) return 'multi-seat-right';
    return 'multi-seat-left';
  }

  function pluralCards(n) {
    const num = Number(n) || 0;
    if (num % 10 === 1 && num % 100 !== 11) return 'карта';
    if (num % 10 >= 2 && num % 10 <= 4 && !(num % 100 >= 12 && num % 100 <= 14)) return 'карты';
    return 'карт';
  }


  function cardSuitColor(suit) {
    return suit === 'H' || suit === 'D' ? 'red' : 'black';
  }

  function localCanDefend(attack, defend, trumpSuit) {
    if (!attack || !defend) return false;
    if (defend.joker) {
      if (attack.joker) return false;
      const attackRed = cardSuitColor(attack.suit) === 'red';
      return defend.color === 'red' ? attackRed : !attackRed;
    }
    if (attack.joker || !trumpSuit) return false;
    if (attack.suit === defend.suit) {
      const ranks = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13,A:14};
      return (ranks[defend.val] || 0) > (ranks[attack.val] || 0);
    }
    return defend.suit === trumpSuit && attack.suit !== trumpSuit;
  }


  function prepareCardFilterOverlays() {
    const hand = $('hand');
    if (!hand) return;
    const cardImages = [...hand.querySelectorAll('img.card')];
    cardImages.forEach(img => {
      if (img.parentElement?.classList.contains('durak-card-filter')) return;
      const wrap = document.createElement('span');
      wrap.className = 'durak-card-filter';
      img.parentNode.insertBefore(wrap, img);
      wrap.appendChild(img);
    });
  }

  function syncCardFilterOverlay(img, mode) {
    const wrap = img?.parentElement?.classList?.contains('durak-card-filter')
      ? img.parentElement
      : null;
    if (!wrap) return;
    wrap.classList.remove('can', 'cant');
    if (mode === 'can') wrap.classList.add('can');
    if (mode === 'cant') wrap.classList.add('cant');
  }

  function highlightPlayableCards(state) {
    const hand = $('hand');
    if (!hand) return;
    prepareCardFilterOverlays();
    const cards = [...hand.querySelectorAll('img.card')];
    cards.forEach(img => {
      img.classList.remove('durak-card-can','durak-card-cant');
      syncCardFilterOverlay(img, null);
    });

    const myIndex = Number(state?.myIndex);
    const myCards = Array.isArray(state?.myHand) ? state.myHand : [];
    if (state?.status !== 'playing' || !Number.isInteger(myIndex) || !state.turn) return;

    let isMyTurn = false;
    let canPlay = () => false;

    if (state.turn === 'attacker' && myIndex === Number(state.attackerIndex ?? -1)) {
      isMyTurn = true;
      const tableValues = Array.isArray(state.table)
        ? [...new Set(state.table.flatMap(pair => [pair.attack?.val, pair.defend?.val].filter(Boolean)))]
        : [];
      const limit = Number(state.attackLimit || 6);
      const tableLength = Array.isArray(state.table) ? state.table.length : 0;
      // На первой атаке разрешены любые карты, включая козыри.
      canPlay = card => tableLength === 0 || (tableLength < limit && tableValues.includes(card.val));
    } else if (state.turn === 'defender' && myIndex === Number(state.defenderIndex ?? -1)) {
      isMyTurn = true;
      const openPair = Array.isArray(state.table) ? state.table.find(pair => !pair.defend) : null;
      canPlay = card => Boolean(openPair) && localCanDefend(openPair.attack, card, state.trumpCard?.suit);
    }

    if (!isMyTurn) return;

    if (state.turn === 'attacker' && Array.isArray(state.table) && state.table.length === 0) {
      return;
    }

    myCards.forEach((card, index) => {
      const img = cards[index];
      if (!img) return;
      const playable = canPlay(card);
      img.classList.add(playable ? 'durak-card-can' : 'durak-card-cant');
      syncCardFilterOverlay(img, playable ? 'can' : 'cant');
    });
  }

  function renderPlayersAroundTable(state) {
    const table = $('table');
    if (!table || !Array.isArray(state?.players)) return;

    let host = document.getElementById('multiPlayers');
    if (!host) {
      host = document.createElement('div');
      host.id = 'multiPlayers';
      host.className = 'multi-players-around';
      table.appendChild(host);
    } else if (host.parentElement !== table) {
      table.appendChild(host);
    }

    const isMulti = Number(state.maxPlayers || state.playersTotal || state.players?.length || 2) > 2;
    const game = $('game');
    game.classList.toggle('durak-mp', isMulti);
    game.classList.toggle('durak-2p', !isMulti);

    if (!isMulti) {
      host.innerHTML = '';
      return;
    }

    host.innerHTML = '';
    const players = state.players.slice(0, 4);
    players.forEach(player => {
      const item = document.createElement('div');
      item.className = `multi-player-seat ${seatClassesForPlayers(players, player)}${player.isMe ? ' me' : ''}${player.isDefender ? ' defender' : ''}`;

      const label = player.isMe ? 'Вы' : (player.name || `Игрок ${player.index + 1}`);
      const connected = Boolean(player.connected);
      let stateText = '🃏 В игре';
      if (!connected) stateText = '⏸️ Отключён';
      else if (player.isDefender) stateText = '🛡️ Защищается';
      else if (state.turn === 'attacker') stateText = '⚔️ Атакует';

      item.innerHTML = `
        <div class="multi-player-name"></div>
        <div class="multi-backs"></div>
        <div class="mini-count"></div>
        <div class="multi-player-state"></div>
      `;
      item.querySelector('.multi-player-name').textContent = label;
      item.querySelector('.mini-count').textContent = `${player.cardCount ?? 0} ${pluralCards(player.cardCount)}`;
      item.querySelector('.multi-player-state').textContent = stateText;

      const backs = item.querySelector('.multi-backs');
      const count = Math.min(6, Math.max(0, Number(player.cardCount) || 0));
      for (let i = 0; i < count; i++) {
        const back = document.createElement('span');
        back.className = 'mini-back';
        backs.appendChild(back);
      }
      host.appendChild(item);
    });
  }

  function refreshResponsiveLayout() {
    if (typeof currentState !== 'undefined' && currentState) renderPlayersAroundTable(currentState);
  }

  if (socket?.on) {
    socket.on('updateState', state => {
      currentState = state;
      renderPlayersAroundTable(state);
      createMobileActions();
      {
        const badge = $('roomBadge');
        if (badge && state.roomCode) {
          const total = Number(state.maxPlayers || state.playersTotal || state.players?.length || 2);
          const connected = Number(state.playersConnected || 0);
          const modeLabel = state.gameModeLabel || (state.gameMode === '54' ? '52 + 2 джокера' : state.gameMode === '52' ? '52 карты' : state.gameMode === '24' ? '24 карты' : '36 карт');
          badge.textContent = `Комната ${state.roomCode} · ${connected}/${total} · ${modeLabel}`;
        }
      }

      // Нормализуем формулировки верхнего статуса для более понятного интерфейса.
      const status = $('status');
      if (status && state.status === 'playing') {
        const isDefender = state.role === 'Защищающийся';
        if (state.turn === 'attacker') {
          status.textContent = isDefender ? '🔴 Соперник атакует' : '🟢 Ваш ход — атакуйте';
        } else if (state.turn === 'defender') {
          status.textContent = isDefender ? '🟢 Ваш ход — защищайтесь' : '🔴 Соперник защищается';
        }
      }

      window.setTimeout(() => {
        prepareCardFilterOverlays();
        highlightPlayableCards(state);
      }, 0);
    });
  }


  const handObserver = new MutationObserver(() => {
    prepareCardFilterOverlays();
    if (currentState) highlightPlayableCards(currentState);
  });
  const handElement = $('hand');
  if (handElement) {
    handObserver.observe(handElement, {childList:true, subtree:true});
  }

  addSiteIcons();
  injectStyles();
  relocateRoomBadge();
  injectPatreon();
  injectPlayerCount();
  createMobileActions();

  window.addEventListener('resize', () => {
    window.clearTimeout(window.__durakLayoutTimer);
    window.__durakLayoutTimer = window.setTimeout(refreshResponsiveLayout, 80);
  });
})();

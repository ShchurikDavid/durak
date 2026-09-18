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

      /* 3-4 player seats — mini badges anchored to the four corners of the
         table. #miniSeats itself is a sibling of #table (never its child,
         since renderTable() wipes #table's innerHTML on every update —
         putting persistent seat markup inside it would get destroyed).
         Its position/size is set from JS to exactly match #table's current
         rect, so it tracks the table through every breakpoint and resize. */
      #miniSeats{
        position:absolute;
        pointer-events:none;
        z-index:1000;
      }

      .mini-seat{
        position:absolute;
        width:100px;
        min-height:67px;
        padding:5px 6px;
        display:none;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:2px;
        border:1px solid rgba(212,175,55,.30);
        border-radius:11px;
        background:rgba(4,12,8,.95);
        backdrop-filter:blur(3px);
        box-shadow:0 8px 20px rgba(0,0,0,.50);
      }

      .mini-seat.me{
        border-color:rgba(212,175,55,.58);
      }

      .mini-seat.defender{
        border-color:rgba(219,78,78,.68);
        box-shadow:0 0 0 1px rgba(219,78,78,.22),0 5px 12px rgba(0,0,0,.30);
      }
      .mini-seat.attacker{border-color:#72d99b}
      .mini-seat-role{
        font-size:.6rem;font-weight:800;line-height:1.25;
        text-align:center;color:#bdc8c0;max-width:100%;overflow-wrap:anywhere;
      }
      .mini-seat.attacker .mini-seat-role{color:#94edb6}
      .mini-seat.defender .mini-seat-role{color:#ffaaa5}

      /* Corners, nudged a bit past the table's own edge so a small table
         with just a couple of cards on it never overlaps a seat badge. */
      .mini-seat[data-seat="0"]{bottom:-14px;left:-14px}
      .mini-seat[data-seat="1"]{top:-14px;left:-14px}
      .mini-seat[data-seat="2"]{top:-14px;right:-14px}
      .mini-seat[data-seat="3"]{bottom:-14px;right:-14px}

      .mini-seat-name{
        width:100%;
        font-size:.67rem;
        font-weight:900;
        color:#fff;
        text-align:center;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }

      .mini-seat-backs{
        height:25px;
        display:flex;
        justify-content:center;
        align-items:center;
      }

      .mini-back{
        width:17px;
        height:24px;
        flex:0 0 auto;
        border-radius:3px;
        border:1px solid #fff;
        background:url('/cards/bicycle-classic/backs/red.png') center/cover no-repeat;
        margin-left:-7px;
        box-shadow:0 2px 4px rgba(0,0,0,.45);
      }

      .mini-back:first-child{ margin-left:0; }

      .mini-seat-count{
        font-size:.55rem;
        color:var(--gold);
        font-weight:900;
        line-height:1;
      }

      /* No player seats/panels in a 2-player game. Original opponent backs stay visible. */
      #game.durak-2p #miniSeats{display:none!important}
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
          position:relative;
          overflow:visible!important;
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
        #game #miniSeats{z-index:1000}
        #game .mini-seat{width:82px;min-height:57px;padding:4px 5px}
        #game .mini-seat[data-seat="0"]{bottom:-10px;left:-10px}
        #game .mini-seat[data-seat="1"]{top:-10px;left:-10px}
        #game .mini-seat[data-seat="2"]{top:-10px;right:-10px}
        #game .mini-seat[data-seat="3"]{bottom:-10px;right:-10px}
        #game .mini-seat-name{font-size:.57rem}
        #game .mini-back{width:14px;height:20px;margin-left:-6px}
        #game .mini-seat-backs{height:21px}
        #game .mini-seat-count{font-size:.48rem}

        /* Hide the desktop versions while keeping Bito/Take/New game in their original area. */
        #shareRoom,#leave{display:none!important}
      }

      @media(max-width:380px){
        #game #table{aspect-ratio:1.58 / 1!important}
        #game .mini-seat{width:72px;min-height:52px}
        #game .mini-seat-name{font-size:.52rem}
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
      /* На ПК серую заливку "нельзя ходить" делаем заметнее — на большом
         экране прежней прозрачности не хватало, чтобы отличить карты
         с первого взгляда. На телефоне оставляем как было. */
      @media(min-width:601px){
        #game #hand .durak-card-filter.cant::after{
          background:rgba(40,44,42,.52);
          box-shadow:inset 0 0 0 1px rgba(120,128,122,.22);
        }
      }
      #game #hand .durak-card-filter .card{display:block}
      #game #hand .durak-card-can,
      #game #hand .durak-card-cant{
        filter:none!important;
        opacity:1!important;
      }

      /* Mobile hand: let the same overlap system as desktop do the work —
         the JS-computed overlap (now applied to this very wrapper, see
         prepareCardFilterOverlays) already shrinks the row to fit any
         card count. We only need to make sure nothing wraps to a new line
         and that if overlap alone still isn't enough, cards scroll instead
         of being clipped off-screen (never overflow:hidden here). */
      @media(max-width:900px){
        #game #hand{
          width:100%!important;
          max-width:100%!important;
          flex-wrap:nowrap!important;
          justify-content:center!important;
        }
      }

      @media(max-width:600px){
        #status{font-size:.94rem!important}
      }

      /* Keep game overlays inside the arena, below every modal. */
      #game #arena{isolation:isolate}
      #game #miniSeats{z-index:10}
      .durak-patreon-float,#music{z-index:20}
      .result-modal{max-height:calc(100dvh - 32px);overflow-y:auto}
      #resultLeave{background:#252525;border-color:#555;color:#fff}

      @media(max-width:600px), (max-height:500px) and (orientation:landscape){
        /* A separate row leaves the entire table available for six pairs. */
        #game #arena{
          grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;
          grid-template-areas:"seats seats" "table table" "actions info"!important;
          grid-template-rows:auto auto auto!important;
          align-content:start;
        }
        #game #miniSeats{
          position:relative!important;grid-area:seats;
          left:auto!important;top:auto!important;
          width:100%!important;height:auto!important;
          display:grid!important;
          grid-template-columns:repeat(var(--seat-count,3),minmax(0,1fr));
          gap:5px;z-index:1;
        }
        #game.durak-2p #miniSeats{display:none!important}
        #game .mini-seat{
          position:static!important;width:auto!important;min-width:0;
          min-height:52px!important;padding:4px!important;
          box-shadow:none;
        }
        #game #table{
          display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));
          grid-auto-rows:auto;align-content:center;align-items:center;
          gap:8px!important;padding:18px 14px!important;
          aspect-ratio:auto!important;min-height:210px!important;max-height:none!important;
          border-radius:24px!important;overflow:visible!important;
        }
        #game #table::before{border-radius:17px!important}
        #game #table .pair{
          width:min(100%,110px);height:auto;aspect-ratio:1 / 1.4;min-width:0;justify-self:center;
        }
        #game #table .card{width:80%;height:80%;border-radius:5px}
        #game #table .defend{top:20%;left:20%;transform:none}
      }
      @media(max-height:500px) and (orientation:landscape){
        #game #table .pair{width:min(100%,74px)}
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
      // Перекрытие карт (отрицательный margin-left) считается для самой
      // картинки, но раз она теперь вложена в обёртку — именно обёртка
      // занимает место в ряду #hand. Margin нужно перенести на неё,
      // иначе он ничего не "сжимает" и веер карт вылезает за экран.
      if (img.style.marginLeft) {
        wrap.style.marginLeft = img.style.marginLeft;
        img.style.marginLeft = '0';
      }
      // То же самое с z-index: он был нужен картинке, чтобы более поздние
      // карты в веере перекрывали более ранние. Но если оставить z-index
      // на самой картинке, она (начиная с 4-й карты, z-index > 3) рисуется
      // ПОВЕРХ собственной серо/зелёной заливки "можно/нельзя ходить" —
      // заливку становится не видно. Переносим z-index на обёртку, а с
      // картинки снимаем — тогда заливка (она рисуется поверх картинки
      // внутри той же обёртки) всегда видна, а нужный порядок наложения
      // карт друг на друга сохраняется на уровне обёрток.
      if (img.style.zIndex) {
        wrap.style.zIndex = img.style.zIndex;
        img.style.zIndex = '';
      }
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

    const isDefender = myIndex === Number(state.defenderIndex ?? -1);
    const isAttacker = myIndex !== Number(state.defenderIndex ?? -1); // In podkidnoy, all non-defenders can attack
    const isMulti = Number(state.maxPlayers || state.playersTotal || state.players?.length || 2) > 2;

    let isMyTurn = false;
    let canPlay = () => false;

    if (state.turn === 'attacker' && isAttacker) {
      isMyTurn = true;
      const tableValues = Array.isArray(state.table)
        ? [...new Set(state.table.flatMap(pair => [pair.attack?.val, pair.defend?.val].filter(Boolean)))]
        : [];
      const limit = Number(state.attackLimit ?? 6);
      const tableLength = Array.isArray(state.table) ? state.table.length : 0;
      const hasUndefended = Array.isArray(state.table) ? state.table.some(pair => !pair.defend) : false;
      // Джокером ходить (атаковать/подкидывать) нельзя — только защищаться им.
      // На первой атаке (пустой стол) разрешены любые обычные карты ТОЛЬКО главному атакующему.
      // Если есть незащищенные карты, можно подкидывать карты тех же рангов (все атакующие).
      // Если все защищены, можно подкидывать карты тех же рангов (обычные правила подкидного).
      canPlay = card => {
        if (card.joker) return false;
        if (tableLength >= limit) return false;
        if (tableLength === 0) {
          // Only main attacker can start
          return myIndex === Number(state.attackerIndex ?? -1);
        }
        return tableLength < limit && tableValues.includes(card.val);
      };
    } else if (isDefender) {
      // Defender can defend anytime there are undefended cards
      const openPair = Array.isArray(state.table) ? state.table.find(pair => !pair.defend) : null;
      if (openPair) {
        isMyTurn = true;
        canPlay = card => localCanDefend(openPair.attack, card, state.trumpCard?.suit);
      }
    }

    if (!isMyTurn) return;

    // На пустом столе (первая атака в раунде, включая джокер-режим) ничего
    // не подсвечиваем — карты остаются обычными/белыми, без заливки:
    // выбор карты здесь ограничен только запретом на джокер, а не рангом.
    const tableIsEmpty = state.turn === 'attacker' && Array.isArray(state.table) && state.table.length === 0;
    if (tableIsEmpty) return;

    myCards.forEach((card, index) => {
      const img = cards[index];
      if (!img) return;
      const playable = canPlay(card);
      img.classList.add(playable ? 'durak-card-can' : 'durak-card-cant');
      syncCardFilterOverlay(img, playable ? 'can' : 'cant');
    });
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
    root.style.left = (tableRect.left - arenaRect.left) + 'px';
    root.style.top = (tableRect.top - arenaRect.top) + 'px';
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
    if (!player.connected) return { label: 'Нет связи', kind: '' };
    if (state.status === 'waiting') return { label: 'Ожидает', kind: '' };
    if (state.status === 'paused') return { label: 'Пауза', kind: '' };
    if (state.status === 'finished') return {
      label: state.loserIndex == null ? 'Ничья' : state.loserIndex === player.index ? 'Проиграл' : 'Победил', kind: ''
    };
    const table = state.table || [];
    if (!player.cardCount && !state.deckCount && !table.length) return { label: 'Закончил', kind: '' };
    if (player.index === state.defenderIndex) return {
      label: table.some(pair => !pair.defend) ? 'Отбивается' : 'Защищается', kind: 'defender'
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
    const myIndex = players.findIndex(p => p.isMe);

    seats.forEach(seat => {
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
        const found = order.find(item => item.rel === seatIndex);
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

      name.textContent = player.isMe ? 'Вы' : (player.name || `Игрок ${player.index + 1}`);
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

      // Сервер учитывает очередь первого хода и игроков, закончивших карты.
      const status = $('status');
      if (status && state.statusText) status.textContent = state.statusText;

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

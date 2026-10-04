import { $ } from '../core/dom.js';
const PATREON_URL = 'https://www.patreon.com/cw/Durakcardsgame';
const SITE_AVATAR = '/site-avatar.jpg';
const PATREON_LOGO = '/patreon-logo.png';

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
  ($('game') || document.body).appendChild(link);
}

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

function fitGameViewport() {
  const game = $('game');
  if (!game) return;
  const height = window.visualViewport?.height || window.innerHeight;
  const compact = window.innerWidth <= 600;
  game.style.setProperty(
    '--card-w',
    `${Math.max(36, Math.min(120, height * (compact ? 0.105 : 0.12)))}px`
  );
  game.style.setProperty('--back-w', `${Math.max(24, Math.min(78, height * 0.075))}px`);
}

export function initSiteUI() {
  fitGameViewport();
  window.addEventListener('resize', fitGameViewport);
  window.visualViewport?.addEventListener('resize', fitGameViewport);
  addSiteIcons();
  relocateRoomBadge();
  injectPatreon();
  const header = document.querySelector('#game .durak-room-header');
  if (header) {
    let controls = header.querySelector('.game-header-controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'game-header-controls';
      header.appendChild(controls);
    }
    for (const id of ['music', 'gameSettings', 'durakPatreonFloat']) {
      const control = $(id);
      if (control) controls.appendChild(control);
    }
  }
  createMobileActions();
}

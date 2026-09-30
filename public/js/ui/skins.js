import { $, showToast } from '../core/dom.js';
import { session } from '../core/session.js';
import { SKINS, skin, selectSkin } from '../cards.js';
import { render } from './game.js';
function renderSkinGrid() {
  const grid = $('skinGrid');
  grid.innerHTML = '';
  Object.entries(SKINS).forEach(([id, cfg]) => {
    const card = document.createElement('div');
    card.className = 'skin-card' + (id === skin ? ' active' : '');
    const prev = document.createElement('div');
    prev.className = 'skin-preview';
    prev.style.backgroundImage = `url("${cfg.dir}${cfg.preview}"), url("${cfg.dir}${cfg.back}")`;
    prev.style.backgroundPosition = 'left center, right center';
    prev.style.backgroundSize = 'auto 100%, auto 100%';
    card.appendChild(prev);
    card.insertAdjacentHTML('beforeend', `${cfg.label}<small>${cfg.sub}</small>`);
    card.onclick = () => setSkin(id);
    grid.appendChild(card);
  });
}
function setSkin(id) {
  if (!selectSkin(id)) return;
  renderSkinGrid();
  if (session.currentState) render(session.currentState);
  showToast('Колода: ' + SKINS[id].label);
}
function openSkins() {
  renderSkinGrid();
  $('skinBackdrop').classList.remove('hidden');
}
export function initSkins() {
  $('openSkins').onclick = openSkins;
  $('settingsSkin').onclick = () => {
    $('settingsBackdrop').classList.add('hidden');
    openSkins();
  };
  $('closeSkins').onclick = () => $('skinBackdrop').classList.add('hidden');
  $('skinBackdrop').addEventListener('click', (e) => {
    if (e.target === $('skinBackdrop')) $('skinBackdrop').classList.add('hidden');
  });
}

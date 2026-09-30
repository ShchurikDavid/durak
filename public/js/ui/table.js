import { session } from '../core/session.js';
import { initSiteUI } from './site.js';
import { renderPlayersAroundTable } from './participants.js';

export function renderTableUI(state) {
  renderPlayersAroundTable(state);
}
export function initTableUI() {
  initSiteUI();
  let layoutTimer;
  window.addEventListener('resize', () => {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      if (session.currentState) renderPlayersAroundTable(session.currentState);
    }, 80);
  });
}

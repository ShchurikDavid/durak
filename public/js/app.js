import { socket } from './core/socket.js';
import { initSettings } from './settings.js';
import { initLobby, enterLobby } from './lobby.js';
import { initGameControls } from './ui/game.js';
import { initResultControls } from './ui/result.js';
import { initSkins } from './ui/skins.js';
import { initTableUI } from './ui/table.js';
import { initIcons } from './ui/icons.js';
import { initCreateRoomDialog } from './ui/create-room.js';
import { initAuth } from './auth.js';
import { initHistory } from './ui/history.js';

document.getElementById('openRules').addEventListener('click', () => {
  document.getElementById('rulesDialog').showModal();
});

initSettings();
initLobby();
initGameControls(enterLobby);
initResultControls(enterLobby);
initSkins();
initTableUI();
initCreateRoomDialog();
initIcons();
initHistory();
if (await initAuth()) socket.connect();

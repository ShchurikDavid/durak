import { session } from './core/session.js';
import { render } from './ui/game.js';
import { $ } from './core/dom.js';
import { getName } from './core/identity.js';
const bgMusic = $('bgMusic');
let musicOn = localStorage.getItem('durak_music') !== 'off',
  soundsOn = localStorage.getItem('durak_sounds') !== 'off',
  audioCtx = null;
let musicVolume = Number(localStorage.getItem('durak_music_volume') ?? 3),
  soundVolume = Number(localStorage.getItem('durak_sound_volume') ?? 100);
bgMusic.volume = musicVolume / 100;
function applyTheme() {
  document.body.classList.remove('theme-light', 'theme-blue');
  localStorage.removeItem('durak_theme');
}

function updateMusicButton(id, label) {
  const button = $(id);
  let icon = button.querySelector('img');
  if (!icon) {
    icon = document.createElement('img');
    icon.className = 'ui-icon';
    icon.alt = '';
    button.replaceChildren(icon, document.createElement('span'));
  }
  const src = '/icons/' + (musicOn ? 'sound-on' : 'sound-off') + '.svg';
  if (icon.getAttribute('src') !== src) icon.setAttribute('src', src);
  const text = button.querySelector('span');
  if (text && text.textContent !== label) text.textContent = label;
  button.setAttribute('aria-pressed', String(musicOn));
}
function updateMusicButtons() {
  updateMusicButton('music', '');
  updateMusicButton('lobbyMusic', musicOn ? 'Музыка: вкл.' : 'Музыка: выкл.');
  $('music').setAttribute('aria-label', musicOn ? 'Выключить музыку' : 'Включить музыку');
  if ($('settingsMusic')) $('settingsMusic').textContent = musicOn ? 'Вкл.' : 'Выкл.';
  if ($('settingsSounds')) $('settingsSounds').textContent = soundsOn ? 'Вкл.' : 'Выкл.';
  $('settingsMusic').setAttribute('aria-pressed', String(musicOn));
  $('settingsSounds').setAttribute('aria-pressed', String(soundsOn));
  if ($('musicVolume')) $('musicVolume').value = musicVolume;
  if ($('soundVolume')) $('soundVolume').value = soundVolume;
  if ($('soundVolumeValue')) $('soundVolumeValue').textContent = soundVolume + '%';
  if ($('musicVolumeValue')) $('musicVolumeValue').textContent = musicVolume + '%';
}
function ensureAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) {}
}
function playSound(type) {
  if (!soundsOn || soundVolume <= 0) return;
  try {
    ensureAudio();
    const now = audioCtx.currentTime;
    const duration = type === 'bito' || type === 'take' ? 0.06 : 0.08;
    const makeNoise = () => {
      const length = Math.floor(audioCtx.sampleRate * duration),
        buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate),
        data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      return buffer;
    };
    const hit = (at, volume) => {
      const source = audioCtx.createBufferSource(),
        gain = audioCtx.createGain(),
        filter = audioCtx.createBiquadFilter();
      source.buffer = makeNoise();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(type === 'defend' ? 450 : 350, at);
      gain.gain.setValueAtTime(volume * (soundVolume / 100), at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      source.start(at);
    };
    if (type === 'bito' || type === 'take') {
      hit(now, 0.28);
      hit(now + 0.05, 0.28);
      hit(now + 0.1, 0.28);
    } else hit(now, 0.42);
  } catch (_) {}
}
let musicRequest = 0;
async function toggleMusic() {
  const request = ++musicRequest;
  musicOn = !musicOn;
  localStorage.setItem('durak_music', musicOn ? 'on' : 'off');
  updateMusicButtons();
  bgMusic.volume = musicVolume / 100;
  if (!musicOn) {
    bgMusic.pause();
    return;
  }
  try {
    ensureAudio();
    await bgMusic.play();
  } catch (_) {
    if (request !== musicRequest) return;
    musicOn = false;
    localStorage.setItem('durak_music', 'off');
    updateMusicButtons();
  }
}
export function initSettings() {
  $('handSort').value = localStorage.getItem('durak.sort') || 'suit';
  $('handSort').onchange = () => {
    localStorage.setItem('durak.sort', $('handSort').value);
    if (session.currentState) render(session.currentState);
  };
  applyTheme();
  updateMusicButtons();
  $('music').addEventListener('click', () => {
    ensureAudio();
    toggleMusic();
  });
  $('lobbyMusic').addEventListener('click', () => {
    ensureAudio();
    toggleMusic();
  });
  document.addEventListener(
    'pointerdown',
    (event) => {
      ensureAudio();
      if (event.target.closest('#music,#lobbyMusic,#settingsMusic')) return;
      if (musicOn && bgMusic.paused) bgMusic.play().catch(() => {});
    },
    { once: true }
  );
  function openSettings() {
    $('settingsBackdrop').classList.remove('hidden');
    $('settingsName').value = getName();
    $('settingsNameError').textContent = '';
    updateMusicButtons();
  }
  $('openSettings').onclick = openSettings;
  $('clubSettings').onclick = openSettings;
  $('gameSettings').onclick = openSettings;
  $('settingsDismiss').onclick = () => $('settingsBackdrop').classList.add('hidden');
  $('closeSettings').onclick = () => $('settingsBackdrop').classList.add('hidden');
  $('settingsBackdrop').addEventListener('click', (e) => {
    if (e.target === $('settingsBackdrop')) $('settingsBackdrop').classList.add('hidden');
  });
  $('settingsMusic').onclick = () => {
    ensureAudio();
    toggleMusic();
  };
  $('settingsSounds').onclick = () => {
    soundsOn = !soundsOn;
    localStorage.setItem('durak_sounds', soundsOn ? 'on' : 'off');
    updateMusicButtons();
    if (soundsOn) playSound('click');
  };
  $('musicVolume').oninput = (e) => {
    musicVolume = Number(e.target.value);
    bgMusic.volume = musicVolume / 100;
    localStorage.setItem('durak_music_volume', musicVolume);
    updateMusicButtons();
  };
  $('soundVolume').oninput = (e) => {
    soundVolume = Number(e.target.value);
    localStorage.setItem('durak_sound_volume', soundVolume);
    updateMusicButtons();
  };
}
export { playSound };

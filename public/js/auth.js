import { revealSurface } from './ui/motion.js';
import { $, showToast } from './core/dom.js';
import { getName, setAccount } from './core/identity.js';
import { socket } from './core/socket.js';
import { session } from './core/session.js';
let googleScript;
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!googleScript)
    googleScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        googleScript = null;
        script.remove();
        reject(new Error('Google недоступен. Попробуйте открыть окно входа заново.'));
      };
      document.head.appendChild(script);
    });
  return googleScript;
}

async function request(action, body) {
  const response = await fetch(`/api/auth/${action}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(
      response.status === 404
        ? 'Сервер ещё не обновлён. Перезапустите сервер игры и обновите страницу.'
        : 'Сервер временно недоступен. Попробуйте позже.'
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Сервер вернул некорректный ответ. Обновите страницу и попробуйте снова.');
  }
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}
function updateUser(user, name) {
  setAccount(user);
  window.dispatchEvent(new CustomEvent('accountChanged', { detail: user }));
  if (!user && name) localStorage.setItem('durak_name', name);
  $('settingsName').value = getName();
  const status = $('accountStatus');
  const prefix = document.createElement('span');
  prefix.textContent = user ? 'Вы вошли как' : 'Гость:';
  const playerName = document.createElement('span');
  playerName.translate = false;
  playerName.textContent = user?.name || name || getName();
  status.replaceChildren(prefix, document.createTextNode(' '), playerName);
  $('openAuth').classList.toggle('hidden', !!user);
  $('logoutAccount').classList.toggle('hidden', !user);
}
export async function initAuth() {
  let mode = 'login';
  let busy = false;
  const welcome = $('welcomeDialog');
  let finishWelcome;
  let firstVisit = false;
  function route(screen, replace = false) {
    const url = new URL(location.href);
    url.hash = screen;
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
    document.body.classList.toggle('account-page-open', !!screen);
  }
  function leaveAccount() {
    closeAccount();
    if (!firstVisit) route('', true);
  }
  function updatePageAccess() {
    const active = !welcome.hidden || !dialog.hidden;
    document.body.classList.toggle('account-page-open', active);
    for (const element of document.body.children) {
      if (element !== welcome && element !== dialog) element.inert = active;
    }
  }
  function showPage(page) {
    welcome.hidden = page !== welcome;
    dialog.hidden = page !== dialog;
    updatePageAccess();
    const title = page.querySelector('h2');
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }
  function closeAccount() {
    dialog.hidden = true;
    hidePassword();
    $('authPassword').value = '';
    $('authConfirm').value = '';
    if (firstVisit) showWelcome();
    else updatePageAccess();
  }
  function completeWelcome() {
    firstVisit = false;
    try {
      localStorage.setItem('durak.welcome.v1', 'done');
    } catch {
      /* Private storage may be unavailable. */
    }
    welcome.hidden = true;
    route('', true);
    updatePageAccess();
    finishWelcome?.();
  }
  function showWelcome() {
    route('welcome', true);
    showPage(welcome);
    revealSurface(welcome.querySelector('.account-page-content'));
  }
  function openAccount(value) {
    welcome.hidden = true;
    setMode(value);
    if (location.hash !== `#${value}`) route(value);
    else document.body.classList.add('account-page-open');
    showPage(dialog);
    revealSurface($('authForm'));
    setupGoogle();
  }
  $('welcomeRegister').onclick = () => openAccount('register');
  $('welcomeLogin').onclick = () => openAccount('login');
  $('welcomeGuest').onclick = completeWelcome;
  const dialog = $('authDialog');
  function hidePassword() {
    $('authPassword').type = 'password';
    $('togglePassword').setAttribute('aria-label', 'Показать пароль');
    $('togglePassword').title = 'Показать пароль';
    $('togglePassword').setAttribute('aria-pressed', 'false');
  }
  $('togglePassword').onclick = () => {
    const show = $('authPassword').type === 'password';
    $('authPassword').type = show ? 'text' : 'password';
    $('togglePassword').setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    $('togglePassword').title = show ? 'Скрыть пароль' : 'Показать пароль';
    $('togglePassword').setAttribute('aria-pressed', String(show));
  };
  async function setupGoogle() {
    $('googleSignIn').replaceChildren();
    if (navigator.userAgent.includes('DurakAndroid/')) {
      $('googleSignInHint').textContent =
        'Для входа через Google откройте игру кнопкой «Браузер» вверху приложения. Здесь можно войти по почте и паролю.';
      return;
    }
    $('googleSignInHint').textContent = 'Подключение Google…';
    try {
      const config = await request('google/config');
      if (!config.enabled) {
        $('googleSignInHint').textContent = 'Вход через Google пока не подключён.';
        return;
      }
      await loadGoogle();
      if (dialog.hidden) return;
      window.google.accounts.id.initialize({
        client_id: config.clientId,
        nonce: config.nonce,
        auto_select: false,
        callback: async ({ credential }) => {
          if (busy || dialog.hidden) return;
          if (session.currentState) {
            $('authError').textContent = 'Сначала выйдите из комнаты.';
            return;
          }
          busy = true;
          $('authSubmit').disabled = true;
          $('authError').textContent = '';
          try {
            const data = await request('google', { credential });
            updateUser(data.user);
            completeWelcome();
            $('authPassword').value = '';
            closeAccount();
            socket.disconnect().connect();
            showToast('Вы вошли через Google');
          } catch (error) {
            $('authError').textContent = error.message;
            setupGoogle();
          } finally {
            busy = false;
            $('authSubmit').disabled = false;
          }
        }
      });
      window.google.accounts.id.renderButton($('googleSignIn'), {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        locale: 'ru'
      });
      $('googleSignInHint').textContent = 'Аккаунт создастся автоматически при первом входе.';
    } catch (error) {
      $('googleSignInHint').textContent = error.message;
    }
  }
  function setMode(value) {
    hidePassword();
    mode = value;
    $('authConfirm').value = '';
    $('authConfirm').required = mode === 'register';
    $('authConfirmLabel').classList.toggle('hidden', mode !== 'register');
    $('authTitle').textContent = mode === 'login' ? 'Вход в аккаунт' : 'Создание аккаунта';
    $('authSubmit').textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
    $('authSwitch').textContent = mode === 'login' ? 'Создать аккаунт' : 'Уже есть аккаунт? Войти';
    $('authNameLabel').classList.toggle('hidden', mode === 'login');
    $('authName').required = mode === 'register';
    $('authLogin').type = mode === 'register' ? 'email' : 'text';
    $('authLogin').autocomplete = mode === 'register' ? 'email' : 'username';
    $('loginHint').textContent =
      mode === 'register'
        ? 'Укажите вашу электронную почту'
        : 'Для старого аккаунта можно указать прежний логин.';
    $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('authError').textContent = '';
  }
  $('openAuth').onclick = () => {
    openAccount('login');
  };
  $('authSwitch').onclick = () => {
    if (!busy) {
      setMode(mode === 'login' ? 'register' : 'login');
      route(mode);
    }
  };
  $('cancelAuth').onclick = () => {
    if (!busy) leaveAccount();
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || (welcome.hidden && dialog.hidden)) return;
    event.preventDefault();
    if (busy) return;
    if (!dialog.hidden) leaveAccount();
    else completeWelcome();
  });
  $('authForm').onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (mode === 'register' && $('authPassword').value !== $('authConfirm').value) {
      $('authError').textContent = 'Пароли не совпадают.';
      $('authConfirm').focus();
      return;
    }
    if (session.currentState) {
      $('authError').textContent = 'Сначала выйдите из комнаты.';
      return;
    }
    busy = true;
    $('authSubmit').disabled = true;
    $('authError').textContent = '';
    try {
      const data = await request(mode, {
        email: $('authLogin').value.trim(),
        password: $('authPassword').value,
        name: $('authName').value.trim()
      });
      updateUser(data.user);
      completeWelcome();
      $('authPassword').value = '';
      closeAccount();
      socket.disconnect().connect();
      showToast(mode === 'register' ? 'Аккаунт создан!' : 'Вы вошли в аккаунт');
    } catch (error) {
      $('authError').textContent = error.message;
    } finally {
      busy = false;
      $('authSubmit').disabled = false;
    }
  };
  $('logoutAccount').onclick = async () => {
    if (session.currentState) return showToast('Сначала выйдите из комнаты.');
    $('logoutAccount').disabled = true;
    try {
      await request('logout', {});
      updateUser(null);
      socket.disconnect().connect();
    } catch (error) {
      showToast(error.message);
    } finally {
      $('logoutAccount').disabled = false;
    }
  };
  $('settingsNameForm').onsubmit = async (event) => {
    event.preventDefault();
    if ($('saveSettingsName').disabled) return;
    const name = $('settingsName').value.trim();
    if (!name || name.length > 20 || /[\x00-\x1f\x7f]/.test(name)) {
      $('settingsNameError').textContent = 'Введите ник от 1 до 20 символов.';
      return;
    }
    $('saveSettingsName').disabled = true;
    $('settingsNameError').textContent = '';
    try {
      const data = await request('name', { name });
      updateUser(data.user, data.name);
      showToast('Ник сохранён');
    } catch (error) {
      $('settingsNameError').textContent = error.message;
    } finally {
      $('saveSettingsName').disabled = false;
    }
  };
  window.addEventListener('popstate', () => {
    if (busy) return route(mode, true);
    const screen = location.hash.slice(1);
    if (screen === 'login' || screen === 'register') openAccount(screen);
    else if (screen === 'welcome') {
      closeAccount();
      showWelcome();
    } else {
      welcome.hidden = true;
      leaveAccount();
      updatePageAccess();
    }
  });
  socket.on('profileUpdated', (data) => updateUser(data.user, data.name));
  socket.on('authExpired', () =>
    showToast('Сессия завершилась. Обновите страницу для продолжения.')
  );
  try {
    const data = await request('me');
    updateUser(data.user, data.name);
    let seen = false;
    try {
      seen = localStorage.getItem('durak.welcome.v1') === 'done';
    } catch {
      /* Still offer guest access. */
    }
    if (data.user) completeWelcome();
    else if (!seen) {
      firstVisit = true;
      await new Promise((resolve) => {
        finishWelcome = resolve;
        const screen = location.hash.slice(1);
        if (screen === 'login' || screen === 'register') openAccount(screen);
        else showWelcome();
      });
    }
    if (['login', 'register'].includes(location.hash.slice(1))) openAccount(location.hash.slice(1));
    else if (location.hash === '#welcome') showWelcome();
    return true;
  } catch {
    showToast('Не удалось подключиться. Обновите страницу, чтобы повторить попытку.');
    return false;
  }
}

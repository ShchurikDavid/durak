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
  if (!user && name) localStorage.setItem('durak_name', name);
  $('settingsName').value = getName();
  $('accountStatus').textContent = user
    ? `Вы вошли как ${user.name}`
    : getName()
      ? `Гость: ${getName()}`
      : 'Играйте гостем или создайте аккаунт';
  $('openAuth').classList.toggle('hidden', !!user);
  $('logoutAccount').classList.toggle('hidden', !user);
}
export async function initAuth() {
  let mode = 'login';
  let busy = false;
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
  dialog.addEventListener('close', hidePassword);
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
      if (!dialog.open) return;
      window.google.accounts.id.initialize({
        client_id: config.clientId,
        nonce: config.nonce,
        auto_select: false,
        callback: async ({ credential }) => {
          if (busy || !dialog.open) return;
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
            $('authPassword').value = '';
            dialog.close();
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
    setMode('login');
    dialog.showModal();
    setupGoogle();
  };
  $('authSwitch').onclick = () => {
    if (!busy) setMode(mode === 'login' ? 'register' : 'login');
  };
  $('cancelAuth').onclick = () => {
    if (!busy) dialog.close();
  };
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  $('authForm').onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
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
      $('authPassword').value = '';
      dialog.close();
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
  socket.on('profileUpdated', (data) => updateUser(data.user, data.name));
  socket.on('authExpired', () =>
    showToast('Сессия завершилась. Обновите страницу для продолжения.')
  );
  try {
    const data = await request('me');
    updateUser(data.user, data.name);
    return true;
  } catch {
    showToast('Не удалось подключиться. Обновите страницу, чтобы повторить попытку.');
    return false;
  }
}

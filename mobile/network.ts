import { io, Socket } from 'socket.io-client';
import type { GameState, Room, User, Options } from './types';

export const DEFAULT_SERVER = 'https://game.durakcards.uk';

export function serverAddress(value: string) {
  const text = value.trim();
  const url = new URL(
    text === 'game.durakcards.uk' ? DEFAULT_SERVER : text.includes('://') ? text : `http://${text}`
  );
  const local =
    /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
      url.hostname
    );
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname) ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
  ) {
    throw new Error(
      'Укажите HTTPS-адрес сервера или локальный IP, например http://192.168.1.10:3000'
    );
  }
  return url.origin;
}

export type SessionStore = {
  get(address: string): Promise<string>;
  set(address: string, cookie: string): Promise<void>;
};

type Listeners = {
  state(s: GameState): void;
  rooms(rooms: Room[]): void;
  connection(connected: boolean): void;
  profile(user: User | null, name?: string): void;
  error(message: string): void;
  closed(): void;
  connectionIssue?(message: string): void;
};
export class NetworkGame {
  private socket?: Socket;
  private cookie = '';
  private restored?: Promise<void>;
  private disposed = false;
  private room = '';
  private requests = new Set<AbortController>();
  private retryTimer?: ReturnType<typeof setTimeout>;
  private starting = false;
  constructor(
    readonly address: string,
    private name: string,
    private listeners: Listeners,
    private retryDelay = 5000,
    private sessionStore?: SessionStore
  ) {}
  start() {
    if (this.disposed || this.starting || this.socket || this.retryTimer) return;
    this.starting = true;
    this.connect()
      .catch(() => {
        if (this.disposed) return;
        this.listeners.connection(false);
        this.listeners.connectionIssue?.('Нет связи с сервером. Пробуем подключиться снова…');
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined;
          this.start();
        }, this.retryDelay);
      })
      .finally(() => {
        this.starting = false;
      });
  }
  async request(action: string, body?: object): Promise<any> {
    if (this.disposed) throw new Error('Подключение закрыто');
    if (!this.restored)
      this.restored = (async () => {
        try {
          const saved = await this.sessionStore?.get(this.address);
          if (saved && /^durak_session=[a-f0-9]{64}$/.test(saved)) this.cookie = saved;
        } catch {
          this.listeners.error('Не удалось восстановить вход. Можно войти снова.');
        }
      })();
    await this.restored;
    if (this.disposed) throw new Error('Подключение закрыто');
    const abort = new AbortController();
    this.requests.add(abort);
    const timer = setTimeout(() => abort.abort(), 12000);
    try {
      const response = await fetch(`${this.address}/api/auth/${action}`, {
        method: body ? 'POST' : 'GET',
        credentials: 'include',
        signal: abort.signal,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.cookie ? { Cookie: this.cookie } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
      if (this.disposed) throw new Error('Подключение закрыто');
      const cookie = response.headers.get('set-cookie')?.match(/durak_session=[^;]+/);
      if (cookie && /^durak_session=[a-f0-9]{64}$/.test(cookie[0])) {
        this.cookie = cookie[0];
        try {
          await this.sessionStore?.set(this.address, this.cookie);
        } catch {
          this.listeners.error('Вход работает, но не сохранён на телефоне.');
        }
      }
      if (!response.headers.get('content-type')?.includes('application/json'))
        throw new Error('По этому адресу нет игрового сервера. Проверьте адрес и обновите сервер.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ошибка сервера');
      return data;
    } catch (error) {
      if (abort.signal.aborted)
        throw new Error('Сервер не ответил. Проверьте подключение к интернету.');
      throw error;
    } finally {
      clearTimeout(timer);
      this.requests.delete(abort);
    }
  }
  async connect() {
    const data = await this.request('me');
    if (this.disposed) return;
    this.name = data.user?.name || data.name || this.name;
    this.listeners.profile(data.user, this.name);
    this.openSocket();
  }
  private openSocket() {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    const socket = io(this.address, {
      transports: ['websocket'],
      withCredentials: true,
      extraHeaders: this.cookie ? { cookie: this.cookie } : {},
      autoConnect: false,
      timeout: 10000
    });
    this.socket = socket;
    socket.on('connect', () => {
      this.listeners.connection(true);
      if (this.room) this.join(this.room);
      socket.emit('getRooms');
    });
    socket.on('disconnect', () => this.listeners.connection(false));
    socket.on('connect_error', () => {
      this.listeners.connection(false);
      (this.listeners.connectionIssue || this.listeners.error)(
        'Нет связи с сервером. Пробуем подключиться снова…'
      );
    });
    socket.on('roomList', this.listeners.rooms);
    socket.on('roomLobby', (data) => this.listeners.rooms(data.rooms || []));
    socket.on('roomCreated', ({ code }) => this.join(code));
    socket.on('joinedRoom', ({ code }) => {
      this.room = code;
    });
    socket.on('updateState', (state) => {
      this.room = state.roomCode;
      this.listeners.state(state);
    });
    socket.on('roomError', (message) => {
      this.listeners.error(message);
      if (!this.room) this.listeners.closed();
    });
    socket.on('roomClosed', (message) => {
      this.room = '';
      this.listeners.closed();
      this.listeners.error(message);
    });
    socket.on('profileUpdated', (data) => {
      this.name = data.name;
      this.listeners.profile(data.user, data.name);
    });
    socket.on('authExpired', () => {
      if (this.changingAccount) return;
      this.listeners.profile(null);
      this.room = '';
      this.listeners.closed();
      this.listeners.error('Вход завершился. Подключитесь к серверу заново.');
    });
    socket.connect();
  }
  join(code: string) {
    this.send('joinRoom', { roomCode: code.trim().toUpperCase(), name: this.name });
  }
  create(options: Options) {
    this.send('createRoom', options);
  }
  send(event: string, payload?: unknown) {
    if (event === 'leaveRoom') this.room = '';
    if (!this.socket?.connected) {
      this.listeners.error('Дождитесь подключения к серверу.');
      return;
    }
    this.socket.emit(event, payload);
  }
  private changingAccount = false;
  async account(action: 'login' | 'register' | 'logout', body: object) {
    if (this.room) throw new Error('Сначала выйдите из комнаты');
    this.changingAccount = true;
    try {
      const data = await this.request(action, body);
      this.name = data.user?.name || this.name;
      this.listeners.profile(data.user, this.name);
      this.openSocket();
    } finally {
      this.changingAccount = false;
    }
  }
  async rename(name: string) {
    const data = await this.request('name', { name });
    this.name = data.name;
    this.listeners.profile(data.user, data.name);
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.retryTimer);
    this.requests.forEach((r) => r.abort());
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
  }
}

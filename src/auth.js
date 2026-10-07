const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const hash = (value) => createHash('sha256').update(value).digest('hex');
function validOrigin(origin, host) {
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.host === host;
  } catch {
    return false;
  }
}
const lifetime = 30 * 24 * 60 * 60 * 1000;
const { installGoogleAuth } = require('./google-auth');
const { matchRecord } = require('./game/match-history');

function createAuth({
  databasePath = process.env.DATABASE_PATH || path.join(__dirname, '../data/durak.sqlite'),
  googleClientId = process.env.GOOGLE_CLIENT_ID || '',
  verifyGoogleToken,
  onSessionRevoked = () => {},
  passwordConcurrency = 4,
  derivePassword = derive
} = {}) {
  if (databasePath !== ':memory:') mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id), expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    PRAGMA user_version=1;`);
  if (
    !db
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .some((column) => column.name === 'guest_name')
  ) {
    db.exec('ALTER TABLE sessions ADD COLUMN guest_name TEXT');
  }
  db.exec('PRAGMA user_version=2');
  db.exec(`CREATE TABLE IF NOT EXISTS match_history (
    user_id TEXT NOT NULL REFERENCES users(id), match_id TEXT NOT NULL,
    played_at INTEGER NOT NULL, record TEXT NOT NULL,
    PRIMARY KEY (user_id, match_id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS history_date ON match_history(user_id, played_at)');
  function saveMatch(userId, record, source = 'online') {
    if (!record) return;
    db.prepare('INSERT OR IGNORE INTO match_history VALUES (?, ?, ?, ?)').run(
      userId,
      `${source}:${record.id}`,
      record.date,
      JSON.stringify(record)
    );
    db.prepare(
      `DELETE FROM match_history WHERE user_id=? AND match_id NOT IN
      (SELECT match_id FROM match_history WHERE user_id=? ORDER BY played_at DESC LIMIT 500)`
    ).run(userId, userId);
  }
  function recordState(playerId, state) {
    if (!playerId?.startsWith('account:')) return;
    saveMatch(playerId.slice(8), matchRecord(state));
  }
  function token(req) {
    return (
      req.headers.cookie
        ?.split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('durak_session='))
        ?.slice(14) || ''
    );
  }
  function lookup(req) {
    return db
      .prepare(
        `SELECT s.*, COALESCE(u.name, s.guest_name) AS name, u.login FROM sessions s LEFT JOIN users u ON u.id=s.user_id
      WHERE token_hash=? AND expires_at>?`
      )
      .get(hash(token(req)), Date.now());
  }
  function issue(req, res, user) {
    onSessionRevoked(hash(token(req)));
    const value = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at<=? OR token_hash=?').run(
      Date.now(),
      hash(token(req))
    );
    const playerId = user ? `account:${user.id}` : `guest:${randomUUID()}`;
    db.prepare(
      'INSERT INTO sessions (token_hash, player_id, user_id, expires_at) VALUES (?, ?, ?, ?)'
    ).run(hash(value), playerId, user?.id || null, Date.now() + lifetime);
    res.setHeader(
      'Set-Cookie',
      `durak_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetime / 1000}${req.secure || process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`
    );
  }
  const publicUser = (s) => (s?.user_id ? { id: s.user_id, login: s.login, name: s.name } : null);
  const attempts = new Map();
  let passwordJobs = 0;
  const requests = new Map();
  let requestWindow = Date.now();
  let requestCount = 0;
  function install(app, onNameChanged = () => {}) {
    app.use('/api/auth', (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      const now = Date.now();
      if (now - requestWindow >= 60000) {
        requestWindow = now;
        requestCount = 0;
        requests.clear();
      }
      const count = (requests.get(req.ip) || 0) + 1;
      // Bound both per-client traffic and the limiter's own memory.
      if (++requestCount > 10000 || count > 600) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: 'Слишком много запросов. Повторите позже.' });
      }
      requests.set(req.ip, count);
      if (req.method === 'POST') {
        const origin = req.get('origin');
        if (
          req.get('sec-fetch-site') === 'cross-site' ||
          (origin && !validOrigin(origin, req.get('host')))
        )
          return res.status(403).json({ error: 'Запрос с другого сайта запрещён.' });
        if (!req.is('application/json')) return res.status(415).json({ error: 'Ожидается JSON.' });
      }
      next();
    });
    app.get('/api/auth/me', (req, res) => {
      const s = lookup(req);
      if (!s) issue(req, res);
      res.json({ user: publicUser(s), name: s?.name || null });
    });
    app.get('/api/auth/history', (req, res) => {
      const identity = lookup(req);
      if (!identity?.user_id)
        return res.status(401).json({ error: 'ВОЙДИТЕ, чтобы смотреть статистику.' });
      const history = db
        .prepare(
          'SELECT record FROM match_history WHERE user_id=? ORDER BY played_at DESC LIMIT 500'
        )
        .all(identity.user_id)
        .map((row) => JSON.parse(row.record));
      res.json({ history });
    });
    app.post('/api/auth/history', (req, res) => {
      const identity = lookup(req);
      if (!identity?.user_id)
        return res.status(401).json({ error: 'ВОЙДИТЕ, чтобы сохранять статистику.' });
      const r = req.body?.record;
      if (
        !r ||
        req.body.userId !== identity.user_id ||
        typeof r.id !== 'string' ||
        !r.id.trim() ||
        r.id.length > 150 ||
        !Number.isSafeInteger(r.date) ||
        r.date <= 0 ||
        r.date > Date.now() + 60000 ||
        !['win', 'loss', 'draw'].includes(r.result) ||
        !['С ботами', 'Bluetooth'].includes(r.mode) ||
        typeof r.opponents !== 'string' ||
        r.opponents.length > 200 ||
        typeof r.rules !== 'string' ||
        r.rules.length > 100
      )
        return res.status(400).json({ error: 'Некорректный результат матча.' });
      saveMatch(
        identity.user_id,
        {
          id: r.id,
          date: r.date,
          result: r.result,
          mode: r.mode,
          opponents: r.opponents,
          rules: r.rules,
          surrendered: Boolean(r.surrendered)
        },
        'offline'
      );
      res.json({ ok: true });
    });
    app.post('/api/auth/name', (req, res) => {
      const identity = lookup(req);
      if (!identity)
        return res.status(401).json({ error: 'Сессия завершилась. Обновите страницу.' });
      const name = req.body?.name;
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        name.trim().length > 20 ||
        /[\x00-\x1f\x7f]/.test(name)
      )
        return res.status(400).json({ error: 'Введите ник от 1 до 20 символов.' });
      if (identity.user_id)
        db.prepare('UPDATE users SET name=? WHERE id=?').run(name.trim(), identity.user_id);
      else
        db.prepare('UPDATE sessions SET guest_name=? WHERE token_hash=?').run(
          name.trim(),
          identity.token_hash
        );
      const updated = lookup(req);
      onNameChanged(updated);
      res.json({ user: publicUser(updated), name: updated.name });
    });
    for (const action of ['register', 'login'])
      app.post(`/api/auth/${action}`, async (req, res, next) => {
        let acquired = false;
        try {
          const now = Date.now();
          for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
          const key = req.ip;
          if (
            (!attempts.has(key) && attempts.size >= 10000) ||
            passwordJobs >= passwordConcurrency
          ) {
            res.setHeader('Retry-After', '5');
            return res
              .status(429)
              .json({ error: 'Сервер занят. Попробуйте через несколько секунд.' });
          }
          const attempt = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
          attempts.set(key, attempt);
          if (++attempt.count > 20)
            return res
              .status(429)
              .json({ error: 'Слишком много попыток. Попробуйте через 15 минут.' });
          const { password, name } = req.body || {};
          // Keep the existing column and old login API compatible with saved accounts.
          const login = req.body?.email ?? req.body?.login;
          const normalized = typeof login === 'string' ? login.trim().toLowerCase() : '';
          const isEmail =
            normalized.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(normalized);
          const isLegacyLogin = action === 'login' && /^[a-zA-Z0-9_]{3,32}$/.test(normalized);
          if (
            (!isEmail && !isLegacyLogin) ||
            typeof password !== 'string' ||
            password.length < 8 ||
            password.length > 128
          )
            return res
              .status(400)
              .json({ error: 'Введите корректную почту и пароль от 8 до 128 символов.' });
          passwordJobs++;
          acquired = true;
          let user = db.prepare('SELECT * FROM users WHERE login=?').get(normalized);
          if (action === 'register') {
            if (
              typeof name !== 'string' ||
              !name.trim() ||
              name.trim().length > 20 ||
              /[\x00-\x1f\x7f]/.test(name)
            )
              return res.status(400).json({ error: 'Введите ник от 1 до 20 символов.' });
            if (user) return res.status(409).json({ error: 'Эта почта уже зарегистрирована.' });
            const salt = randomBytes(16).toString('hex');
            const passwordHash = (await derivePassword(password, salt, 64)).toString('hex');
            user = { id: randomUUID(), login: normalized, name: name.trim() };
            try {
              db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(
                user.id,
                user.login,
                user.name,
                salt,
                passwordHash,
                now
              );
            } catch (error) {
              if (db.prepare('SELECT id FROM users WHERE login=?').get(normalized))
                return res.status(409).json({ error: 'Эта почта уже зарегистрирована.' });
              throw error;
            }
          } else {
            const candidate = await derivePassword(password, user?.salt || 'missing-user-salt', 64);
            if (!user || !timingSafeEqual(candidate, Buffer.from(user.password_hash, 'hex')))
              return res.status(401).json({ error: 'Неверная почта или пароль.' });
          }
          issue(req, res, user);
          res
            .status(action === 'register' ? 201 : 200)
            .json({ user: { id: user.id, login: user.login, name: user.name } });
        } catch (error) {
          next(error);
        } finally {
          if (acquired) passwordJobs--;
        }
      });
    app.post('/api/auth/logout', (req, res) => {
      issue(req, res);
      res.json({ user: null });
    });
    require('./friends').installFriends(app, { db, lookup });
    installGoogleAuth(app, {
      db,
      lookup,
      issue,
      clientId: googleClientId,
      verifyToken: verifyGoogleToken
    });
    app.use('/api/auth', (req, res) => {
      res.status(404).json({ error: 'Этот способ входа недоступен. Обновите страницу.' });
    });
    app.use('/api/auth', (error, req, res, next) => {
      res.status(error.status === 413 ? 413 : error.status === 400 ? 400 : 500).json({
        error:
          error.status === 413
            ? 'Запрос слишком большой.'
            : error.status === 400
              ? 'Некорректный запрос.'
              : 'Не удалось выполнить запрос. Попробуйте снова.'
      });
    });
  }
  return { install, lookup, recordState, close: () => db.close() };
}
module.exports = { createAuth };

const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const lifetime = 30 * 24 * 60 * 60 * 1000;
const { installGoogleAuth } = require('./google-auth');

function createAuth({
  databasePath = process.env.DATABASE_PATH || path.join(__dirname, '../data/durak.sqlite'),
  googleClientId = process.env.GOOGLE_CLIENT_ID || '',
  verifyGoogleToken
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
  function install(app, onNameChanged = () => {}) {
    app.use('/api/auth', (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'POST') {
        const origin = req.get('origin');
        if (
          req.get('sec-fetch-site') === 'cross-site' ||
          (origin && new URL(origin).host !== req.get('host'))
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
        try {
          const now = Date.now();
          for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
          const key = req.ip;
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
            const passwordHash = (await derive(password, salt, 64)).toString('hex');
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
            const candidate = await derive(password, user?.salt || 'missing-user-salt', 64);
            if (!user || !timingSafeEqual(candidate, Buffer.from(user.password_hash, 'hex')))
              return res.status(401).json({ error: 'Неверная почта или пароль.' });
          }
          issue(req, res, user);
          res
            .status(action === 'register' ? 201 : 200)
            .json({ user: { id: user.id, login: user.login, name: user.name } });
        } catch (error) {
          next(error);
        }
      });
    app.post('/api/auth/logout', (req, res) => {
      issue(req, res);
      res.json({ user: null });
    });
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
      res.status(error.status === 400 ? 400 : 500).json({
        error:
          error.status === 400
            ? 'Некорректный запрос.'
            : 'Не удалось выполнить запрос. Попробуйте снова.'
      });
    });
  }
  return { install, lookup, close: () => db.close() };
}
module.exports = { createAuth };

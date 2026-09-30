const { OAuth2Client } = require('google-auth-library');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const digest = (value) => createHash('sha256').update(value).digest('hex');

function installGoogleAuth(app, { db, lookup, issue, clientId, verifyToken }) {
  const client = new OAuth2Client();
  const verify =
    verifyToken ||
    (async (credential) =>
      (await client.verifyIdToken({ idToken: credential, audience: clientId })).getPayload());
  db.exec(`CREATE TABLE IF NOT EXISTS google_accounts (
    subject TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS google_challenges (
    nonce_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL, expires_at INTEGER NOT NULL
  );`);
  app.get('/api/auth/google/config', (req, res) => {
    if (!clientId) return res.json({ enabled: false });
    const session = lookup(req);
    if (!session) return res.status(401).json({ error: 'Обновите страницу и попробуйте снова.' });
    db.prepare('DELETE FROM google_challenges WHERE expires_at<=? OR session_hash=?').run(
      Date.now(),
      session.token_hash
    );
    const nonce = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO google_challenges VALUES (?, ?, ?)').run(
      digest(nonce),
      session.token_hash,
      Date.now() + 10 * 60 * 1000
    );
    res.json({ enabled: true, clientId, nonce });
  });
  app.post('/api/auth/google', async (req, res, next) => {
    if (!clientId) return res.status(503).json({ error: 'Вход через Google пока не настроен.' });
    const session = lookup(req);
    const credential = req.body?.credential;
    if (!session || typeof credential !== 'string' || credential.length > 12000)
      return res.status(401).json({ error: 'Не удалось подтвердить вход через Google.' });
    // Consume the browser-bound challenge before doing any remote verification.
    const challenge = db
      .prepare(
        'DELETE FROM google_challenges WHERE session_hash=? AND expires_at>? RETURNING nonce_hash'
      )
      .get(session.token_hash, Date.now());
    if (!challenge)
      return res.status(401).json({ error: 'Вход устарел. Откройте окно входа заново.' });
    let profile;
    try {
      profile = await verify(credential);
      if (
        !profile ||
        typeof profile.sub !== 'string' ||
        !profile.sub ||
        profile.email_verified !== true ||
        typeof profile.nonce !== 'string' ||
        digest(profile.nonce) !== challenge.nonce_hash
      )
        throw new Error('Invalid identity');
    } catch {
      return res
        .status(401)
        .json({ error: 'Не удалось подтвердить вход через Google. Попробуйте снова.' });
    }
    try {
      // The session may have been revoked while Google verification was pending.
      if (!lookup(req))
        return res.status(401).json({ error: 'Сессия завершилась. Обновите страницу.' });
      let user = db
        .prepare(
          'SELECT u.* FROM users u JOIN google_accounts g ON g.user_id=u.id WHERE g.subject=?'
        )
        .get(profile.sub);
      if (!user) {
        const id = randomUUID();
        const name =
          (typeof profile.name === 'string'
            ? profile.name
                .replace(/[\x00-\x1f\x7f]/g, '')
                .trim()
                .slice(0, 20)
            : '') || 'Игрок';
        user = { id, login: `google:${id}`, name };
        db.exec('BEGIN');
        try {
          db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(
            id,
            user.login,
            name,
            randomBytes(16).toString('hex'),
            randomBytes(64).toString('hex'),
            Date.now()
          );
          db.prepare('INSERT INTO google_accounts VALUES (?, ?)').run(profile.sub, id);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }
      issue(req, res, user);
      res.json({ user: { id: user.id, login: user.login, name: user.name } });
    } catch (error) {
      next(error);
    }
  });
}
module.exports = { installGoogleAuth };

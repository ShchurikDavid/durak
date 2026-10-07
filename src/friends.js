// Public IDs are shared deliberately; email addresses are never exposed in friend lists.
function installFriends(app, { db, lookup }) {
  db.exec(`CREATE TABLE IF NOT EXISTS friendships (
    sender TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('pending','accepted')),
    created_at INTEGER NOT NULL, PRIMARY KEY(sender, recipient), CHECK(sender <> recipient)
  ); CREATE INDEX IF NOT EXISTS friendships_recipient ON friendships(recipient);`);
  const identity = (req, res) => {
    const user = lookup(req);
    if (!user?.user_id) {
      res.status(401).json({ error: 'Войдите в аккаунт, чтобы добавлять друзей.' });
      return null;
    }
    return user.user_id;
  };
  app.get('/api/auth/friends', (req, res) => {
    const id = identity(req, res);
    if (!id) return;
    const rows = db
      .prepare(
        `SELECT u.id, u.name, f.status, f.sender
      FROM friendships f JOIN users u ON u.id=CASE WHEN f.sender=? THEN f.recipient ELSE f.sender END
      WHERE f.sender=? OR f.recipient=? ORDER BY f.created_at DESC`
      )
      .all(id, id, id);
    res.json({
      code: id,
      friends: rows.map(({ sender, ...row }) => ({ ...row, incoming: sender !== id }))
    });
  });
  app.post('/api/auth/friends', (req, res) => {
    const id = identity(req, res);
    if (!id) return;
    const { action, code } = req.body || {};
    if (
      typeof code !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(code) ||
      !['request', 'accept', 'remove'].includes(action)
    )
      return res.status(400).json({ error: 'Проверьте код друга.' });
    if (code === id) return res.status(400).json({ error: 'Это ваш собственный код.' });
    if (action === 'request') {
      if (!db.prepare('SELECT id FROM users WHERE id=?').get(code))
        return res.status(404).json({ error: 'Игрок с таким кодом не найден.' });
      const existing = db
        .prepare(
          'SELECT status FROM friendships WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)'
        )
        .get(id, code, code, id);
      if (existing) return res.status(409).json({ error: 'Заявка или дружба уже существует.' });
      for (const owner of [id, code]) {
        if (
          db
            .prepare('SELECT count(*) AS n FROM friendships WHERE sender=? OR recipient=?')
            .get(owner, owner).n >= 100
        )
          return res.status(409).json({ error: 'Достигнут лимит друзей и заявок (100).' });
      }
      db.prepare("INSERT INTO friendships VALUES (?, ?, 'pending', ?)").run(id, code, Date.now());
    } else if (action === 'accept') {
      const result = db
        .prepare(
          "UPDATE friendships SET status='accepted' WHERE sender=? AND recipient=? AND status='pending'"
        )
        .run(code, id);
      if (!result.changes) return res.status(404).json({ error: 'Входящая заявка не найдена.' });
    } else {
      db.prepare(
        'DELETE FROM friendships WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)'
      ).run(id, code, code, id);
    }
    res.json({ ok: true });
  });
}
module.exports = { installFriends };

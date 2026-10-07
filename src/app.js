const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');
const { createRoomService } = require('./rooms/service');
const { registerSocketHandlers } = require('./socket/handlers');
const { createAuth } = require('./auth');
const { randomUUID } = require('node:crypto');

function createApplication(options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com; img-src 'self' data:; connect-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    );
    // Never serve server code, credentials, databases or build artifacts.
    if (
      /(?:^|\/)(?:\.[^/]+|data|src|deploy|artifacts|node_modules)(?:\/|$)|\.(?:sqlite(?:-wal|-shm)?|db|pem|key|env|map)$/i.test(
        req.path
      )
    )
      return res.sendStatus(404);
    next();
  });
  // Only the local reverse proxy is trusted; Nginx overwrites forwarded headers.
  if (options.trustProxy ?? process.env.TRUST_PROXY === 'loopback')
    app.set('trust proxy', 'loopback');
  const server = http.createServer(app);
  const io = new Server(server, {
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 16 * 1024,
    allowRequest: (req, done) => {
      try {
        const origin = req.headers.origin ? new URL(req.headers.origin) : null;
        done(
          null,
          !origin ||
            (['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host)
        );
      } catch {
        done(null, false);
      }
    }
  });
  const auth = createAuth({
    ...options,
    onSessionRevoked(tokenHash) {
      for (const socket of io.sockets.sockets.values()) {
        if (socket.data.sessionHash !== tokenHash) continue;
        socket.emit('authExpired');
        socket.disconnect(true);
      }
    }
  });
  app.get('/api/health', (_req, res) => res.json({ app: 'durak', status: 'ok' }));
  app.use(express.json({ limit: '16kb' }));
  auth.install(app, (identity) => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.identity?.player_id !== identity.player_id) continue;
      socket.data.identity = identity;
      socket.emit('profileUpdated', {
        user: identity.user_id
          ? { id: identity.user_id, login: identity.login, name: identity.name }
          : null,
        name: identity.name
      });
    }
    service.renamePlayer(identity.player_id, identity.name);
  });
  io.use((socket, next) => {
    const identity = auth.lookup(socket.request);
    socket.data.sessionHash = identity?.token_hash;
    if (identity) {
      const expiry = setInterval(() => {
        if (auth.lookup(socket.request)) return;
        socket.emit('authExpired');
        socket.disconnect(true);
      }, 1000);
      expiry.unref();
      socket.once('disconnect', () => clearInterval(expiry));
    }
    let windowStart = Date.now();
    let packetCount = 0;
    socket.data.identity = identity || { player_id: `guest:${randomUUID()}` };
    socket.use((packet, proceed) => {
      if (Date.now() - windowStart >= 1000) {
        windowStart = Date.now();
        packetCount = 0;
      }
      if (++packetCount > 30) {
        socket.disconnect(true);
        return;
      }
      const currentIdentity = auth.lookup(socket.request);
      if (identity && !currentIdentity) {
        socket.emit('authExpired');
        socket.disconnect(true);
        return;
      }
      if (currentIdentity) socket.data.identity = currentIdentity;
      proceed();
    });
    next();
  });
  app.get('/vendor/motion.js', (_req, res) => {
    res.sendFile(
      path.resolve(path.dirname(require.resolve('motion/package.json')), 'dist/motion.js')
    );
  });
  app.use(express.static(path.join(__dirname, '../public')));
  app.use((error, req, res, next) => {
    const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
    res
      .status(status)
      .json({ error: status === 413 ? 'Запрос слишком большой.' : 'Некорректный запрос.' });
  });
  const service = createRoomService(io, { ...options, onPlayerState: auth.recordState });
  registerSocketHandlers(io, service);
  return {
    app,
    server,
    io,
    service,
    close: () =>
      new Promise((resolve) => {
        io.disconnectSockets(true);
        service.dispose();
        io.close(() => {
          auth.close();
          resolve();
        });
      })
  };
}
module.exports = { createApplication };

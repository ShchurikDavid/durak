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
  const server = http.createServer(app);
  const io = new Server(server, {
    transports: ['websocket', 'polling'],
    allowRequest: (req, done) => {
      try {
        done(null, !req.headers.origin || new URL(req.headers.origin).host === req.headers.host);
      } catch {
        done(null, false);
      }
    }
  });
  const auth = createAuth(options);
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
    socket.data.identity = identity || { player_id: `guest:${randomUUID()}` };
    socket.use((packet, proceed) => {
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
  app.use(express.static(path.join(__dirname, '../public')));
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

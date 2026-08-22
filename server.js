const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e6, // allow avatar/image payloads sent as data URLs
});

app.use(express.static(path.join(__dirname, 'public')));

// roomId -> Map(socketId -> { name, avatar, status })
const rooms = new Map();
// roomId -> array of past chat messages (capped)
const roomHistory = new Map();
const MAX_HISTORY = 200;

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, name, avatar }) => {
    if (!roomId) return;
    roomId = String(roomId).trim().toLowerCase();
    name = (name || 'Anônimo').toString().slice(0, 24);
    avatar = typeof avatar === 'string' && avatar.startsWith('data:image') ? avatar.slice(0, 300000) : null;

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    // Tell the newcomer who is already here
    const existing = Array.from(room.entries()).map(([id, data]) => ({
      id, name: data.name, avatar: data.avatar, status: data.status,
    }));
    socket.emit('existing-users', existing);
    socket.emit('chat-history', roomHistory.get(roomId) || []);

    room.set(socket.id, { name, avatar, status: 'online' });

    // Tell everyone else about the newcomer
    socket.to(roomId).emit('user-joined', { id: socket.id, name, avatar, status: 'online' });
  });

  socket.on('status-change', ({ status }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const entry = rooms.get(roomId).get(socket.id);
    if (!entry) return;
    entry.status = status === 'away' ? 'away' : 'online';
    socket.to(roomId).emit('status-change', { id: socket.id, status: entry.status });
  });

  // Generic WebRTC signal relay (offers, answers, ICE candidates)
  socket.on('signal', ({ to, data }) => {
    if (!to) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // Lets a receiver know an incoming video track is a screen-share, not a camera
  socket.on('screen-share-info', ({ active }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('screen-share-info', { from: socket.id, active });
  });

  socket.on('chat-message', ({ message, type }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !message) return;
    const kind = type === 'image' ? 'image' : 'text';
    const text = kind === 'image'
      ? (message.startsWith('data:image') ? message.slice(0, 400000) : null)
      : String(message).slice(0, 1000);
    if (!text) return;

    const payload = {
      id: socket.id,
      name: socket.data.name || 'Anônimo',
      message: text,
      type: kind,
      at: Date.now(),
    };

    if (!roomHistory.has(roomId)) roomHistory.set(roomId, []);
    const history = roomHistory.get(roomId);
    history.push(payload);
    if (history.length > MAX_HISTORY) history.shift();

    io.to(roomId).emit('chat-message', payload);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.delete(socket.id);
      socket.to(roomId).emit('user-left', { id: socket.id });
      if (room.size === 0) rooms.delete(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor no ar na porta ${PORT}`));

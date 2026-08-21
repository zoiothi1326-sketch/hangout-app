const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// roomId -> Map(socketId -> { name })
const rooms = new Map();

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, name }) => {
    if (!roomId) return;
    roomId = String(roomId).trim().toLowerCase();
    name = (name || 'Anônimo').toString().slice(0, 24);

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    // Tell the newcomer who is already here
    const existing = Array.from(room.entries()).map(([id, data]) => ({ id, name: data.name }));
    socket.emit('existing-users', existing);

    room.set(socket.id, { name });

    // Tell everyone else about the newcomer
    socket.to(roomId).emit('user-joined', { id: socket.id, name });
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

  socket.on('chat-message', ({ message }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !message) return;
    const text = String(message).slice(0, 1000);
    io.to(roomId).emit('chat-message', {
      id: socket.id,
      name: socket.data.name || 'Anônimo',
      message: text,
      at: Date.now(),
    });
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

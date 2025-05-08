// ===== server.js =====
// Node.js multiplayer server for the voxel shooter
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from /public
app.use(express.static('public'));

// Store connected players (pos) – simple for now
const players = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Spawn player at origin
  players[socket.id] = { x: 0, y: 0, z: 0 };

  // Send existing players to the new client
  socket.emit('init', players);

  // Notify others of the new player
  socket.broadcast.emit('playerJoined', {
    id: socket.id,
    ...players[socket.id]
  });

  // Handle position updates
  socket.on('move', (pos) => {
    players[socket.id] = pos;
    socket.broadcast.emit('playerMoved', { id: socket.id, ...pos });
  });

  // NEW: handle block removal from clients
  socket.on('removeBlock', (coord) => {
    // Simply broadcast to everyone else
    socket.broadcast.emit('blockRemoved', coord);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});

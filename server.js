const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const players = {};

io.on('connection', socket => {
  console.log(`User connected: ${socket.id}`);

  // Initialize new player
  players[socket.id] = { x: 0, y: 0, z: 0 };

  // Send all current players to new client
  socket.emit('init', players);

  // Notify all others of new player
  socket.broadcast.emit('playerJoined', { id: socket.id, ...players[socket.id] });

  // Handle movement
  socket.on('move', pos => {
    players[socket.id] = pos;
    socket.broadcast.emit('playerMoved', { id: socket.id, ...pos });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));

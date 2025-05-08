// server.js – multiplayer server with block‑removal forwarding
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static('public'));

const players = {};         // { socketId: { x, y, z } }

io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);

  // spawn new player at origin
  players[socket.id] = { x: 0, y: 0, z: 0 };

  // send current roster to the newcomer
  socket.emit('init', players);

  // announce newcomer to everyone else
  socket.broadcast.emit('playerJoined', { id: socket.id, ...players[socket.id] });

  // position updates
  socket.on('move', pos => {
    players[socket.id] = pos;
    socket.broadcast.emit('playerMoved', { id: socket.id, ...pos });
  });

  // block‑destruction broadcast
  socket.on('removeBlock', coord => {
    socket.broadcast.emit('blockRemoved', coord);
  });

  // handle disconnect
  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Server running at http://localhost:${PORT}`)
);

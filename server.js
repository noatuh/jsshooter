// server.js – multiplayer server with block‑removal forwarding
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static('public'));

const players = {};         // { socketId: { x, y, z } }

/* ---------------- PERLIN‑NOISE UTILITY (Copied from client.js) ---------------- */
function ImprovedNoise() {
  const p = new Uint8Array(512);
  const perm = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
  for (let i = 0; i < 256; i++) p[i] = p[i + 256] = perm[i];
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(t, a, b) { return a + t * (b - a); }
  function grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  this.noise = (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lerp(w,
      lerp(v,
        lerp(u, grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z)),
        lerp(u, grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z))
      ),
      lerp(v,
        lerp(u, grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1)),
        lerp(u, grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1))
      )
    );
  };
}
const perlinServer = new ImprovedNoise();

function heightAtServer(wx, wz) {
  const scale = 0.06, amp = 8; // Consistent with client's heightAt
  return Math.floor((perlinServer.noise(wx * scale, 0, wz * scale) + 1) * amp * 0.5);
}

/* ---------------- PRELOADED MAP ---------------- */
const MAP_CHUNK_WIDTH = 8;    // 8 chunks wide
const MAP_CHUNK_DEPTH = 8;    // 8 chunks deep
const CHUNK_SIZE = 16;        // 16 blocks per chunk side
const preloadedMapData = [];

function generatePreloadedMap() {
  console.log('Generating preloaded map...');
  for (let cx = 0; cx < MAP_CHUNK_WIDTH; cx++) {
    for (let cz = 0; cz < MAP_CHUNK_DEPTH; cz++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          const wx = cx * CHUNK_SIZE + x;
          const wz = cz * CHUNK_SIZE + z;
          const h = heightAtServer(wx, wz);
          for (let y = 0; y <= h; y++) {
            preloadedMapData.push({ x: wx, y, z: wz });
          }
        }
      }
    }
  }
  console.log(`Preloaded map with ${preloadedMapData.length} blocks.`);
}
generatePreloadedMap(); // Generate map on server start

io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);

  // spawn new player at origin
  players[socket.id] = { x: 0, y: heightAtServer(0,0) + 1, z: 0 }; // Use server height for initial spawn

  // send current roster and preloaded map to the newcomer
  socket.emit('init', { players, mapData: preloadedMapData });

  // announce newcomer to everyone else
  socket.broadcast.emit('playerJoined', { id: socket.id, ...players[socket.id] });

  // position updates
  socket.on('move', pos => {
    players[socket.id] = pos;
    socket.broadcast.emit('playerMoved', { id: socket.id, ...pos });
  });

  // block‑destruction broadcast
  socket.on('removeBlock', coord => {
    // Remove block from server's map data
    const index = preloadedMapData.findIndex(block => block.x === coord.x && block.y === coord.y && block.z === coord.z);
    if (index !== -1) {
      preloadedMapData.splice(index, 1);
      console.log(`Block removed at ${coord.x},${coord.y},${coord.z}. Remaining blocks: ${preloadedMapData.length}`);
    }
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

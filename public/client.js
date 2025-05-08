// ===== public/client.js =====
const socket = io();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas') });
renderer.setSize(window.innerWidth, window.innerHeight);

// Lighting
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 5).normalize();
scene.add(light);

// ----- Chunk & Voxel System -----
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 2; // in chunks
const blockSize = 1;

const blockGeometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);
const blockMaterial = new THREE.MeshLambertMaterial({ color: 0x777755 });

const chunks = new Map(); // key -> { group, blocks }
const voxelMeshes = [];
const voxelData = []; // {x,y,z,mesh}

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

// Simple height function for terrain
function getHeight(wx, wz) {
  return Math.floor(Math.sin(wx * 0.2) + Math.cos(wz * 0.2)) + 2; // Heights 0‑3
}

function loadChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  if (chunks.has(key)) return;

  const group = new THREE.Group();
  const blocks = [];

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const height = getHeight(wx, wz);

      for (let y = 0; y < height; y++) {
        const block = new THREE.Mesh(blockGeometry, blockMaterial);
        block.position.set(wx, y, wz);
        block.userData = { isBlock: true, coord: { x: wx, y, z: wz } };
        group.add(block);

        blocks.push(block);
        voxelMeshes.push(block);
        voxelData.push({ x: wx, y, z: wz, mesh: block });
      }
    }
  }

  scene.add(group);
  chunks.set(key, { group, blocks });
}

function unloadChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  const chunk = chunks.get(key);
  if (!chunk) return;

  for (const block of chunk.blocks) {
    const vmIdx = voxelMeshes.indexOf(block);
    if (vmIdx !== -1) voxelMeshes.splice(vmIdx, 1);

    const vdIdx = voxelData.findIndex(b => b.mesh === block);
    if (vdIdx !== -1) voxelData.splice(vdIdx, 1);
  }

  scene.remove(chunk.group);
  chunks.delete(key);
}

function ensureChunksAround(x, z) {
  const currentCx = Math.floor(x / CHUNK_SIZE);
  const currentCz = Math.floor(z / CHUNK_SIZE);

  // Load nearby chunks
  for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
      loadChunk(currentCx + dx, currentCz + dz);
    }
  }

  // Unload distant chunks
  for (const key of chunks.keys()) {
    const [cxStr, czStr] = key.split(',');
    const cx = parseInt(cxStr);
    const cz = parseInt(czStr);
    const dist = Math.max(Math.abs(cx - currentCx), Math.abs(cz - currentCz));
    if (dist > RENDER_DISTANCE) unloadChunk(cx, cz);
  }
}

// Initial load
ensureChunksAround(0, 0);

// ----- Players -----
const players = {};
const playerGeometry = new THREE.BoxGeometry(1, 1, 1);

const localPlayer = {
  mesh: new THREE.Mesh(playerGeometry, new THREE.MeshLambertMaterial({ color: 0x00ff00 })),
  pos: { x: 0, y: 0, z: 0 }
};
scene.add(localPlayer.mesh);

// ----- Camera Control -----
let yaw = 0;
let pitch = 0;
const sensitivity = 0.002;

function updateCameraRotation() {
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

const overlay = document.getElementById('overlay');
function lockPointer() {
  const canvas = document.getElementById('gameCanvas');
  canvas.requestPointerLock = canvas.requestPointerLock || canvas.mozRequestPointerLock;
  canvas.requestPointerLock();
}

overlay.addEventListener('click', lockPointer);

document.addEventListener('pointerlockchange', () => {
  overlay.style.display = (document.pointerLockElement === renderer.domElement) ? 'none' : 'flex';
});

document.addEventListener('mousemove', event => {
  if (document.pointerLockElement === renderer.domElement) {
    yaw -= event.movementX * sensitivity;
    pitch -= event.movementY * sensitivity;
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    updateCameraRotation();
  }
});

// ----- Movement -----
const keys = {};
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

function updateMovement() {
  const speed = 0.15;
  const dir = new THREE.Vector3();

  if (keys['w']) dir.z -= 1;
  if (keys['s']) dir.z += 1;
  if (keys['a']) dir.x -= 1;
  if (keys['d']) dir.x += 1;

  if (dir.lengthSq() > 0) {
    dir.normalize().applyEuler(camera.rotation);
    localPlayer.pos.x += dir.x * speed;
    localPlayer.pos.z += dir.z * speed;
    localPlayer.pos.y = getHeight(localPlayer.pos.x, localPlayer.pos.z); // stand on ground height
  }

  ensureChunksAround(localPlayer.pos.x, localPlayer.pos.z);

  localPlayer.mesh.position.set(localPlayer.pos.x, localPlayer.pos.y, localPlayer.pos.z);
  camera.position.set(localPlayer.pos.x, localPlayer.pos.y + 1.6, localPlayer.pos.z);

  socket.emit('move', localPlayer.pos);
}

// ----- Raycasting for Block Destruction -----
const raycaster = new THREE.Raycaster();

function deleteBlock(mesh, broadcast = true) {
  if (!mesh || !mesh.userData.isBlock) return;
  const { x, y, z } = mesh.userData.coord;

  const key = chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
  const chunk = chunks.get(key);
  if (chunk) {
    chunk.group.remove(mesh);
    chunk.blocks.splice(chunk.blocks.indexOf(mesh), 1);
  }

  const vmIdx = voxelMeshes.indexOf(mesh);
  if (vmIdx !== -1) voxelMeshes.splice(vmIdx, 1);

  const vdIdx = voxelData.findIndex(b => b.mesh === mesh);
  if (vdIdx !== -1) voxelData.splice(vdIdx, 1);

  if (broadcast) socket.emit('removeBlock', { x, y, z });
}

function attemptRemoveBlock() {
  if (document.pointerLockElement !== renderer.domElement) return;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hit = raycaster.intersectObjects(voxelMeshes, false)[0];
  if (hit) deleteBlock(hit.object, true);
}

document.addEventListener('mousedown', e => {
  if (e.button === 0) attemptRemoveBlock();
});

// ----- Animation Loop -----
function animate() {
  requestAnimationFrame(animate);
  updateMovement();
  renderer.render(scene, camera);
}
animate();

// ----- Socket.io Events -----
socket.on('init', playerData => {
  for (const id in playerData) {
    if (id === socket.id) continue;
    addRemotePlayer(id, playerData[id]);
  }
});

socket.on('playerJoined', data => addRemotePlayer(data.id, data));

socket.on('playerMoved', data => {
  if (players[data.id]) players[data.id].mesh.position.set(data.x, data.y, data.z);
});

socket.on('playerLeft', id => {
  if (players[id]) {
    scene.remove(players[id].mesh);
    delete players[id];
  }
});

socket.on('blockRemoved', coord => {
  const blockObj = voxelData.find(b => b.x === coord.x && b.y === coord.y && b.z === coord.z);
  if (blockObj) deleteBlock(blockObj.mesh, false);
});

function addRemotePlayer(id, pos) {
  const mesh = new THREE.Mesh(playerGeometry, new THREE.MeshLambertMaterial({ color: 0x0000ff }));
  mesh.position.set(pos.x, pos.y, pos.z);
  scene.add(mesh);
  players[id] = { mesh };
}

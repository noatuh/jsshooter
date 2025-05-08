// ===== public/client.js =====
const socket = io();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas') });
renderer.setSize(window.innerWidth, window.innerHeight);

// ----- Lighting -----
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 5).normalize();
scene.add(light);

// ----- Voxel World -----
const worldWidth = 16;
const worldDepth = 16;
const blockSize = 1;

const blockGeometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);
const blockMaterial = new THREE.MeshLambertMaterial({ color: 0x777755 });

// Keep track of blocks
const voxelData = []; // { x, y, z, mesh }
const voxelMeshes = []; // array of meshes for raycasting convenience

for (let x = 0; x < worldWidth; x++) {
  for (let z = 0; z < worldDepth; z++) {
    const block = new THREE.Mesh(blockGeometry, blockMaterial);
    block.position.set(x, 0, z);
    block.userData = { isBlock: true, coord: { x, y: 0, z } };
    scene.add(block);
    voxelData.push({ x, y: 0, z, mesh: block });
    voxelMeshes.push(block);
  }
}

// ----- Players -----
const players = {};
const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);

const localPlayer = {
  mesh: new THREE.Mesh(cubeGeometry, new THREE.MeshLambertMaterial({ color: 0x00ff00 })),
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
  if (document.pointerLockElement === renderer.domElement) {
    overlay.style.display = 'none';
  } else {
    overlay.style.display = 'flex';
  }
});

document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement === renderer.domElement) {
    yaw -= event.movementX * sensitivity;
    pitch -= event.movementY * sensitivity;
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    updateCameraRotation();
  }
});

// ----- Movement -----
const keys = {};
window.addEventListener('keydown', (e) => (keys[e.key.toLowerCase()] = true));
window.addEventListener('keyup', (e) => (keys[e.key.toLowerCase()] = false));

function updateMovement() {
  const speed = 0.1;
  const dir = new THREE.Vector3();

  if (keys['w']) dir.z -= 1;
  if (keys['s']) dir.z += 1;
  if (keys['a']) dir.x -= 1;
  if (keys['d']) dir.x += 1;

  dir.normalize().applyEuler(camera.rotation);
  localPlayer.pos.x += dir.x * speed;
  localPlayer.pos.z += dir.z * speed;
  localPlayer.pos.y = 0; // keep grounded

  localPlayer.mesh.position.set(localPlayer.pos.x, localPlayer.pos.y, localPlayer.pos.z);
  camera.position.set(localPlayer.pos.x, localPlayer.pos.y + 1.6, localPlayer.pos.z);

  socket.emit('move', localPlayer.pos);
}

// ----- Raycasting for block destruction -----
const raycaster = new THREE.Raycaster();

function removeBlock(mesh) {
  if (!mesh || !mesh.userData.isBlock) return;
  const { x, y, z } = mesh.userData.coord;

  // Remove from scene
  scene.remove(mesh);

  // Remove from tracking arrays
  const idx = voxelMeshes.indexOf(mesh);
  if (idx !== -1) voxelMeshes.splice(idx, 1);
  const dataIdx = voxelData.findIndex((b) => b.x === x && b.y === y && b.z === z);
  if (dataIdx !== -1) voxelData.splice(dataIdx, 1);

  // Notify server
  socket.emit('removeBlock', { x, y, z });
}

function attemptRemoveBlock() {
  if (document.pointerLockElement !== renderer.domElement) return;

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera); // center of screen
  const intersects = raycaster.intersectObjects(voxelMeshes);
  if (intersects.length > 0) {
    removeBlock(intersects[0].object);
  }
}

document.addEventListener('mousedown', (e) => {
  if (e.button === 0) attemptRemoveBlock(); // left click
});

// ----- Animation Loop -----
function animate() {
  requestAnimationFrame(animate);
  updateMovement();
  renderer.render(scene, camera);
}
animate();

// ----- Socket.io Events -----
socket.on('init', (playerData) => {
  for (const id in playerData) {
    if (id === socket.id) continue;
    addRemotePlayer(id, playerData[id]);
  }
});

socket.on('playerJoined', (data) => addRemotePlayer(data.id, data));

socket.on('playerMoved', (data) => {
  if (players[data.id]) {
    players[data.id].mesh.position.set(data.x, data.y, data.z);
  }
});

socket.on('playerLeft', (id) => {
  if (players[id]) {
    scene.remove(players[id].mesh);
    delete players[id];
  }
});

// Receive block removal from other clients
socket.on('blockRemoved', ({ x, y, z }) => {
  const blockObj = voxelData.find((b) => b.x === x && b.y === y && b.z === z);
  if (blockObj) {
    scene.remove(blockObj.mesh);
    voxelMeshes.splice(voxelMeshes.indexOf(blockObj.mesh), 1);
    voxelData.splice(voxelData.indexOf(blockObj), 1);
  }
});

function addRemotePlayer(id, pos) {
  const mesh = new THREE.Mesh(cubeGeometry, new THREE.MeshLambertMaterial({ color: 0x0000ff }));
  mesh.position.set(pos.x, pos.y, pos.z);
  scene.add(mesh);
  players[id] = { mesh };
}

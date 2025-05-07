const socket = io();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas') });
renderer.setSize(window.innerWidth, window.innerHeight);

// Lighting
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 5).normalize();
scene.add(light);

// Ground plane
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshLambertMaterial({ color: 0x888888 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Geometry and players
const players = {};
const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);

const localPlayer = {
  mesh: new THREE.Mesh(cubeGeometry, new THREE.MeshLambertMaterial({ color: 0x00ff00 })),
  pos: { x: 0, y: 0, z: 0 }
};
scene.add(localPlayer.mesh);

// Camera rotation state
let yaw = 0;
let pitch = 0;
const sensitivity = 0.002;

function updateCameraRotation() {
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

// Pointer lock + overlay
const overlay = document.getElementById('overlay');

function lockPointer() {
  const canvas = document.getElementById('gameCanvas');
  canvas.requestPointerLock = canvas.requestPointerLock || canvas.mozRequestPointerLock;
  canvas.requestPointerLock();
}

overlay.addEventListener('click', () => {
  lockPointer();
});

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

// WASD movement
const keys = {};
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

function updateMovement() {
  const speed = 0.1;
  const direction = new THREE.Vector3();

  if (keys['w']) direction.z -= 1;
  if (keys['s']) direction.z += 1;
  if (keys['a']) direction.x -= 1;
  if (keys['d']) direction.x += 1;

  direction.normalize().applyEuler(camera.rotation);
  localPlayer.pos.x += direction.x * speed;
  localPlayer.pos.z += direction.z * speed;
  localPlayer.pos.y = 0; // Clamp to ground

  // Update player and camera position
  localPlayer.mesh.position.set(localPlayer.pos.x, localPlayer.pos.y, localPlayer.pos.z);
  camera.position.set(localPlayer.pos.x, localPlayer.pos.y + 1.6, localPlayer.pos.z);

  // Sync with server
  socket.emit('move', localPlayer.pos);
}

function animate() {
  requestAnimationFrame(animate);
  updateMovement();
  renderer.render(scene, camera);
}
animate();

// Socket.io events
socket.on('init', playerData => {
  for (const id in playerData) {
    if (id === socket.id) continue;
    addRemotePlayer(id, playerData[id]);
  }
});

socket.on('playerJoined', data => addRemotePlayer(data.id, data));

socket.on('playerMoved', data => {
  if (players[data.id]) {
    players[data.id].mesh.position.set(data.x, data.y, data.z);
  }
});

socket.on('playerLeft', id => {
  if (players[id]) {
    scene.remove(players[id].mesh);
    delete players[id];
  }
});

function addRemotePlayer(id, pos) {
  const mesh = new THREE.Mesh(cubeGeometry, new THREE.MeshLambertMaterial({ color: 0x0000ff }));
  mesh.position.set(pos.x, pos.y, pos.z);
  scene.add(mesh);
  players[id] = { mesh };
}

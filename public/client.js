const socket = io();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas') });
renderer.setSize(window.innerWidth, window.innerHeight);

const players = {};
const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);

const localPlayer = {
  mesh: new THREE.Mesh(cubeGeometry, new THREE.MeshLambertMaterial({ color: 0x00ff00 })),
  pos: { x: 0, y: 0, z: 0 }
};
scene.add(localPlayer.mesh);

// Lighting
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 5).normalize();
scene.add(light);

camera.position.set(0, 5, 10);
camera.lookAt(0, 0, 0);

// Handle WASD movement
const keys = {};
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

function updateMovement() {
  const speed = 0.1;
  if (keys['w']) localPlayer.pos.z -= speed;
  if (keys['s']) localPlayer.pos.z += speed;
  if (keys['a']) localPlayer.pos.x -= speed;
  if (keys['d']) localPlayer.pos.x += speed;
  localPlayer.mesh.position.set(localPlayer.pos.x, localPlayer.pos.y, localPlayer.pos.z);
  socket.emit('move', localPlayer.pos);
}

function animate() {
  requestAnimationFrame(animate);
  updateMovement();
  renderer.render(scene, camera);
}
animate();

// Server events
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

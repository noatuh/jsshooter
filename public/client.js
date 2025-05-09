// ===== public/client.js =====
const socket = io();

/* ---------------- THREE INITIALISATION ---------------- */
const scene   = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Light Sky Blue
const camera  = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas') });
renderer.setSize(window.innerWidth, window.innerHeight);

/* ---------------- LIGHTING ---------------- */
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(5, 10, 5).normalize();
scene.add(dirLight);

/* ---------------- PERLIN‑NOISE UTILITY ---------------- */
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
const perlin = new ImprovedNoise();

/* ---------------- CHUNKED TERRAIN ---------------- */
const blockGeom  = new THREE.BoxGeometry(1, 1, 1);
const blockMat   = new THREE.MeshLambertMaterial({ color: 0x777755 });
const placedBlockMat = new THREE.MeshLambertMaterial({ color: 0x997755 }); // Slightly different color for placed blocks

let clientMapData = []; // Holds all current block data {x,y,z}
const voxelData   = [];         // {x,y,z, instanceId, removed} - Store instanceId for lookup
let terrainInstancedMesh;       // Will hold our InstancedMesh

function heightAt(wx, wz) {
  const scale = 0.06, amp = 8;
  return Math.floor((perlin.noise(wx * scale, 0, wz * scale) + 1) * amp * 0.5);
}

/* ---------------- PLAYER & CAMERA ---------------- */
const players = {};
const pGeom = new THREE.BoxGeometry(1, 1, 1);
const localPlayer = {
  mesh: new THREE.Mesh(pGeom, new THREE.MeshLambertMaterial({ color: 0x00ff00 })),
  pos : { x: 0, y: heightAt(0, 0) + 1, z: 0 }
};
scene.add(localPlayer.mesh);

let yaw = 0, pitch = 0;
const SENS = 0.002;
function setCam() { camera.rotation.order = 'YXZ'; camera.rotation.y = yaw; camera.rotation.x = pitch; }

/* ----- pointer‑lock UI ----- */
const overlay = document.getElementById('overlay');
overlay.addEventListener('click', () => document.getElementById('gameCanvas').requestPointerLock());
document.addEventListener('pointerlockchange', () => overlay.style.display = document.pointerLockElement === renderer.domElement ? 'none' : 'flex');
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === renderer.domElement) {
    yaw -= e.movementX * SENS;
    pitch -= e.movementY * SENS;
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    setCam();
  }
});

/* ---------------- MOVEMENT ---------------- */
const keys = {};
window.addEventListener('keydown', e => (keys[e.key.toLowerCase()] = true));
window.addEventListener('keyup',   e => (keys[e.key.toLowerCase()] = false));

function movePlayer() {
  const speed = 0.15, dir = new THREE.Vector3();
  if (keys['w']) dir.z -= 1;
  if (keys['s']) dir.z += 1;
  if (keys['a']) dir.x -= 1;
  if (keys['d']) dir.x += 1;
  if (dir.lengthSq() > 0) {
    dir.normalize().applyEuler(camera.rotation);
    localPlayer.pos.x += dir.x * speed;
    localPlayer.pos.z += dir.z * speed;
  }
  localPlayer.pos.y = heightAt(localPlayer.pos.x, localPlayer.pos.z) + 1;

  localPlayer.mesh.position.set(localPlayer.pos.x, localPlayer.pos.y, localPlayer.pos.z);
  camera.position.set(localPlayer.pos.x, localPlayer.pos.y + 1.6, localPlayer.pos.z);

  socket.emit('move', localPlayer.pos);
}

/* ---------------- BLOCK DESTRUCTION ---------------- */
const ray = new THREE.Raycaster();
const dummy = new THREE.Object3D(); // Used to set instance transforms

function deleteBlock(instanceId, broadcast = true) {
  if (terrainInstancedMesh && instanceId !== undefined) {
    const blockInfo = voxelData.find(v => v.instanceId === instanceId && !v.removed);
    if (!blockInfo) return; // Already removed or invalid instanceId

    // "Hide" the instance by scaling it to zero
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    terrainInstancedMesh.setMatrixAt(instanceId, dummy.matrix);
    terrainInstancedMesh.instanceMatrix.needsUpdate = true;

    blockInfo.removed = true; 
    if (broadcast) {
      // Send the actual coordinates of the block being removed
      socket.emit('removeBlock', { x: blockInfo.x, y: blockInfo.y, z: blockInfo.z });
    }
  }
}

function breakBlock() {
  if (document.pointerLockElement !== renderer.domElement || !terrainInstancedMesh) return;
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const intersects = ray.intersectObject(terrainInstancedMesh, false); 
  
  if (intersects.length > 0) {
    const hit = intersects[0];
    if (hit.instanceId !== undefined) {
      const blockInfo = voxelData.find(v => v.instanceId === hit.instanceId && !v.removed);
      if (blockInfo) { // Check if not already "removed" (scaled to zero or marked)
        deleteBlock(hit.instanceId);
      }
    }
  }
}

function placeBlock() {
  if (document.pointerLockElement !== renderer.domElement || !terrainInstancedMesh) return;
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const intersects = ray.intersectObject(terrainInstancedMesh, false);

  if (intersects.length > 0) {
    const hit = intersects[0];
    if (hit.instanceId !== undefined && hit.face) {
      const blockInfo = voxelData.find(v => v.instanceId === hit.instanceId && !v.removed);
      if (!blockInfo) return; // Hit a removed block

      // Get position of the hit instance
      const hitMatrix = new THREE.Matrix4();
      terrainInstancedMesh.getMatrixAt(hit.instanceId, hitMatrix);
      const hitPosition = new THREE.Vector3();
      hitPosition.setFromMatrixPosition(hitMatrix);

      // Calculate new block position based on the face normal
      // Ensure hit.face.normal is in world coordinates (it should be for InstancedMesh)
      const newBlockPos = {
        x: Math.round(hitPosition.x + hit.face.normal.x),
        y: Math.round(hitPosition.y + hit.face.normal.y),
        z: Math.round(hitPosition.z + hit.face.normal.z)
      };
      
      // Simple check: don't place block where player is standing
      const playerBB = new THREE.Box3().setFromCenterAndSize(localPlayer.mesh.position, new THREE.Vector3(0.8, 1.8, 0.8));
      const newBlockBB = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(newBlockPos.x, newBlockPos.y, newBlockPos.z), new THREE.Vector3(1,1,1));
      if (!playerBB.intersectsBox(newBlockBB)) {
          socket.emit('placeBlockRequest', newBlockPos);
      } else {
          console.log("Cannot place block inside player.");
      }
    }
  }
}

document.addEventListener('mousedown', e => {
  if (document.pointerLockElement === renderer.domElement) {
    if (e.button === 0) breakBlock();    // Left click
    if (e.button === 2) placeBlock();    // Right click
  }
});
// Prevent context menu on right click on canvas
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());


function rebuildInstancedMesh() {
  if (terrainInstancedMesh) {
    scene.remove(terrainInstancedMesh);
    terrainInstancedMesh.geometry.dispose(); // Dispose geometry
    // Material is shared, dispose if it's unique to this instanced mesh and no longer needed
    // terrainInstancedMesh.material.dispose(); 
    terrainInstancedMesh = null; 
  }
  voxelData.length = 0; // Clear previous instance lookup data

  if (clientMapData.length === 0) return; // No data to build mesh from

  terrainInstancedMesh = new THREE.InstancedMesh(blockGeom, blockMat, clientMapData.length);
  terrainInstancedMesh.userData.isBlockContainer = true;

  for (let i = 0; i < clientMapData.length; i++) {
    const block = clientMapData[i];
    dummy.position.set(block.x, block.y, block.z);
    dummy.scale.set(1,1,1); 
    dummy.updateMatrix();
    terrainInstancedMesh.setMatrixAt(i, dummy.matrix);
    voxelData.push({ x: block.x, y: block.y, z: block.z, instanceId: i, removed: false });
  }
  terrainInstancedMesh.instanceMatrix.needsUpdate = true;
  scene.add(terrainInstancedMesh);
  console.log(`InstancedMesh rebuilt with ${clientMapData.length} blocks.`);
}


/* ---------------- SOCKET.IO EVENTS ---------------- */
socket.on('init', data => { 
  clientMapData = data.mapData || [];
  rebuildInstancedMesh();

  // Load players
  for (const id in data.players) {
    if (id !== socket.id) {
      addRemote(id, data.players[id]);
    } else { // Set local player's initial position from server
      localPlayer.pos.x = data.players[id].x;
      localPlayer.pos.y = data.players[id].y;
      localPlayer.pos.z = data.players[id].z;
      localPlayer.mesh.position.set(localPlayer.pos.x, localPlayer.pos.y, localPlayer.pos.z);
      camera.position.set(localPlayer.pos.x, localPlayer.pos.y + 1.6, localPlayer.pos.z);
    }
  }
});
socket.on('playerJoined', d => addRemote(d.id, d));
socket.on('playerMoved',  d => players[d.id] && players[d.id].mesh.position.set(d.x, d.y, d.z));
socket.on('playerLeft',   id => { if (players[id]) { scene.remove(players[id].mesh); delete players[id]; } });
socket.on('blockRemoved', coord => {
  const vDataEntry = voxelData.find(v => v.x === coord.x && v.y === coord.y && v.z === coord.z && !v.removed);
  if (vDataEntry) {
    deleteBlock(vDataEntry.instanceId, false); // Call with broadcast = false as server already handled it
  }

  // Update clientMapData to reflect the removal.
  // This ensures clientMapData is accurate for subsequent operations like placing blocks.
  const mapDataIndex = clientMapData.findIndex(b => b.x === coord.x && b.y === coord.y && b.z === coord.z);
  if (mapDataIndex !== -1) {
    clientMapData.splice(mapDataIndex, 1);
  }
  // Note: We don't need to call rebuildInstancedMesh() here because hiding an instance is sufficient for removal.
  // clientMapData.length will be out of sync with terrainInstancedMesh.count, but voxelData tracks 'removed' status.
});

socket.on('blockPlaced', coord => {
  const alreadyExists = clientMapData.some(b => b.x === coord.x && b.y === coord.y && b.z === coord.z);
  if (!alreadyExists) {
    clientMapData.push(coord); // Add to client's source of truth
    rebuildInstancedMesh(); // Rebuild mesh to include the new block and update voxelData
  }
});
function addRemote(id, pos) {
  const m = new THREE.Mesh(pGeom, new THREE.MeshLambertMaterial({ color: 0x0000ff }));
  m.position.set(pos.x, pos.y, pos.z);
  scene.add(m); players[id] = { mesh: m };
}

/* ---------------- GAME LOOP ---------------- */
(function animate() {
  requestAnimationFrame(animate);
  movePlayer();
  renderer.render(scene, camera);
})();

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
const placedBlockMat = new THREE.MeshLambertMaterial({ color: 0x997755 });

let clientMapData = [];
const voxelData   = [];
let terrainInstancedMesh;

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

/* ---------------- MOVEMENT & PHYSICS ---------------- */
const keys = {};
window.addEventListener('keydown', e => (keys[e.code] = true));
window.addEventListener('keyup',   e => (keys[e.code] = false));

let velocity = { x: 0, y: 0, z: 0 };
let isGrounded = false;
let gravity = -9.81;  // Realistic gravity (meters per second squared)
let jumpStrength = 4.5;  // Realistic jump height
let moveSpeed = 4.0;  // Realistic walking speed
let friction = 0.8;
let airResistance = 0.98;
let playerHeight = 1.8;

// Add throttling for server updates
let lastServerUpdate = 0;
const SERVER_UPDATE_INTERVAL = 50; // 20 times per second instead of 60

// Add delta time tracking for smooth physics
let lastTime = performance.now();

/* ---------------- DEBUG INFO ---------------- */
let showDebugInfo = false;
const debugDiv = document.createElement('div');
debugDiv.id = 'debug-info';
debugDiv.style.cssText = `
  position: fixed;
  top: 10px;
  left: 10px;
  background: rgba(0,0,0,0.7);
  color: white;
  padding: 10px;
  font-family: monospace;
  font-size: 12px;
  border-radius: 5px;
  z-index: 1000;
  display: none;
`;
document.body.appendChild(debugDiv);

// Toggle debug info with F1 key
window.addEventListener('keydown', e => {
  if (e.code === 'F1') {
    showDebugInfo = !showDebugInfo;
    debugDiv.style.display = showDebugInfo ? 'block' : 'none';
  }
});

function updateDebugInfo() {
  if (showDebugInfo) {
    debugDiv.innerHTML = `
      Position: ${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}<br>
      Velocity: ${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)}, ${velocity.z.toFixed(2)}<br>
      Grounded: ${isGrounded}<br>
      Speed: ${Math.sqrt(velocity.x*velocity.x + velocity.z*velocity.z).toFixed(2)} m/s<br>
      Ground Height: ${(heightAt(camera.position.x, camera.position.z) + playerHeight).toFixed(2)}<br>
      <small>Press F1 to toggle debug info</small>
    `;
  }
}

/* ---------------- HELPER FUNCTIONS ---------------- */
function boxIntersects(box1, box2) {
  return (box1.min.x < box2.max.x && box1.max.x > box2.min.x) &&
         (box1.min.y < box2.max.y && box1.max.y > box2.min.y) &&
         (box1.min.z < box2.max.z && box1.max.z > box2.min.z);
}

/* ---------------- GAME LOOP ---------------- */
function animate() {
  requestAnimationFrame(animate);
  
  // Calculate delta time for smooth physics
  const currentTime = performance.now();
  const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.02); // Cap at 50ms to prevent large jumps
  lastTime = currentTime;
  
  if (document.pointerLockElement === renderer.domElement) {
    // Get input directions
    const inputDirection = new THREE.Vector3();
    
    // Movement input
    if (keys['KeyW']) inputDirection.z -= 1;
    if (keys['KeyS']) inputDirection.z += 1;
    if (keys['KeyA']) inputDirection.x -= 1;
    if (keys['KeyD']) inputDirection.x += 1;
    
    // Apply camera rotation to movement direction
    if (inputDirection.length() > 0) {
      inputDirection.normalize();
      const euler = new THREE.Euler(0, camera.rotation.y, 0);
      inputDirection.applyEuler(euler);
      inputDirection.multiplyScalar(moveSpeed);
    }

    // Apply gravity
    velocity.y += gravity * deltaTime;
    
    // Horizontal movement with acceleration/deceleration
    const acceleration = 25.0; // How quickly player accelerates
    const deceleration = 15.0; // How quickly player stops
    
    if (inputDirection.length() > 0) {
      // Accelerate towards desired velocity
      velocity.x += (inputDirection.x - velocity.x) * acceleration * deltaTime;
      velocity.z += (inputDirection.z - velocity.z) * acceleration * deltaTime;
    } else {
      // Decelerate when no input
      velocity.x *= Math.pow(1 - deceleration * deltaTime, deltaTime * 60);
      velocity.z *= Math.pow(1 - deceleration * deltaTime, deltaTime * 60);
    }
    
    // Apply air resistance if not grounded
    if (!isGrounded) {
      velocity.x *= Math.pow(airResistance, deltaTime * 60);
      velocity.z *= Math.pow(airResistance, deltaTime * 60);
    }

    // Jumping - only if on ground
    if (keys['Space'] && isGrounded) {
      velocity.y = jumpStrength;
      isGrounded = false;
    }

    // Calculate new position
    const newPosition = camera.position.clone();
    newPosition.x += velocity.x * deltaTime;
    newPosition.z += velocity.z * deltaTime;
    newPosition.y += velocity.y * deltaTime;

    // Ground collision detection
    const terrainHeight = heightAt(newPosition.x, newPosition.z);
    const groundY = terrainHeight + playerHeight;
    
    if (newPosition.y <= groundY) {
      newPosition.y = groundY;
      if (velocity.y < 0) { // Only stop downward movement
        velocity.y = 0;
        isGrounded = true;
      }
    } else {
      isGrounded = false;
    }

    // Block collision detection (improved AABB with proper collision response)
    const playerRadius = 0.4; // Half the player width for collision
    const playerBottom = newPosition.y - playerHeight / 2;
    const playerTop = newPosition.y + playerHeight / 2;
    
    // Check collision with placed blocks
    for (const voxel of voxelData) {
      if (voxel.removed) continue;
      
      const blockCenter = new THREE.Vector3(voxel.x, voxel.y, voxel.z);
      const dx = newPosition.x - blockCenter.x;
      const dy = newPosition.y - blockCenter.y;
      const dz = newPosition.z - blockCenter.z;
      
      // Check if player is within collision range of this block
      if (Math.abs(dx) < 0.5 + playerRadius && 
          Math.abs(dz) < 0.5 + playerRadius &&
          playerBottom < blockCenter.y + 0.5 && 
          playerTop > blockCenter.y - 0.5) {
        
        // Determine collision direction based on smallest overlap
        const overlapX = (0.5 + playerRadius) - Math.abs(dx);
        const overlapZ = (0.5 + playerRadius) - Math.abs(dz);
        const overlapY = Math.min(playerTop - (blockCenter.y - 0.5), (blockCenter.y + 0.5) - playerBottom);
        
        // Resolve collision by moving out of the block
        if (overlapX < overlapZ && overlapX < overlapY) {
          // Push out horizontally (X direction)
          if (dx > 0) newPosition.x = blockCenter.x + 0.5 + playerRadius;
          else newPosition.x = blockCenter.x - 0.5 - playerRadius;
          velocity.x = 0;
        } else if (overlapZ < overlapY) {
          // Push out horizontally (Z direction)
          if (dz > 0) newPosition.z = blockCenter.z + 0.5 + playerRadius;
          else newPosition.z = blockCenter.z - 0.5 - playerRadius;
          velocity.z = 0;
        } else {
          // Push out vertically (Y direction)
          if (dy > 0) {
            // Player is above block
            newPosition.y = blockCenter.y + 0.5 + playerHeight / 2;
            if (velocity.y < 0) velocity.y = 0;
          } else {
            // Player is below block  
            newPosition.y = blockCenter.y - 0.5 - playerHeight / 2;
            if (velocity.y > 0) velocity.y = 0;
          }
          if (dy < 0 && velocity.y <= 0) {
            isGrounded = true; // Standing on top of block
          }
        }
        break; // Only handle one collision per frame for simplicity
      }
    }

    // Update camera position
    camera.position.copy(newPosition);
    
    // Update local player mesh position
    localPlayer.pos.x = camera.position.x;
    localPlayer.pos.y = camera.position.y;
    localPlayer.pos.z = camera.position.z;
    localPlayer.mesh.position.copy(camera.position);

    // Throttled server updates to prevent conflicts with physics
    const now = Date.now();
    if (now - lastServerUpdate > SERVER_UPDATE_INTERVAL) {
      socket.emit('playerMove', {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z
      });
      lastServerUpdate = now;
    }
  }

  updateDebugInfo(); // Update debug info display
  renderer.render(scene, camera);
}

// Start the animation loop
animate();

/* ---------------- BLOCK DESTRUCTION ---------------- */
const ray = new THREE.Raycaster();
const dummy = new THREE.Object3D();

function deleteBlock(instanceId, broadcast = true) {
  if (terrainInstancedMesh && instanceId !== undefined) {
    const blockInfo = voxelData.find(v => v.instanceId === instanceId && !v.removed);
    if (!blockInfo) return;

    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    terrainInstancedMesh.setMatrixAt(instanceId, dummy.matrix);
    terrainInstancedMesh.instanceMatrix.needsUpdate = true;

    blockInfo.removed = true; 
    if (broadcast) {
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
      if (blockInfo) {
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
      if (!blockInfo) return;

      const hitMatrix = new THREE.Matrix4();
      terrainInstancedMesh.getMatrixAt(hit.instanceId, hitMatrix);
      const hitPosition = new THREE.Vector3();
      hitPosition.setFromMatrixPosition(hitMatrix);

      const newBlockPos = {
        x: Math.round(hitPosition.x + hit.face.normal.x),
        y: Math.round(hitPosition.y + hit.face.normal.y),
        z: Math.round(hitPosition.z + hit.face.normal.z)
      };
      
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
    if (e.button === 0) breakBlock();
    if (e.button === 2) placeBlock();
  }
});
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

function rebuildInstancedMesh() {
  if (terrainInstancedMesh) {
    scene.remove(terrainInstancedMesh);
    terrainInstancedMesh.geometry.dispose();
    terrainInstancedMesh = null; 
  }
  voxelData.length = 0;

  if (clientMapData.length === 0) return;

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

  for (const id in data.players) {
    if (id !== socket.id) {
      addRemote(id, data.players[id]);
    } else {
      // Set local player's initial position from server
      const serverPos = data.players[id];
      console.log("Server initial position:", serverPos);
      
      // Ensure player spawns slightly above ground to avoid clipping
      const groundHeight = heightAt(serverPos.x, serverPos.z);
      const spawnY = Math.max(serverPos.y, groundHeight + playerHeight + 0.1);
      
      localPlayer.pos.x = serverPos.x;
      localPlayer.pos.y = spawnY;
      localPlayer.pos.z = serverPos.z;
      localPlayer.mesh.position.set(serverPos.x, spawnY, serverPos.z);
      camera.position.set(serverPos.x, spawnY, serverPos.z);
      
      // Initialize physics - player should fall to ground naturally
      velocity = { x: 0, y: 0, z: 0 };
      isGrounded = false; // Let physics determine if grounded
      
      console.log("Client initialized at:", camera.position);
      console.log("Ground height at spawn:", groundHeight);
      console.log("Spawn height:", spawnY);
    }
  }
});

socket.on('playerJoined', d => addRemote(d.id, d));
socket.on('playerMoved',  d => players[d.id] && players[d.id].mesh.position.set(d.x, d.y, d.z));
socket.on('playerLeft',   id => { if (players[id]) { scene.remove(players[id].mesh); delete players[id]; } });

socket.on('blockRemoved', coord => {
  const vDataEntry = voxelData.find(v => v.x === coord.x && v.y === coord.y && v.z === coord.z && !v.removed);
  if (vDataEntry) {
    deleteBlock(vDataEntry.instanceId, false);
  }

  const mapDataIndex = clientMapData.findIndex(b => b.x === coord.x && b.y === coord.y && b.z === coord.z);
  if (mapDataIndex !== -1) {
    clientMapData.splice(mapDataIndex, 1);
  }
});

socket.on('blockPlaced', coord => {
  const alreadyExists = clientMapData.some(b => b.x === coord.x && b.y === coord.y && b.z === coord.z);
  if (!alreadyExists) {
    clientMapData.push(coord);
    rebuildInstancedMesh();
  }
});

function addRemote(id, pos) {
  const m = new THREE.Mesh(pGeom, new THREE.MeshLambertMaterial({ color: 0x0000ff }));
  m.position.set(pos.x, pos.y, pos.z);
  scene.add(m); 
  players[id] = { mesh: m };
}

// MOTO STUNT — Phase 0-3
//   Phase 0+1: setup + keyboard playable prototype
//   Phase 2:   MediaPipe hand controls + pixel-art grade
//   Phase 3:   local 2-player split-screen (independent worlds, low-res RT composite)
// SSOT: docs/GAMEPLAN.md
import * as THREE from 'three';
import { HandTracker, computeControls } from './hands.js';
import { makeBayerTexture } from './pixelart.js';
import { Net } from './net.js';
import { VEHICLES, mountRider } from '../models/vehicles.js';
import { at } from '../models/_kit.js';
import { openKartSelect } from './kartselect.js';

// soft/angular 3D vehicle models keyed for in-game use
const VMAP = Object.fromEntries(VEHICLES.map(v => [v.key, v]));
const DEFAULT_VEHICLE = 'dirtbike';
// build a vehicle model oriented for the game (forward = -Z) with a rider mounted
function buildVehicleModel(key, bodyColor, riderColor) {
  const v = VMAP[key] || VMAP[DEFAULT_VEHICLE];
  const inner = v.build(bodyColor);
  if (v.seat) mountRider(inner, v.seat, riderColor != null ? riderColor : 0xf4ead6);
  inner.rotation.y = Math.PI / 2;        // model faces +X -> rotate so forward is -Z
  inner.scale.setScalar(1.4);            // size up for the in-game camera
  return inner;
}

// ---------------------------------------------------------------------------
// Tuning (mirror of GAMEPLAN §10)
// ---------------------------------------------------------------------------
const CFG = {
  baseSpeed: 60, wheelieSpeedMul: 2.3, steerSpeed: 22, roadWidth: 12,
  wheelieAccel: 7,   // how fast speed ramps toward the wheelie boost (higher = snappier)
  rewindSeconds: 2,  // on death, respawn at the position from this many seconds ago
  kbWheelie: 0.5,    // keyboard wheelie-up strength (1 = full rate; lower = raises slower)
  speedWarp: 0.55,   // barrel screen-warp strength at top speed
  maxPitch: 1.0, pitchRiseRate: 2.2, pitchFallRate: 2.5, trackLength: 3000,
  respawnFreeze: 1.0, invincibleTime: 1.5,
  pixelSize: 4,            // low-res RT downscale factor (lower = sharper shapes)
  colorSteps: 6, dither: 0.65,  // pixel-art grade — softened so bike shapes read clearly
};
const STATE = { RIDING: 'riding', CRASHED: 'crashed', FINISHED: 'finished' };

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;
document.getElementById('app').appendChild(renderer.domElement);

// ---------------------------------------------------------------------------
// World factory — an independent scene/camera/bike/track per player
// ---------------------------------------------------------------------------
function buildGridFloor() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uLine: { value: new THREE.Color(0x1f4f7a) }, uMajor: { value: new THREE.Color(0x2f7fc0) },
      uBg: { value: new THREE.Color(0x0c1020) }, uScale: { value: 0.5 },
    },
    extensions: { derivatives: true },
    vertexShader: `varying vec3 vWorld; void main(){ vWorld=(modelMatrix*vec4(position,1.0)).xyz;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vWorld; uniform vec3 uLine; uniform vec3 uMajor; uniform vec3 uBg; uniform float uScale;
      float grid(vec2 c){ vec2 g=abs(fract(c-0.5)-0.5)/fwidth(c); return 1.0-min(min(g.x,g.y),1.0); }
      void main(){ vec2 c=vWorld.xz*uScale; float mi=grid(c); float ma=grid(c*0.2);
        vec3 col=mix(uBg,uLine,mi); col=mix(col,uMajor,ma); gl_FragColor=vec4(col,1.0); }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 4000), mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.02, -CFG.trackLength / 2);
  return floor;
}

function buildRoad() {
  const g = new THREE.Group();
  const len = CFG.trackLength + 120;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(CFG.roadWidth + 4, len),
    new THREE.MeshLambertMaterial({ color: 0x15151c, flatShading: true }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, -CFG.trackLength / 2 + 30);
  g.add(road);
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x5ad1ff });
  for (const sx of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, len), edgeMat);
    edge.position.set(sx * (CFG.roadWidth / 2 + 0.4), 0.06, -CFG.trackLength / 2 + 30);
    g.add(edge);
  }
  const finMat = new THREE.MeshBasicMaterial({ color: 0xffd54a });
  const fin = new THREE.Mesh(new THREE.BoxGeometry(CFG.roadWidth + 4, 0.2, 2), finMat);
  fin.position.set(0, 0.1, -CFG.trackLength); g.add(fin);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), finMat);
    post.position.set(sx * (CFG.roadWidth / 2 + 1.5), 4, -CFG.trackLength); g.add(post);
  }
  return g;
}

// Builds the selected soft/angular 3D vehicle as a game bike pivot.
//   bodyColor: vehicle body tint;  opts: { vehicle: key, rider: riderColor }
function buildBike(bodyColor, opts = {}) {
  const pivot = new THREE.Group();
  pivot.rotation.order = 'YXZ';   // yaw (steer) -> pitch (wheelie) -> roll (lean)
  const inner = buildVehicleModel(opts.vehicle || DEFAULT_VEHICLE, bodyColor, opts.rider);
  pivot.add(inner);
  // collect wheel groups so the game can spin them (about their local Z axle)
  pivot.userData.wheels = [];
  inner.traverse(o => { if (o.userData && o.userData.isWheel) pivot.userData.wheels.push(o); });
  return pivot;
}

function buildObstacles(scene) {
  const obstacles = [];
  const coneMat = new THREE.MeshLambertMaterial({ color: 0xff7a1a, flatShading: true });
  const baseMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  let z = -90;
  while (z > -CFG.trackLength + 40) {
    const lane = Math.sin(z * 0.37) * (CFG.roadWidth / 2 - 1.2);
    const cone = new THREE.Group();
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.0, 8), coneMat); c.position.y = 1.0; cone.add(c);
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.15, 1.6), baseMat); b.position.y = 0.07; cone.add(b);
    cone.position.set(lane, 0, z);
    cone.userData = { x: lane, z, hit: false };
    scene.add(cone); obstacles.push(cone);
    z -= 38 + Math.abs(Math.cos(z)) * 26;
  }
  return obstacles;
}

function createWorld(bodyColor) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a14);
  scene.fog = new THREE.Fog(0x0a0a14, 60, 260);
  scene.add(new THREE.HemisphereLight(0x88bbff, 0x222233, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(6, 12, 4); scene.add(sun);
  scene.add(buildGridFloor());
  scene.add(buildRoad());
  let bike = buildBike(bodyColor); scene.add(bike);
  let myChoice = { vehicle: DEFAULT_VEHICLE, color: bodyColor };
  // swap the player's bike to a chosen vehicle + color (from kart select)
  function setVehicle(choice) {
    if (choice) myChoice = { vehicle: choice.vehicle || myChoice.vehicle, color: choice.color != null ? choice.color : myChoice.color };
    scene.remove(bike);
    bike.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    bike = buildBike(myChoice.color, { vehicle: myChoice.vehicle });
    scene.add(bike);
  }

  // opponent ghost (online): half-saturation + translucent
  function ghostify(bk) {
    bk.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      const c = o.material.color, g = (c.r + c.g + c.b) / 3;
      c.setRGB(c.r * 0.5 + g * 0.5, c.g * 0.5 + g * 0.5, c.b * 0.5 + g * 0.5); // halve saturation
      o.material.transparent = true; o.material.opacity = 0.5; o.material.depthWrite = false;
    });
  }
  let oppBike = buildBike(0x49d17a); ghostify(oppBike);
  oppBike.visible = false; scene.add(oppBike);
  let oppChoice = { vehicle: DEFAULT_VEHICLE, color: 0x49d17a };
  function setOppVehicle(choice) {
    if (choice) oppChoice = { vehicle: choice.vehicle || oppChoice.vehicle, color: choice.color != null ? choice.color : oppChoice.color };
    const vis = oppBike.visible;
    scene.remove(oppBike); oppBike.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    oppBike = buildBike(oppChoice.color, { vehicle: oppChoice.vehicle }); ghostify(oppBike);
    oppBike.visible = vis; scene.add(oppBike);
  }
  const opp = { active: false, dist: 0, lane: 0, pitch: 0, td: 0, tl: 0, tp: 0, alive: true };
  function setOpponentState(s) { opp.active = true; opp.td = s.s || 0; opp.tl = s.x || 0; opp.tp = s.p || 0; opp.alive = (s.st !== 1); }
  function clearOpponent() { opp.active = false; oppBike.visible = false; opp.dist = opp.td = opp.lane = opp.tl = opp.pitch = opp.tp = 0; }

  const obstacles = buildObstacles(scene);

  // top-down spotlight that follows the player (the "위에서 아래로 빛나는" glow)
  const spot = new THREE.SpotLight(0xcfe4ff, 140, 50, Math.PI * 0.28, 0.5, 1.0);
  spot.position.set(0, 16, 4); scene.add(spot); scene.add(spot.target);

  // visible glowing light-pool on the ground under the player (additive, radial
  // falloff). Rendered in-scene so it gets fully pixelated + dithered by the composite.
  const pool = new THREE.Mesh(new THREE.CircleGeometry(7, 36), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x7fc0ff) } },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: `varying vec2 vP; void main(){ vP = uv * 2.0 - 1.0;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vP; uniform vec3 uColor;
      void main(){
        float a = smoothstep(1.0, 0.0, length(vP));
        a = floor(a * 4.0 + 0.001) / 4.0;   // step into concentric rings -> pixel-art light
        gl_FragColor = vec4(uColor * a, a);
      }`,
  }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.04; scene.add(pool);

  // spark particles emitted from the rear wheel during a high wheelie
  const SPARK_MAX = 90;
  const spkPos = new Float32Array(SPARK_MAX * 3).fill(-9999);
  const spkVel = new Float32Array(SPARK_MAX * 3);
  const spkLife = new Float32Array(SPARK_MAX);
  let spkIdx = 0;
  const spkGeo = new THREE.BufferGeometry();
  spkGeo.setAttribute('position', new THREE.BufferAttribute(spkPos, 3));
  const sparks = new THREE.Points(spkGeo, new THREE.PointsMaterial({
    color: 0xffc23a, size: 2.2, sizeAttenuation: false, transparent: true, depthWrite: false }));
  sparks.frustumCulled = false; scene.add(sparks);
  function spawnSpark(x, y, z) {
    const i = spkIdx; spkIdx = (spkIdx + 1) % SPARK_MAX;
    spkPos[i*3] = x; spkPos[i*3+1] = y; spkPos[i*3+2] = z;
    spkVel[i*3]   = (Math.random() - 0.5) * 4;
    spkVel[i*3+1] = 2 + Math.random() * 4;
    spkVel[i*3+2] = 4 + Math.random() * 7;     // fly backward (+z)
    spkLife[i] = 0.25 + Math.random() * 0.2;
  }
  function updateSparks(dt) {
    for (let i = 0; i < SPARK_MAX; i++) {
      if (spkLife[i] <= 0) continue;
      spkLife[i] -= dt;
      if (spkLife[i] <= 0) { spkPos[i*3+1] = -9999; continue; }
      spkVel[i*3+1] -= 26 * dt;                 // gravity
      spkPos[i*3]   += spkVel[i*3]   * dt;
      spkPos[i*3+1] += spkVel[i*3+1] * dt;
      spkPos[i*3+2] += spkVel[i*3+2] * dt;
    }
    spkGeo.attributes.position.needsUpdate = true;
  }

  // pixel fireworks for finishing 1st
  const FW_MAX = 500;
  const fwPos = new Float32Array(FW_MAX * 3).fill(-9999);
  const fwVel = new Float32Array(FW_MAX * 3);
  const fwLife = new Float32Array(FW_MAX);
  const fwCol = new Float32Array(FW_MAX * 3);
  let fwIdx = 0, celebrating = 0, fwTimer = 0;
  const fwGeo = new THREE.BufferGeometry();
  fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos, 3));
  fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol, 3));
  const fireworks = new THREE.Points(fwGeo, new THREE.PointsMaterial({
    size: 3.0, sizeAttenuation: false, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  fireworks.frustumCulled = false; scene.add(fireworks);
  const FW_PALETTE = [[1,0.3,0.3],[1,0.8,0.2],[0.4,0.8,1],[0.6,1,0.5],[1,0.5,0.9],[1,1,1]];
  function launchBurst(x, y, z) {
    const col = FW_PALETTE[(Math.random() * FW_PALETTE.length) | 0];
    const sp0 = 10 + Math.random() * 7;
    for (let k = 0; k < 48; k++) {
      const i = fwIdx; fwIdx = (fwIdx + 1) % FW_MAX;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const sp = sp0 * (0.6 + Math.random() * 0.4);
      fwPos[i*3] = x; fwPos[i*3+1] = y; fwPos[i*3+2] = z;
      fwVel[i*3] = Math.sin(ph)*Math.cos(th)*sp; fwVel[i*3+1] = Math.cos(ph)*sp; fwVel[i*3+2] = Math.sin(ph)*Math.sin(th)*sp;
      fwCol[i*3] = col[0]; fwCol[i*3+1] = col[1]; fwCol[i*3+2] = col[2];
      fwLife[i] = 1.1 + Math.random() * 0.7;
    }
    fwGeo.attributes.color.needsUpdate = true;
  }
  function updateFireworks(dt) {
    if (celebrating > 0) {
      celebrating -= dt; fwTimer -= dt;
      if (fwTimer <= 0) {
        fwTimer = 0.28;
        launchBurst(game.laneX + (Math.random()-0.5)*22, 14 + Math.random()*14, -game.distance - 12 - Math.random()*18);
      }
    }
    for (let i = 0; i < FW_MAX; i++) {
      if (fwLife[i] <= 0) continue;
      fwLife[i] -= dt;
      if (fwLife[i] <= 0) { fwPos[i*3+1] = -9999; continue; }
      fwVel[i*3+1] -= 9 * dt;            // gravity
      fwPos[i*3]   += fwVel[i*3]   * dt;
      fwPos[i*3+1] += fwVel[i*3+1] * dt;
      fwPos[i*3+2] += fwVel[i*3+2] * dt;
    }
    fwGeo.attributes.position.needsUpdate = true;
  }
  function celebrate() { celebrating = 4.5; fwTimer = 0; }
  function clearFireworks() { celebrating = 0; for (let i = 0; i < FW_MAX; i++) { fwLife[i] = 0; fwPos[i*3+1] = -9999; } fwGeo.attributes.position.needsUpdate = true; }

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);

  const game = { state: STATE.RIDING, distance: 0, laneX: 0, pitch: 0, turn: 0, speed: CFG.baseSpeed,
    crashTimer: 0, invincible: 0, crashTilt: 0, startTime: performance.now(), finishTime: 0 };
  const fx = { flash: 0, flashColor: new THREE.Color(1, 1, 1), shake: 0 }; // screen effects
  const baseFov = 62;
  const history = [];           // {t, distance, laneX} samples for rewind-respawn
  let respawnDist = 0, respawnLane = 0;

  function reset() {
    Object.assign(game, { state: STATE.RIDING, distance: 0, laneX: 0, pitch: 0, speed: CFG.baseSpeed,
      turn: 0, crashTimer: 0, invincible: 0, crashTilt: 0, startTime: performance.now(), finishTime: 0, frozen: false });
    fx.flash = 0; fx.shake = 0; camera.fov = baseFov; camera.updateProjectionMatrix();
    history.length = 0; respawnDist = 0; respawnLane = 0;
    clearFireworks(); clearOpponent();
    for (const o of obstacles) { o.userData.hit = false; o.visible = true; }
  }
  function triggerCrash() {
    if (game.state !== STATE.RIDING || game.invincible > 0) return;
    game.state = STATE.CRASHED; game.crashTimer = CFG.respawnFreeze; game.speed = 0;
    fx.flash = 0.7; fx.flashColor.setRGB(1.0, 0.25, 0.2); fx.shake = 0.6; // red impact + shake
    // pick the rewind target: where the player was rewindSeconds ago
    const target = performance.now() - CFG.rewindSeconds * 1000;
    respawnDist = history.length ? history[0].distance : 0;
    respawnLane = history.length ? history[0].laneX : 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].t <= target) { respawnDist = history[i].distance; respawnLane = history[i].laneX; break; }
    }
  }
  function respawn() {
    game.state = STATE.RIDING; game.pitch = 0; game.crashTilt = 0;
    game.speed = CFG.baseSpeed; game.invincible = CFG.invincibleTime;
    game.distance = respawnDist; game.laneX = respawnLane;   // rewind to ~2s ago
    camera.position.set(game.laneX * 0.6, 4.2, -game.distance + 8); // snap camera to rewound spot
    history.length = 0;
    fx.flash = 1.0; fx.flashColor.setRGB(0.6, 0.95, 1.0); // cyan respawn flash (번쩍)
  }

  function update(dt, input) {
    if (game.state === STATE.RIDING && !game.frozen) {
      game.laneX += (input.steer || 0) * CFG.steerSpeed * dt;
      const lim = CFG.roadWidth / 2 - 0.6;
      game.laneX = Math.max(-lim, Math.min(lim, game.laneX));

      const w = input.wheelie || 0;
      if (w > 0) game.pitch += CFG.pitchRiseRate * w * dt;
      else game.pitch += CFG.pitchFallRate * w * dt;   // w<=0 lowers front wheel (∝ |w|)
      game.pitch = Math.max(0, game.pitch);
      if (game.pitch > CFG.maxPitch) triggerCrash();

      const boost = 1 + (CFG.wheelieSpeedMul - 1) * Math.min(1, game.pitch / CFG.maxPitch);
      const target = CFG.baseSpeed * (game.pitch > 0.05 ? boost : 1);
      game.speed += (target - game.speed) * Math.min(1, dt * CFG.wheelieAccel);
      game.distance += game.speed * dt;

      // record position history for the rewind-respawn
      history.push({ t: performance.now(), distance: game.distance, laneX: game.laneX });
      while (history.length && history[0].t < performance.now() - 4000) history.shift();

      const bikeZ = -game.distance;
      for (const o of obstacles) {
        if (o.userData.hit) continue;
        const dz = o.userData.z - bikeZ;
        if (dz < 1.2 && dz > -2.4 && Math.abs(o.userData.x - game.laneX) < 1.35) {
          triggerCrash(); o.userData.hit = true;
        }
      }
      if (game.distance >= CFG.trackLength) {
        game.state = STATE.FINISHED;
        game.finishTime = (performance.now() - game.startTime) / 1000;
      }
      // high-wheelie sparks from the rear wheel contact
      if (game.pitch > CFG.maxPitch * 0.6) {
        const n = 1 + Math.floor((game.pitch / CFG.maxPitch) * 2);
        for (let k = 0; k < n; k++) spawnSpark(game.laneX + (Math.random() - 0.5) * 0.4, 0.15, -game.distance + 0.1);
      }
      if (game.invincible > 0) game.invincible -= dt;
    } else if (game.state === STATE.CRASHED) {
      game.crashTilt = Math.min(game.crashTilt + dt * 4, Math.PI * 0.6);
      game.crashTimer -= dt;
      if (game.crashTimer <= 0) respawn();
    }

    bike.position.set(game.laneX, 0, -game.distance);
    // steer turns the nose (yaw) and leans the bike into the turn instead of a flat slide
    const steerNow = game.state === STATE.RIDING ? (input.steer || 0) : 0;
    game.turn += (steerNow - game.turn) * Math.min(1, dt * 9);
    bike.rotation.x = game.state === STATE.CRASHED ? game.pitch + game.crashTilt : game.pitch;
    bike.rotation.y = -game.turn * 0.5;    // nose yaws toward the steer direction
    bike.rotation.z = -game.turn * 0.42;   // lean into the turn
    bike.visible = !(game.invincible > 0 && Math.floor(performance.now() / 90) % 2 === 0);
    for (const wm of bike.userData.wheels) wm.rotation.z -= game.speed * dt * 0.6;

    // spotlight follows the player from above; sparks advance
    spot.position.set(game.laneX, 16, -game.distance + 4);
    spot.target.position.set(game.laneX, 0, -game.distance - 3);
    spot.target.updateMatrixWorld();
    pool.position.set(game.laneX, 0.04, -game.distance);
    updateSparks(dt);
    updateFireworks(dt);

    // opponent ghost (online): smooth toward last received state
    if (opp.active) {
      const k = Math.min(1, dt * 8);
      opp.dist += (opp.td - opp.dist) * k; opp.lane += (opp.tl - opp.lane) * k; opp.pitch += (opp.tp - opp.pitch) * k;
      oppBike.visible = opp.alive;
      oppBike.position.set(opp.lane, 0, -opp.dist);
      oppBike.rotation.x = opp.pitch;
    }

    // normalized speed above base (0 = base, 1 = top wheelie speed)
    const spF = Math.min(1, Math.max(0, (game.speed - CFG.baseSpeed) / (CFG.baseSpeed * (CFG.wheelieSpeedMul - 1))));
    game.speedFactor = spF;

    // camera pulls back + up with speed -> player looks smaller, more road visible
    const camTarget = new THREE.Vector3(game.laneX * 0.6, 4.2 + spF * 1.0, -game.distance + 8 + spF * 5);
    camera.position.lerp(camTarget, Math.min(1, dt * 6));
    const headLook = (input.head || 0) * 18;   // head yaw pans the view left/right
    camera.lookAt(game.laneX * 0.3 + headLook, 1.6, -game.distance - 8);

    // speed-sense FOV kick (faster / higher wheelie = wider FOV)
    const targetFov = Math.min(95, baseFov + spF * 26 + game.pitch * 6);
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 5);
    camera.updateProjectionMatrix();

    // crash shake + flash decay
    fx.shake = Math.max(0, fx.shake - dt * 2);
    if (fx.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * fx.shake;
      camera.position.y += (Math.random() - 0.5) * fx.shake;
    }
    fx.flash = Math.max(0, fx.flash - dt * 3);
  }

  return { scene, camera, game, fx, reset, update, celebrate, setOpponentState, clearOpponent, setVehicle, setOppVehicle, opp, get bike() { return bike; }, obstacles };
}

// ---------------------------------------------------------------------------
// TRAIL DEATHMATCH — separate arena world factory (see docs/MODE_DEATHMATCH.md)
// D0: aerial arena + free-roam bike (heading/speed) + top-down chase camera
// ---------------------------------------------------------------------------
const DM = { moveSpeed: 34, turnRate: 2.6, arenaR: 95, startR: 42,
  trailGap: 1.6, trailW: 1.2, trailH: 2.4, graceSegs: 6, trailMax: 55, // tail length cap (shorter)
  shrinkRate: 2.4, minR: 16, wheelieMul: 1.7,      // shrink rate; wheelie speed boost
  jumpPadR: 3.8, jumpTime: 0.85, jumpHeight: 7, jumpPads: 7,  // jump ramps
  // --- shared score/respawn tuning ---
  matchTime: 300, respawnDelay: 2, invulnTime: 2.2, killScore: 2, minR: 16,
  itemInterval: 20 };   // rank-based item handed out every N seconds
// three deathmatch sub-modes
const DM_MODES = {
  score:    { name: '점수전 (5분)',   startR: 82, shrink: false, timer: 300, maxLives: 0, // 0 = infinite respawn
    desc: '5분간 점수 경쟁 · 죽으면 −1 · 킬 +2 · 무한 리스폰 · 넓은 맵' },
  survival: { name: '서바이벌 (즉사)', startR: 72, shrink: true,  timer: 0,   maxLives: 1,
    desc: '한 번 죽으면 끝 · 맵이 점점 좁아짐 · 최후의 1인 승리' },
  lives:    { name: '목숨 3개',        startR: 72, shrink: true,  timer: 0,   maxLives: 3,
    desc: '목숨 3개 · 맵이 좁아짐 · 다 잃으면 탈락 · 최후의 1인' },
};
function createArenaWorld(riderDefs, modeKey = 'score') {
  const mode = DM_MODES[modeKey] || DM_MODES.score;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06080f);
  scene.fog = new THREE.Fog(0x06080f, 70, 240);
  scene.add(new THREE.HemisphereLight(0x88bbff, 0x222233, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(5, 14, 4); scene.add(sun);
  const floor = buildGridFloor(); floor.position.set(0, -0.02, 0); scene.add(floor);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(DM.arenaR, 0.7, 8, 72), new THREE.MeshBasicMaterial({ color: 0x5ad1ff }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.4; scene.add(ring);

  // jump pads (점프대): random positions, re-rolled each game via placePads()
  const PADS = [];
  const padMeshes = [];
  function placePads() {
    for (const m of padMeshes) { scene.remove(m); m.geometry.dispose(); }
    padMeshes.length = 0; PADS.length = 0;
    const R = (mode.startR || DM.arenaR);
    for (let i = 0; i < DM.jumpPads; i++) {
      let px = 0, pz = 0;
      for (let t = 0; t < 20; t++) {   // spread out, keep off the very edge
        const a = Math.random() * Math.PI * 2, pr = (0.18 + Math.random() * 0.72) * R;
        px = Math.cos(a) * pr; pz = Math.sin(a) * pr;
        if (PADS.every(p => Math.hypot(p.x - px, p.z - pz) > DM.jumpPadR * 3)) break;
      }
      PADS.push({ x: px, z: pz });
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(DM.jumpPadR, DM.jumpPadR, 0.4, 18), new THREE.MeshBasicMaterial({ color: 0xffd54a }));
      pad.position.set(px, 0.2, pz); scene.add(pad); padMeshes.push(pad);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(DM.jumpPadR, 0.22, 6, 22), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      rim.rotation.x = Math.PI / 2; rim.position.set(px, 0.45, pz); scene.add(rim); padMeshes.push(rim);
    }
  }

  const arena = { radius: mode.startR };
  const S = { time: 0, alive: true, nearEdge: false, over: false, winner: -1, result: '', cause: '' };

  function distToSeg(px, pz, s) {
    const vx = s.x2 - s.x1, vz = s.z2 - s.z1, wx = px - s.x1, wz = pz - s.z1;
    const c2 = vx * vx + vz * vz; let t = c2 > 0 ? (wx * vx + wz * vz) / c2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (s.x1 + t * vx), pz - (s.z1 + t * vz));
  }

  // --- riders ---
  function makeRider(def, idx) {
    const bike = buildBike(def.color, { vehicle: def.vehicle }); scene.add(bike);
    bike.rotation.order = 'YXZ';   // yaw (heading) then pitch (wheelie)
    return { idx, isBot: !!def.isBot, remote: !!def.remote, startDead: !!def.dead, name: def.name, color: def.color, bike,
      trailMat: new THREE.MeshBasicMaterial({ color: def.color }), trailSegs: [], trailMeshes: [],
      x: 0, z: 0, heading: 0, pitch: 0, speed: DM.moveSpeed, alive: true, lastTX: 0, lastTZ: 0, trailInit: false,
      air: 0, y: 0, head: 0, airFlag: false,   // jump timer / height / head-look / remote airborne
      score: 0, lives: 0, respawnT: 0, invuln: 0, lastKiller: -1,  // score / lives / respawn / invincibility / killer
      item: null, boost: 0, shield: 0,         // held item key / boost timer / shield (trail-immune) timer
      tx: 0, tz: 0, th: 0 };   // remote target (network)
  }
  const riders = riderDefs.map((d, i) => makeRider(d, i));
  const cameras = riders.map(() => new THREE.PerspectiveCamera(60, 1, 0.1, 1000));

  function addSeg(r, x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.25, DM.trailH, len), r.trailMat);
    mesh.position.set((x1 + x2) / 2, DM.trailH / 2, (z1 + z2) / 2);
    mesh.rotation.y = Math.atan2(dx, dz);
    scene.add(mesh); r.trailSegs.push({ x1, z1, x2, z2 }); r.trailMeshes.push(mesh);
    if (r.trailSegs.length > DM.trailMax) { const old = r.trailMeshes.shift(); scene.remove(old); old.geometry.dispose(); r.trailSegs.shift(); }
  }
  function clearRiderTrail(r) { for (const m of r.trailMeshes) { scene.remove(m); m.geometry.dispose(); } r.trailMeshes.length = 0; r.trailSegs.length = 0; r.trailInit = false; }
  function emitTrail(r) {
    if (!r.trailInit) { r.lastTX = r.x; r.lastTZ = r.z; r.trailInit = true; return; }
    if (Math.hypot(r.x - r.lastTX, r.z - r.lastTZ) >= DM.trailGap) { addSeg(r, r.lastTX, r.lastTZ, r.x, r.z); r.lastTX = r.x; r.lastTZ = r.z; }
  }
  let paused = false;
  function setPaused(p) { paused = p; }
  function applyRemote(idx, s) {           // online: opponent state from network
    const r = riders[idx]; if (!r) return;
    if (s.x !== undefined) { r.tx = s.x; r.tz = s.z; r.th = s.h; }
    if (s.p !== undefined) r.pitch = s.p;
    if (s.y !== undefined) r.y = s.y;
    if (s.sc !== undefined) r.score = s.sc;     // score synced from owner
    r.airFlag = !!s.j;
    if (s.a === false && r.alive) { r.alive = false; r.bike.visible = false; spawnExplosion(r.x, 1.4, r.z); clearRiderTrail(r); }
    else if (s.a === true && !r.alive) { r.alive = true; r.bike.visible = true; r.x = s.x; r.z = s.z; r.trailInit = false; } // remote respawn
  }

  // bot AI: probe ahead, steer away from boundary / any trail
  function blockedAt(r, px, pz, margin) {
    if (Math.hypot(px, pz) > arena.radius - 2) return true;
    for (const rr of riders) {
      const skip = (rr === r) ? DM.graceSegs : 0;
      for (let i = 0; i < rr.trailSegs.length - skip; i++) if (distToSeg(px, pz, rr.trailSegs[i]) < DM.trailW + margin) return true;
    }
    return false;
  }
  function botSteer(r) {
    // cast rays at several angles, measure clearance, steer toward the openest (look ahead)
    const angles = [0, 0.3, -0.3, 0.6, -0.6, 1.0, -1.0, 1.5, -1.5];
    let best = -1e9, bestA = 0;
    for (const da of angles) {
      const h = r.heading + da, fx = Math.sin(h), fz = -Math.cos(h);
      let clear = 0;
      for (let step = 2; step <= 18; step += 2) {
        if (blockedAt(r, r.x + fx * step, r.z + fz * step, 0.9)) break;
        clear = step;
      }
      const score = clear - Math.abs(da) * 2.0;   // prefer straighter when clearance is similar
      if (score > best) { best = score; bestA = da; }
    }
    return Math.max(-1, Math.min(1, bestA * 2.2));
  }

  // --- death explosion (shared pool) ---
  const EXP_MAX = 80;
  const expPos = new Float32Array(EXP_MAX * 3).fill(-9999), expVel = new Float32Array(EXP_MAX * 3), expLife = new Float32Array(EXP_MAX);
  let expIdx = 0;
  const expGeo = new THREE.BufferGeometry(); expGeo.setAttribute('position', new THREE.BufferAttribute(expPos, 3));
  scene.add(new THREE.Points(expGeo, new THREE.PointsMaterial({ color: 0xff8a3a, size: 2.6, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  function spawnExplosion(x, y, z) {
    for (let k = 0; k < 50; k++) {
      const i = expIdx; expIdx = (expIdx + 1) % EXP_MAX;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), sp = 8 + Math.random() * 11;
      expPos[i*3] = x; expPos[i*3+1] = y; expPos[i*3+2] = z;
      expVel[i*3] = Math.sin(ph)*Math.cos(th)*sp; expVel[i*3+1] = Math.cos(ph)*sp; expVel[i*3+2] = Math.sin(ph)*Math.sin(th)*sp;
      expLife[i] = 0.6 + Math.random() * 0.45;
    }
    expGeo.attributes.position.needsUpdate = true;
  }
  function updateExplosion(dt) {
    for (let i = 0; i < EXP_MAX; i++) {
      if (expLife[i] <= 0) continue;
      expLife[i] -= dt; if (expLife[i] <= 0) { expPos[i*3+1] = -9999; continue; }
      expVel[i*3+1] -= 18 * dt; expPos[i*3] += expVel[i*3]*dt; expPos[i*3+1] += expVel[i*3+1]*dt; expPos[i*3+2] += expVel[i*3+2]*dt;
    }
    expGeo.attributes.position.needsUpdate = true;
  }
  function clearExplosion() { for (let i = 0; i < EXP_MAX; i++) { expLife[i] = 0; expPos[i*3+1] = -9999; } expGeo.attributes.position.needsUpdate = true; }

  // --- wheelie sparks (continuous) ---
  const SPK_MAX = 120;
  const spkPos = new Float32Array(SPK_MAX * 3).fill(-9999), spkVel = new Float32Array(SPK_MAX * 3), spkLife = new Float32Array(SPK_MAX);
  let spkIdx = 0;
  const spkGeo = new THREE.BufferGeometry(); spkGeo.setAttribute('position', new THREE.BufferAttribute(spkPos, 3));
  scene.add(new THREE.Points(spkGeo, new THREE.PointsMaterial({ color: 0xffc23a, size: 2.0, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  function spawnSpark(x, y, z) {
    const i = spkIdx; spkIdx = (spkIdx + 1) % SPK_MAX;
    spkPos[i*3] = x; spkPos[i*3+1] = y; spkPos[i*3+2] = z;
    spkVel[i*3] = (Math.random()-0.5)*5; spkVel[i*3+1] = 2+Math.random()*4; spkVel[i*3+2] = (Math.random()-0.5)*5;
    spkLife[i] = 0.25 + Math.random()*0.2;
  }
  function updateSparks(dt) { for (let i=0;i<SPK_MAX;i++){ if(spkLife[i]<=0)continue; spkLife[i]-=dt; if(spkLife[i]<=0){spkPos[i*3+1]=-9999;continue;} spkVel[i*3+1]-=24*dt; spkPos[i*3]+=spkVel[i*3]*dt; spkPos[i*3+1]+=spkVel[i*3+1]*dt; spkPos[i*3+2]+=spkVel[i*3+2]*dt; } spkGeo.attributes.position.needsUpdate=true; }

  // --- victory fireworks + camera ---
  const winCam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  let winAng = 0, fwT = 0;
  const FW_MAX = 220;
  const fwPos = new Float32Array(FW_MAX*3).fill(-9999), fwVel = new Float32Array(FW_MAX*3), fwLife = new Float32Array(FW_MAX), fwCol = new Float32Array(FW_MAX*3);
  let fwIdx = 0;
  const fwGeo = new THREE.BufferGeometry(); fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos,3)); fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol,3));
  scene.add(new THREE.Points(fwGeo, new THREE.PointsMaterial({ size: 2.6, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  const FWPAL = [[1,0.3,0.3],[1,0.8,0.2],[0.4,0.8,1],[0.6,1,0.5],[1,0.5,0.9],[1,1,1]];
  function launchFw(x,y,z){ const c=FWPAL[(Math.random()*FWPAL.length)|0], sp=9+Math.random()*6; for(let k=0;k<40;k++){ const i=fwIdx; fwIdx=(fwIdx+1)%FW_MAX; const th=Math.random()*Math.PI*2, ph=Math.acos(2*Math.random()-1), s=sp*(0.6+Math.random()*0.4); fwPos[i*3]=x;fwPos[i*3+1]=y;fwPos[i*3+2]=z; fwVel[i*3]=Math.sin(ph)*Math.cos(th)*s; fwVel[i*3+1]=Math.cos(ph)*s; fwVel[i*3+2]=Math.sin(ph)*Math.sin(th)*s; fwCol[i*3]=c[0];fwCol[i*3+1]=c[1];fwCol[i*3+2]=c[2]; fwLife[i]=1.0+Math.random()*0.6; } fwGeo.attributes.color.needsUpdate=true; }
  function updateFw(dt){ for(let i=0;i<FW_MAX;i++){ if(fwLife[i]<=0)continue; fwLife[i]-=dt; if(fwLife[i]<=0){fwPos[i*3+1]=-9999;continue;} fwVel[i*3+1]-=9*dt; fwPos[i*3]+=fwVel[i*3]*dt; fwPos[i*3+1]+=fwVel[i*3+1]*dt; fwPos[i*3+2]+=fwVel[i*3+2]*dt; } fwGeo.attributes.position.needsUpdate=true; }
  function clearFx() { winAng = 0; for(let i=0;i<FW_MAX;i++){fwLife[i]=0;fwPos[i*3+1]=-9999;} for(let i=0;i<SPK_MAX;i++){spkLife[i]=0;spkPos[i*3+1]=-9999;} fwGeo.attributes.position.needsUpdate=true; spkGeo.attributes.position.needsUpdate=true; }

  function reset() {
    arena.radius = mode.startR; ring.scale.setScalar(mode.startR / DM.arenaR);
    placePads();   // random jump-pad layout each game
    Object.assign(S, { time: 0, timeLeft: mode.timer || 0, itemT: DM.itemInterval, mode: modeKey,
      alive: true, nearEdge: false, over: false, winner: -1, result: '', cause: '' });
    const n = riders.length;
    riders.forEach((r, i) => {
      const a = n > 1 ? (i * Math.PI * 2 / n) : 0, sr = n > 1 ? Math.min(DM.startR, mode.startR * 0.6) : 0;
      r.x = Math.sin(a) * sr; r.z = Math.cos(a) * sr; r.heading = (n > 1 ? Math.PI / 2 - a : 0); // tangent (circle), single=forward
      r.alive = !r.startDead; r.speed = DM.moveSpeed; r.trailInit = false; r.bike.visible = !r.startDead;
      r.pitch = 0; r.air = 0; r.y = 0; r.head = 0; r.bike.rotation.x = 0;
      r.score = 0; r.respawnT = 0; r.invuln = 0; r.item = null; r.boost = 0; r.shield = 0;
      r.lives = mode.maxLives === 0 ? Infinity : mode.maxLives;
      clearRiderTrail(r);
    });
    clearExplosion(); clearFx();
  }
  // respawn a downed rider at a random spot away from trails (brief invincibility)
  function respawnRider(r) {
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2, rad = Math.random() * arena.radius * 0.7;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (!blockedAt(r, x, z, 3)) { r.x = x; r.z = z; r.heading = Math.atan2(-x, -z); break; }
    }
    r.alive = true; r.bike.visible = true; r.speed = DM.moveSpeed; r.pitch = 0; r.air = 0; r.y = 0;
    r.trailInit = false; r.invuln = DM.invulnTime; r.boost = 0; r.shield = 0;
  }
  // hand each living rider a rank-based item (leaders weak, trailing strong)
  function grantItems() {
    const live = riders.filter(r => r.alive && !r.remote);
    const ranked = [...live].sort((a, b) => b.score - a.score);
    const n = ranked.length;
    ranked.forEach((r, rank) => {
      if (r.item) return;            // keep an unused item
      const f = n > 1 ? rank / (n - 1) : 1;   // 0 = leader, 1 = last
      r.item = rank === 0 ? 'jump' : f >= 0.999 ? 'super' : f >= 0.5 ? 'shield' : 'boost';
    });
  }
  // use the held item (called for a rider by id)
  function useItem(idx) {
    const r = riders[idx]; if (!r || !r.alive || !r.item) return;
    if (r.item === 'jump') r.air = DM.jumpTime;
    else if (r.item === 'boost') r.boost = 2.2;
    else if (r.item === 'shield') r.shield = 3.0;
    else if (r.item === 'super') { r.shield = 4.0; r.boost = 4.0; }
    r.item = null;
  }
  // death = score -1, killer +2; respawn if the rider still has lives (mode-dependent)
  function applyDeath(r, killerIdx, cause) {
    if (!r.alive) return;
    r.score -= 1;
    if (killerIdx >= 0 && killerIdx !== r.idx && riders[killerIdx]) riders[killerIdx].score += DM.killScore;
    r.alive = false; r.bike.visible = false; r.boost = 0; r.shield = 0; r.lastKiller = killerIdx;
    r.lives = Math.max(0, r.lives - 1);              // Infinity-1 = Infinity (score mode)
    r.respawnT = r.lives > 0 ? DM.respawnDelay : 0;  // 0 lives -> eliminated (no respawn)
    spawnExplosion(r.x, 1.4, r.z); clearRiderTrail(r);
    if (r.idx === 0) S.cause = cause;
  }
  function topScorer() {
    let best = -1e9, bi = -1;
    riders.forEach(r => { if (!r.startDead && r.score > best) { best = r.score; bi = r.idx; } });
    return bi;
  }
  function positionAll(dt) {
    for (const r of riders) { r.bike.position.set(r.x, r.y || 0, r.z); r.bike.rotation.y = -r.heading; r.bike.rotation.x = r.pitch || 0; }
    riders.forEach((r, i) => {
      const fx = Math.sin(r.heading), fz = -Math.cos(r.heading);
      const rx = Math.cos(r.heading), rz = Math.sin(r.heading); // right vector for head-look pan
      const hl = (r.head || 0) * 9;
      cameras[i].position.lerp(new THREE.Vector3(r.x - fx * 13, 7.5 + (r.y || 0) * 0.4, r.z - fz * 13), Math.min(1, dt * 5));
      cameras[i].lookAt(r.x + fx * 6 + rx * hl, (r.y || 0) + 1.6, r.z + fz * 6 + rz * hl);
    });
  }
  function update(dt, inputs) {
    if (paused) { positionAll(dt); updateExplosion(dt); updateSparks(dt); updateFw(dt); return; }
    if (S.over) {   // freeze; victory camera orbits the winner + fireworks
      if (S.winner >= 0) {
        const w = riders[S.winner];
        winAng += dt * 0.4;
        winCam.position.set(w.x + Math.sin(winAng) * 14, 9, w.z + Math.cos(winAng) * 14);
        winCam.lookAt(w.x, 2, w.z);
        fwT -= dt; if (fwT <= 0) { fwT = 0.45; launchFw(w.x + (Math.random() - 0.5) * 18, 10 + Math.random() * 10, w.z + (Math.random() - 0.5) * 18); }
      }
      updateExplosion(dt); updateSparks(dt); updateFw(dt); positionAll(dt); return;
    }
    S.time += dt;
    if (mode.timer > 0) S.timeLeft = Math.max(0, S.timeLeft - dt);          // score mode counts down
    if (mode.shrink) { arena.radius = Math.max(DM.minR, arena.radius - DM.shrinkRate * dt); ring.scale.setScalar(arena.radius / DM.arenaR); }
    if (S.itemT != null) { S.itemT -= dt; if (S.itemT <= 0) { S.itemT = DM.itemInterval; grantItems(); } }
    for (const r of riders) {
      if (!r.alive) {   // downed -> count down to respawn (no elimination)
        if (!r.remote && r.respawnT > 0) { r.respawnT -= dt; if (r.respawnT <= 0) respawnRider(r); }
        continue;
      }
      if (r.remote) {   // network-driven: lerp to target, build trail, no local sim/collision
        const k = Math.min(1, dt * 12);
        r.x += (r.tx - r.x) * k; r.z += (r.tz - r.z) * k; r.heading = r.th;
        if (!r.airFlag) emitTrail(r);   // skip trail while opponent airborne
        continue;
      }
      const inp = (inputs && inputs[r.idx]) || {};
      const steer = r.isBot ? botSteer(r) : (inp.steer || 0);
      if (!r.isBot) r.head = inp.head || 0;
      let dead = false, cause = '', killer = -1;

      if (r.invuln > 0) r.invuln -= dt;
      if (r.boost > 0) r.boost -= dt;
      if (r.shield > 0) r.shield -= dt;
      const immune = r.invuln > 0 || r.shield > 0;   // trail/boundary-proof

      // bots: occasionally fire their item; chance up when trailing
      if (r.isBot && r.item && Math.random() < dt * 0.4) useItem(r.idx);

      // jump pad launch + airborne parabola (over trails, immune while flying)
      if (r.air > 0) r.air -= dt;
      else for (const p of PADS) if (Math.hypot(r.x - p.x, r.z - p.z) < DM.jumpPadR) { r.air = DM.jumpTime; break; }
      const airborne = r.air > 0;
      r.y = airborne ? Math.sin((1 - r.air / DM.jumpTime) * Math.PI) * DM.jumpHeight : 0;

      if (!r.isBot) {   // wheelie: hold to lift front wheel & boost speed; too high = flip (but safe mid-air)
        const w = inp.wheelie || 0;
        r.pitch = Math.max(0, r.pitch + (w > 0 ? CFG.pitchRiseRate * w : CFG.pitchFallRate * w) * dt);
        if (r.pitch > CFG.maxPitch && !airborne) { dead = true; cause = '윌리 전복'; }
      }
      r.speed = DM.moveSpeed * (1 + (DM.wheelieMul - 1) * Math.min(1, r.pitch / CFG.maxPitch)) * (r.boost > 0 ? 1.6 : 1);
      r.heading += steer * DM.turnRate * dt;
      const fx = Math.sin(r.heading), fz = -Math.cos(r.heading);
      r.x += fx * r.speed * dt; r.z += fz * r.speed * dt;

      const distC = Math.hypot(r.x, r.z);
      if (distC > arena.radius) {
        if (immune) { r.x *= arena.radius / distC; r.z *= arena.radius / distC; } // shielded -> bounce off the wall
        else if (!dead) { dead = true; cause = '경계 이탈'; }
      }
      if (!airborne) emitTrail(r);                 // no trail while flying (gap)
      if (!dead && !airborne && !immune) for (const rr of riders) {   // can't hit trails mid-air / while shielded
        const skip = (rr === r) ? DM.graceSegs : 0;
        for (let i = 0; i < rr.trailSegs.length - skip; i++) if (distToSeg(r.x, r.z, rr.trailSegs[i]) < DM.trailW) { dead = true; cause = (rr === r) ? '트레일 충돌' : '상대 트레일'; if (rr !== r) killer = rr.idx; break; }
        if (dead) break;
      }
      // ram kill: a shielded/super rider that bodychecks a vulnerable rider kills them
      if (!dead && immune && !airborne) for (const rr of riders) {
        if (rr === r || !rr.alive || rr.invuln > 0 || rr.shield > 0) continue;
        if (Math.hypot(r.x - rr.x, r.z - rr.z) < 2.0) applyDeath(rr, r.idx, '들이받힘');
      }
      if (dead) applyDeath(r, killer, cause);
    }

    if (!S.over) {
      if (mode.timer > 0) {                                  // score: 5-min timer -> top score wins
        if (S.timeLeft <= 0) { S.over = true; S.winner = topScorer(); }
      } else {                                               // survival / lives: last one still in wins
        const inR = riders.filter(r => !r.startDead && (r.alive || r.lives > 0));
        const field = riders.filter(r => !r.startDead).length;
        if (field > 1 && inR.length <= 1) { S.over = true; S.winner = inR.length === 1 ? inR[0].idx : -1; }
        else if (field === 1 && inR.length === 0) { S.over = true; S.winner = -1; }
      }
    }
    S.alive = riders[0].alive;
    S.nearEdge = riders[0].alive && Math.hypot(riders[0].x, riders[0].z) > arena.radius * 0.82;

    for (const r of riders) if (r.alive && r.pitch > CFG.maxPitch * 0.35) { spawnSpark(r.x + (Math.random() - 0.5) * 0.6, 0.25, r.z + (Math.random() - 0.5) * 0.6); spawnSpark(r.x + (Math.random() - 0.5) * 0.6, 0.25, r.z + (Math.random() - 0.5) * 0.6); }
    updateExplosion(dt); updateSparks(dt); updateFw(dt);
    positionAll(dt);
  }
  reset();
  return { scene, get camera() { return cameras[0]; }, cameras, winCam, update, reset, setPaused, applyRemote, useItem, S, riders };
}
let arenaWorld = null;

// two worlds; world[1] is only rendered/updated in 2P mode
const worlds = [createWorld(0xff5a3c), createWorld(0x3a8bff)]; // P1 red, P2 blue

// ---------------------------------------------------------------------------
// Low-res render targets + pixel-art composite (handles 1P and split)
// ---------------------------------------------------------------------------
function makeLowRT() {
  const rt = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
  });
  rt.depthTexture = new THREE.DepthTexture(2, 2);   // for world-distance color focus
  rt.depthTexture.minFilter = THREE.NearestFilter;
  rt.depthTexture.magFilter = THREE.NearestFilter;
  return rt;
}
const rts = [makeLowRT(), makeLowRT()];

const compositeMat = new THREE.ShaderMaterial({
  uniforms: {
    tLeft: { value: rts[0].texture }, tRight: { value: rts[1].texture },
    uSplit: { value: 0 }, uResolution: { value: new THREE.Vector2(1, 1) },
    tBayer: { value: makeBayerTexture(8) }, uBayerSize: { value: 8 },
    uColorSteps: { value: CFG.colorSteps }, uDither: { value: CFG.dither },
    uFlashL: { value: new THREE.Vector4(1, 1, 1, 0) }, uFlashR: { value: new THREE.Vector4(1, 1, 1, 0) },
    tDepthL: { value: rts[0].depthTexture }, tDepthR: { value: rts[1].depthTexture },
    uNear: { value: 0.1 }, uFar: { value: 1000 },
    uFocus: { value: 11.0 }, uBand0: { value: 6.0 }, uBand1: { value: 26.0 }, // color near player's distance
    uSpeedL: { value: 0 }, uSpeedR: { value: 0 }, uWarp: { value: CFG.speedWarp }, // high-speed screen warp
    uTintL: { value: new THREE.Color(1.0, 0.5, 0.5) }, uTintR: { value: new THREE.Color(0.55, 0.72, 1.0) }, // P1 red / P2 blue
    uTint: { value: 0 }, // tint strength (0 in 1P/online, on in local 2P)
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D tLeft; uniform sampler2D tRight; uniform sampler2D tBayer;
    uniform sampler2D tDepthL; uniform sampler2D tDepthR;
    uniform int uSplit; uniform vec2 uResolution; uniform float uBayerSize;
    uniform float uColorSteps; uniform float uDither;
    uniform vec4 uFlashL; uniform vec4 uFlashR;
    uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uBand0; uniform float uBand1;
    uniform float uSpeedL; uniform float uSpeedR; uniform float uWarp;
    uniform vec3 uTintL; uniform vec3 uTintR; uniform float uTint;
    float eyeDepth(float d){
      float ndc = d * 2.0 - 1.0;
      return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
    }
    void main(){
      bool left = (uSplit == 0) || (vUv.x < 0.5);
      vec2 suv = (uSplit == 1) ? vec2(fract(vUv.x * 2.0), vUv.y) : vUv;
      // high-speed barrel warp: distort more away from centre, scaled by speed
      float spd = left ? uSpeedL : uSpeedR;
      vec2 tc = suv - 0.5;
      suv = 0.5 + tc * (1.0 + spd * uWarp * dot(tc, tc));
      vec3 c  = left ? texture2D(tLeft, suv).rgb  : texture2D(tRight, suv).rgb;
      float d = left ? texture2D(tDepthL, suv).x  : texture2D(tDepthR, suv).x;

      // colour ONLY near the player's distance from camera (world proximity, not screen pos)
      float eyeZ = eyeDepth(d);
      float colorAmt = 1.0 - smoothstep(uBand0, uBand1, abs(eyeZ - uFocus));
      float gray = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(gray), c, colorAmt);

      // per-viewport colour filter (local 2P: red left / blue right)
      vec3 tint = left ? uTintL : uTintR;
      c *= mix(vec3(1.0), tint, uTint);

      // per-side crash/respawn flash (full-screen)
      vec4 fl = left ? uFlashL : uFlashR;
      c = mix(c, fl.rgb, clamp(fl.a, 0.0, 1.0));

      vec2 bUv = (vUv * uResolution) / uBayerSize;
      float th = texture2D(tBayer, bUv).r - 0.5;
      c += th * uDither / uColorSteps;
      c = floor(c * uColorSteps + 0.5) / uColorSteps;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
});
const quadScene = new THREE.Scene();
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMat));

function sizeTargets() {
  const W = window.innerWidth, H = window.innerHeight;
  const ps = CFG.pixelSize;
  const split = gameMode === '2P' || gameMode === 'DM2';
  const halfW = split ? W / 2 : W;
  const lowW = Math.max(2, Math.floor(halfW / ps));
  const lowH = Math.max(2, Math.floor(H / ps));
  rts[0].setSize(lowW, lowH);
  rts[1].setSize(lowW, lowH);
  const aspect = halfW / H;
  worlds[0].camera.aspect = aspect; worlds[0].camera.updateProjectionMatrix();
  worlds[1].camera.aspect = aspect; worlds[1].camera.updateProjectionMatrix();
  compositeMat.uniforms.uResolution.value.set(W, H);
  compositeMat.uniforms.uSplit.value = split ? 1 : 0;
  compositeMat.uniforms.uTint.value = split ? 0.4 : 0;
  if (arenaWorld) {
    arenaWorld.cameras.forEach(c => { c.aspect = halfW / H; c.updateProjectionMatrix(); });
    arenaWorld.winCam.aspect = halfW / H; arenaWorld.winCam.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------------------
// Input — keyboard + motion, per player
// ---------------------------------------------------------------------------
let gameMode = '1P';        // '1P' | '2P'
let inputSource = 'keyboard'; // 'keyboard' | 'motion'
const tracker = new HandTracker();
window.__moto = { CFG, STATE, worlds, get mode() { return gameMode; },
  get source() { return inputSource; }, tracker, computeControls,
  composite: compositeMat, get arena() { return arenaWorld; }, DM, createArenaWorld };

const keys = new Set();
const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
  'KeyA', 'KeyD', 'KeyW', 'KeyS']);
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (!inMenu && GAME_KEYS.has(e.code)) e.preventDefault();   // stop browser scroll/back stealing controls
  if (e.code === 'KeyR' && !inMenu && gameMode !== 'ONLINE' && gameMode !== 'DMO') {
    if (gameMode === 'DM' || gameMode === 'DM2') { if (arenaWorld) arenaWorld.reset(); }
    else { worlds.forEach(w => w.reset()); winner = null; hideFinish(); }
  }
  if (e.code === 'Digit1' && !inMenu) setGameMode('1P');
  if (e.code === 'Digit2' && !inMenu) setGameMode('2P');
  if (e.code === 'KeyM') setSource(inputSource === 'motion' ? 'keyboard' : 'motion');
  // item use (F = P1/single/online me, RightShift = P2 in local 2P). e.repeat guards auto-fire.
  if (!e.repeat && !inMenu && arenaWorld && (gameMode === 'DM' || gameMode === 'DM2' || gameMode === 'DMO')) {
    if (e.code === 'KeyF') arenaWorld.useItem(gameMode === 'DMO' ? online.mySlot : 0);
    else if (e.code === 'ShiftRight' && gameMode === 'DM2') arenaWorld.useItem(1);
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));

function kbPlayer(which) {
  // which: 0 or 1. In 1P both schemes drive player 0.
  let s = 0, w = 0;
  if (gameMode !== '2P') {             // single local player (1P / ONLINE / DM)
    if (keys.has('ArrowLeft') || keys.has('KeyA')) s -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) s += 1;
    w = (keys.has('ArrowUp') || keys.has('KeyW') || keys.has('Space')) ? CFG.kbWheelie : -1;
  } else if (which === 0) {            // P1 = WASD
    if (keys.has('KeyA')) s -= 1; if (keys.has('KeyD')) s += 1;
    w = keys.has('KeyW') ? CFG.kbWheelie : -1;
  } else {                              // P2 = arrows
    if (keys.has('ArrowLeft')) s -= 1; if (keys.has('ArrowRight')) s += 1;
    w = keys.has('ArrowUp') ? CFG.kbWheelie : -1;
  }
  return { steer: s, wheelie: w };       // wheelie: +1 raise / -1 lower
}
function dmSteer(l, r) { return (keys.has(l) ? -1 : 0) + (keys.has(r) ? 1 : 0); } // arena 2P steer

let lastMotion = null;   // last computed motion controls (for the on-screen debug readout)
function inputFor(which) {
  if (inputSource === 'motion' && tracker.ready) {
    const region = gameMode === '2P' ? (which === 0 ? 'left' : 'right') : 'all';
    const head = gameMode === '2P' ? 0 : (tracker.headYaw || 0); // head-look (single local view)
    const c = tracker.controls(region);
    if (which === 0) lastMotion = c;
    if (c.present) return { steer: c.steer, wheelie: c.wheelie, head }; // wheelie signed (+up/-down)
    return { steer: 0, wheelie: -0.5, head };   // no hands -> ease front wheel down (safety)
  }
  return kbPlayer(which);
}
function updateMotionDbg() {
  const el = document.getElementById('motionDbg');
  if (inputSource !== 'motion') { el.classList.remove('on'); return; }
  el.classList.add('on');
  const c = lastMotion;
  if (!c || !c.present) { el.innerHTML = '✋ <b class="no">손 미감지</b> — 양손을 카메라 안에'; return; }
  el.innerHTML = `✋<b class="ok">${c.hands}</b>　조향<b>${(c.steer || 0).toFixed(2)}</b>　윌리<b>${(c.wheelie || 0).toFixed(2)}</b>`;
}

function setGameMode(mode) {
  if (gameMode === mode) return;
  gameMode = mode;
  worlds.forEach(w => w.reset()); winner = null; hideFinish();
  hud.classList.toggle('split', mode === '2P');
  hud.classList.toggle('online', mode === 'ONLINE');
  hud.classList.remove('dm');
  document.getElementById('miniViews').classList.remove('on');
  camWrap.classList.toggle('split', mode === '2P');
  updateModeTag();
  sizeTargets();
}
function setSource(src) {
  if (src === 'motion' && !tracker.ready) return;
  inputSource = src;
  camWrap.classList.toggle('on', src === 'motion');
  updateModeTag();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const hud = document.getElementById('hud');
const els = {
  p1speed: document.getElementById('p1speed'), p1fill: document.getElementById('p1fill'), p1tags: document.getElementById('p1tags'),
  p2speed: document.getElementById('p2speed'), p2fill: document.getElementById('p2fill'), p2tags: document.getElementById('p2tags'),
  p1warn: document.getElementById('p1warn'), p2warn: document.getElementById('p2warn'),
  dmTime: document.getElementById('dmTime'), dmBanner: document.getElementById('dmBanner'),
  dmBannerBig: document.getElementById('dmBannerBig'), dmBannerSub: document.getElementById('dmBannerSub'),
  dmWarn: document.getElementById('dmWarn'),
  dmScore: document.getElementById('dmScore'), dmItem: document.getElementById('dmItem'), dmItemIcon: document.getElementById('dmItemIcon'),
  dmTimeLabel: document.getElementById('dmTimeLabel'),
  modeTagVal: document.getElementById('modeTagVal'),
  finishBanner: document.getElementById('finishBanner'), finishBig: document.getElementById('finishBig'), finishSub: document.getElementById('finishSub'),
};
let winner = null; // for 2P
function updateModeTag() {
  els.modeTagVal.textContent = `${gameMode} · ${inputSource.toUpperCase()}`;
}
const ITEM_ICON = { jump: '⤴️', boost: '💨', shield: '🛡️', super: '🔥' };
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function updateDmHud(aw, mySlot) {
  const S = aw.S;
  const m = DM_MODES[S.mode] || DM_MODES.score;
  // timer (score) vs survivor count (survival/lives)
  if (m.timer > 0) { els.dmTimeLabel.textContent = 'TIME'; els.dmTime.textContent = fmtTime(S.timeLeft != null ? S.timeLeft : m.timer); }
  else { els.dmTimeLabel.textContent = '생존'; els.dmTime.textContent = aw.riders.filter(r => !r.startDead && (r.alive || r.lives > 0)).length; }
  // leaderboard (real players only, sorted by score)
  const live = aw.riders.filter(r => !r.startDead);
  const ranked = [...live].sort((a, b) => b.score - a.score);
  els.dmScore.innerHTML = ranked.map((r, i) => {
    const col = '#' + (r.color >>> 0).toString(16).padStart(6, '0');
    const out = !r.alive && r.lives <= 0;
    let life = '';
    if (m.maxLives > 1) life = out ? '💀' : '♥'.repeat(Math.max(0, Math.min(3, r.lives)));
    else if (m.maxLives === 1) life = out ? '💀' : '';
    return `<div class="row${r.idx === mySlot ? ' me' : ''}${out ? ' out' : ''}"><span class="rk">${i + 1}</span>` +
      `<span class="nm" style="color:${col}">${r.idx === mySlot ? '나' : 'P' + (r.idx + 1)}</span>` +
      `<span class="sc">${r.score}</span><span class="lv">${life}</span></div>`;
  }).join('');
  // held item slot
  const me = aw.riders[mySlot];
  const has = me && me.alive && me.item;
  els.dmItem.classList.toggle('has', !!has);
  if (has) els.dmItemIcon.textContent = ITEM_ICON[me.item] || '❓';
}
function showFinish(big, sub) { els.finishBig.textContent = big; els.finishSub.textContent = sub; els.finishBanner.classList.add('show'); }
function hideFinish() { els.finishBanner.classList.remove('show'); }

function tagHtml(g) {
  const t = [];
  if (g.pitch > 0.05) t.push(`<span class="wheelie">WHEELIE ${(g.pitch / CFG.maxPitch * 100 | 0)}%</span>`);
  if (g.invincible > 0) t.push(`<span class="invinc">무적</span>`);
  if (g.state === STATE.CRASHED) t.push(`<span class="crashed">CRASH!</span>`);
  return t.join(' ');
}
function updateHud() {
  const warn = CFG.maxPitch * 0.7;   // near-flip threshold (~70%)
  const g1 = worlds[0].game;
  els.p1speed.textContent = Math.round(g1.speed * 3.0);
  els.p1fill.style.width = `${Math.min(100, g1.distance / CFG.trackLength * 100).toFixed(1)}%`;
  els.p1tags.innerHTML = tagHtml(g1);
  els.p1warn.classList.toggle('on', g1.state === STATE.RIDING && g1.pitch > warn);
  if (gameMode === '2P') {
    const g2 = worlds[1].game;
    els.p2speed.textContent = Math.round(g2.speed * 3.0);
    els.p2fill.style.width = `${Math.min(100, g2.distance / CFG.trackLength * 100).toFixed(1)}%`;
    els.p2tags.innerHTML = tagHtml(g2);
    els.p2warn.classList.toggle('on', g2.state === STATE.RIDING && g2.pitch > warn);
  } else {
    els.p2warn.classList.remove('on');
    if (gameMode === 'ONLINE') {
      const o = worlds[0].opp;
      els.p2speed.textContent = '–';
      els.p2fill.style.width = `${Math.min(100, (o.dist || 0) / CFG.trackLength * 100).toFixed(1)}%`;
      els.p2tags.innerHTML = (o.active && !o.alive) ? '<span class="crashed">CRASH!</span>' : '';
    }
  }
}

// ---------------------------------------------------------------------------
// Motion mode: start button + webcam overlay
// ---------------------------------------------------------------------------
const camWrap = document.getElementById('camWrap');
const camFeed = document.getElementById('camFeed');
const camOverlay = document.getElementById('camOverlay');
const motionStart = document.getElementById('motionStart');
const octx = camOverlay.getContext('2d');
const fcanvas = document.createElement('canvas'); // offscreen for webcam pixelation
const fctx = fcanvas.getContext('2d');

motionStart.addEventListener('click', async () => {
  motionStart.classList.add('busy'); motionStart.textContent = '⏳ 손 인식 로딩…';
  const ok = await tracker.init(camFeed);
  if (ok) { motionStart.textContent = '🖐 모션 ON (M 전환)'; motionStart.classList.remove('busy'); setSource('motion'); }
  else { motionStart.textContent = '⚠ 실패 — 재시도'; motionStart.classList.remove('busy'); console.error('[hands]', tracker.error); }
});

function drawCamOverlay() {
  const W = camOverlay.width, H = camOverlay.height;
  if (inputSource !== 'motion' || !tracker.ready) { octx.clearRect(0, 0, W, H); return; }

  // light dot effect: pixelate the webcam feed (downscale -> nearest upscale)
  if (camFeed.videoWidth) {
    const pf = 3;                                  // pixel size (small = 연하게)
    const lw = Math.max(1, Math.floor(W / pf)), lh = Math.max(1, Math.floor(H / pf));
    if (fcanvas.width !== lw) { fcanvas.width = lw; fcanvas.height = lh; }
    fctx.imageSmoothingEnabled = false;
    fctx.drawImage(camFeed, 0, 0, lw, lh);
    octx.imageSmoothingEnabled = false;
    octx.clearRect(0, 0, W, H);
    octx.drawImage(fcanvas, 0, 0, lw, lh, 0, 0, W, H);
    // faint scanlines for extra retro texture
    octx.globalAlpha = 0.1; octx.fillStyle = '#000';
    for (let y = 0; y < H; y += pf * 2) octx.fillRect(0, y, W, 1);
    octx.globalAlpha = 1;
    // local 2P: split the webcam red (P1, left) / blue (P2, right)
    if (gameMode === '2P') {
      octx.globalAlpha = 0.17;
      octx.fillStyle = '#ff4030'; octx.fillRect(0, 0, W / 2, H);
      octx.fillStyle = '#3a8bff'; octx.fillRect(W / 2, 0, W / 2, H);
      octx.globalAlpha = 1;
    }
  } else { octx.clearRect(0, 0, W, H); }

  // hand landmark dots
  if (tracker.results) for (const lm of tracker.results.landmarks) {
    const g = lm[9];
    octx.fillStyle = g.x < 0.5 ? '#5ad1ff' : '#ffd54a';
    octx.beginPath(); octx.arc(g.x * W, g.y * H, 7, 0, Math.PI * 2); octx.fill();
  }
}

// ---------------------------------------------------------------------------
// Race result (2P winner / 1P finish)
// ---------------------------------------------------------------------------
function checkResult() {
  if (gameMode === 'ONLINE') return;   // online finish handled in the loop
  if (gameMode === '1P') {
    const g = worlds[0].game;
    if (g.state === STATE.FINISHED && !els.finishBanner.classList.contains('show')) {
      showFinish('FINISH!', `기록 ${g.finishTime.toFixed(2)}초 · R 재시작`);
      worlds[0].celebrate();   // 🎆 pixel fireworks
    }
    return;
  }
  if (winner) return;
  for (let i = 0; i < 2; i++) {
    if (worlds[i].game.state === STATE.FINISHED) {
      winner = i;
      showFinish(`PLAYER ${i + 1} WIN!`, `${worlds[i].game.finishTime.toFixed(2)}초 · R 재시작`);
      worlds[i].celebrate();   // 🎆 winner gets fireworks
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Menu + online (PeerJS P2P)
// ---------------------------------------------------------------------------
const menuEl = document.getElementById('menu');
const cdEl = document.getElementById('countdown');
const $ = (id) => document.getElementById(id);
let inMenu = true;
let net = null;
const online = { active: false, meReady: false, oppReady: false, oppHere: false, raceOver: false, started: false, sendT: 0, gameType: 'race', resultShown: false,
  players: [], mySlot: 0, myReady: false, lobby: [] };   // N-player DM (star)

function showScreen(name) {
  menuEl.querySelectorAll('.m-screen').forEach(s => { s.hidden = (s.dataset.s !== name); });
  menuEl.classList.toggle('mainscreen', name === 'main');
  showHero(name === 'main');
}
function openMenu() { inMenu = true; menuEl.classList.remove('hidden'); hud.classList.remove('online', 'dm'); hud.classList.add('mhidden'); showScreen('main'); }
function closeMenu() { inMenu = false; menuEl.classList.add('hidden'); hud.classList.remove('mhidden'); showHero(false); }

// ---- main-menu hero: rotating kart + title + PLAY, all rendered INSIDE the
// pixel canvas (one shader) for a unified dot look ----
const heroCanvas = document.getElementById('heroCanvas');
const fadeOverlay = document.getElementById('fadeOverlay');
const HERO_COLORS = [0xe8842a, 0xe14b4b, 0x4b86e1, 0x49b96a, 0x9b59d0, 0xf2c53d];
let heroR, heroScene, heroCam, heroKart, heroRAF, heroOn = false, heroPlay, heroHover = false, heroFly = 0;
// build a text plane from a 2D canvas (pixelated along with everything else)
function heroText(text, { fs = 110, color = '#ffffff', shadow = null, h = 1 } = {}) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d'), pad = 24;
  const font = `800 ${fs}px Galmuri11, system-ui, sans-serif`;
  ctx.font = font; const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.width = w; c.height = fs + pad * 2;
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (shadow) { ctx.fillStyle = shadow; ctx.fillText(text, c.width / 2 + 6, c.height / 2 + 7); }
  ctx.fillStyle = color; ctx.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 1;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(h * c.width / c.height, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  m.renderOrder = 10; return m;
}
function initHero() {
  heroR = new THREE.WebGLRenderer({ canvas: heroCanvas, antialias: false, alpha: true });
  heroR.shadowMap.enabled = true; heroR.shadowMap.type = THREE.PCFSoftShadowMap;
  heroR.toneMapping = THREE.ACESFilmicToneMapping; heroR.toneMappingExposure = 1.05;
  heroScene = new THREE.Scene();
  heroCam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  heroScene.add(new THREE.HemisphereLight(0xbfe0ff, 0x202838, 1.0));
  const k = new THREE.DirectionalLight(0xffffff, 2.0); k.position.set(4, 9, 6); k.castShadow = true;
  k.shadow.mapSize.set(1024, 1024); k.shadow.bias = -0.0004; heroScene.add(k);
  heroScene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.7, 0.4, 40), new THREE.MeshStandardMaterial({ color: 0x1b3a5c, roughness: 0.7 }));
  base.position.y = 0.2; base.receiveShadow = true; heroScene.add(base);
  // in-canvas UI
  heroScene.add(at(heroText('MOTO STUNT', { fs: 130, color: '#ffffff', shadow: '#0a3050', h: 1.05 }), 0, 4.0, 2));
  heroScene.add(at(heroText('PIXEL WHEELIE · TRAIL DEATHMATCH', { fs: 56, color: '#5ad1ff', h: 0.32 }), 0, 3.25, 2));
  heroPlay = at(heroText('▶ PLAY', { fs: 120, color: '#04121c', shadow: null, h: 0.5 }), 0, -0.15, 2.2);
  heroPlay.material.depthTest = false; heroPlay.renderOrder = 11;
  // cyan plate behind the PLAY text
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.82), new THREE.MeshBasicMaterial({ color: 0x5ad1ff, depthTest: false }));
  plate.position.set(0, -0.15, 2.1); plate.renderOrder = 10;
  const plateBorder = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 1.06), new THREE.MeshBasicMaterial({ color: 0x06283a, depthTest: false }));
  plateBorder.position.set(0, -0.15, 2.05); plateBorder.renderOrder = 9;
  heroScene.add(plateBorder, plate, heroPlay);
  heroPlay.userData.plate = plate;
}
function rollHero() {
  if (heroKart) { heroScene.remove(heroKart); heroKart.traverse(o => o.geometry && o.geometry.dispose()); }
  const v = VEHICLES[Math.floor(Math.random() * VEHICLES.length)];
  const col = HERO_COLORS[Math.floor(Math.random() * HERO_COLORS.length)];
  heroKart = v.build(col); if (v.seat) mountRider(heroKart, v.seat, 0xf4ead6);
  heroKart.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  heroKart.position.set(0, 0.4, 0); heroScene.add(heroKart);
}
function resizeHero() {   // render low-res then upscale (CSS pixelated) to keep the dot look
  if (!heroR) return;
  heroR.setSize(Math.max(2, Math.floor(innerWidth / 4)), Math.max(2, Math.floor(innerHeight / 4)), false);
  heroCam.aspect = innerWidth / innerHeight; heroCam.updateProjectionMatrix();
}
const heroRay = new THREE.Raycaster(), heroM = new THREE.Vector2();
function heroPoint(e, click) {
  if (!heroOn || !heroPlay || heroFly) return;
  heroM.x = (e.clientX / innerWidth) * 2 - 1; heroM.y = -(e.clientY / innerHeight) * 2 + 1;
  heroRay.setFromCamera(heroM, heroCam);
  const hit = heroRay.intersectObject(heroPlay.userData.plate).length > 0;
  heroHover = hit; heroCanvas.style.cursor = hit ? 'pointer' : 'default';
  if (hit && click) startMainTransition();
}
heroCanvas.addEventListener('pointermove', e => heroPoint(e, false));
heroCanvas.addEventListener('click', e => heroPoint(e, true));
let transitioning = false;
function startMainTransition() {   // PLAY: kart zooms off to the right, next UI slides in from that side
  if (transitioning) return; transitioning = true; heroFly = 1;
  setTimeout(() => {
    showScreen('play');
    const ps = menuEl.querySelector('.m-screen[data-s="play"]');
    if (ps) { ps.classList.add('slidein'); setTimeout(() => ps.classList.remove('slidein'), 460); }
    transitioning = false; heroFly = 0;
  }, 360);
}
function heroLoop() {
  if (!heroOn) return;
  if (heroFly) { if (heroKart) { heroKart.rotation.y = 0; heroKart.position.x += 0.95; } }   // face +X and 쓩~ off to the right
  else if (heroKart) heroKart.rotation.y += 0.008;
  if (heroPlay) { const s = heroHover ? 1.08 : 1.0; heroPlay.scale.x += (s - heroPlay.scale.x) * 0.2; heroPlay.scale.y = heroPlay.scale.x;
    if (heroPlay.userData.plate) { heroPlay.userData.plate.scale.x += ((heroHover ? 1.06 : 1) - heroPlay.userData.plate.scale.x) * 0.2; heroPlay.userData.plate.scale.y = heroPlay.userData.plate.scale.x; } }
  heroCam.position.set(0, 3.6, 12.8); heroCam.lookAt(0, 1.3, 0);
  heroR.render(heroScene, heroCam);
  heroRAF = requestAnimationFrame(heroLoop);
}
function showHero(on) {
  if (on && !heroR) { initHero(); rollHero(); }
  else if (on && !heroOn) { heroFly = 0; rollHero(); }   // fresh kart each time the main screen opens
  heroOn = on; heroHover = false;
  if (on) { resizeHero(); cancelAnimationFrame(heroRAF); heroLoop(); }
  else if (heroRAF) cancelAnimationFrame(heroRAF);
}
addEventListener('resize', resizeHero);
function setMsg(id, t) { $(id).textContent = t || ''; }

function teardownOnline() {
  online.active = online.started = false;
  online.players = []; online.lobby = []; online.mySlot = 0; online.myReady = false;
  if (cdTimer) { clearInterval(cdTimer); cdTimer = null; cdEl.classList.remove('show'); }
  if (net) { net.close(); net = null; }
  worlds[0].clearOpponent();
}
const VKEYS = VEHICLES.map(v => v.key);
const randVehicle = () => VKEYS[Math.floor(Math.random() * VKEYS.length)];

async function startSingle() {
  teardownOnline(); closeMenu();
  const [pick] = await openKartSelect({ count: 1, title: '카트 선택 — 싱글 레이스' });
  worlds[0].setVehicle(pick); setGameMode('1P'); worlds[0].reset();
}
async function startLocal2() {
  teardownOnline(); closeMenu();
  const picks = await openKartSelect({ count: 2, title: '카트 선택 — 로컬 2인 레이스' });
  worlds[0].setVehicle(picks[0]); worlds[1].setVehicle(picks[1]);
  setGameMode('2P'); worlds.forEach(w => w.reset());
}
const DM_COLORS = [0xff5a3c, 0x3a8bff, 0x49d17a, 0xffd54a, 0xff5ad1, 0x5ad1ff, 0xff9a3a, 0xb06aff];
let dmModeKey = 'score';   // chosen deathmatch sub-mode (score | survival | lives)
// mode-select gate: pick a sub-mode, then run the chosen DM kind
function pickDmMode(kind) {
  online.gameType = 'dm'; showScreen('dmmode');
  dmModeGo = kind;
}
let dmModeGo = 'ai';
async function startDeathmatch(bots = 7) {
  teardownOnline(); closeMenu();
  const [pick] = await openKartSelect({ count: 1, title: `데스매치 — ${DM_MODES[dmModeKey].name}` });
  const defs = [{ color: pick.color, vehicle: pick.vehicle, isBot: false, name: '나' }];
  for (let i = 1; i <= Math.min(7, bots); i++) defs.push({ color: DM_COLORS[i], vehicle: randVehicle(), isBot: true, name: '봇' + i });
  arenaWorld = createArenaWorld(defs, dmModeKey);
  gameMode = 'DM';
  hud.classList.remove('split', 'online'); hud.classList.add('dm'); camWrap.classList.remove('split');
  updateModeTag(); sizeTargets();
}
async function startDeathmatchLocal2(bots = 0) {
  teardownOnline(); closeMenu();
  const picks = await openKartSelect({ count: 2, title: `데스매치 2인 — ${DM_MODES[dmModeKey].name}` });
  const defs = [
    { color: picks[0].color, vehicle: picks[0].vehicle, isBot: false, name: 'P1' },
    { color: picks[1].color, vehicle: picks[1].vehicle, isBot: false, name: 'P2' },
  ];
  for (let i = 0; i < Math.min(6, bots); i++) defs.push({ color: DM_COLORS[i + 2], vehicle: randVehicle(), isBot: true, name: '봇' + (i + 1) });
  arenaWorld = createArenaWorld(defs, dmModeKey);
  gameMode = 'DM2';
  hud.classList.remove('split', 'online'); hud.classList.add('dm'); camWrap.classList.remove('split');
  updateModeTag(); sizeTargets();
}

function bindNet() {
  net.on('peerJoined', (id) => {
        if (online.gameType === 'dm') { if (net.isHost) dmHostAssign(id); }
        else { online.oppHere = true; lobbyUpdate(); setMsg('lobbyMsg', '상대 입장! 둘 다 준비하면 시작'); }
      })
     .on('peerLeft', (id) => {
        if (online.gameType === 'dm') {
          if (net.isHost) dmHostRemove(id);
          else if (online.started) endOnline('호스트 연결 끊김'); else setMsg('lobbyMsg', '호스트 연결 끊김');
        } else {
          online.oppHere = false; online.oppReady = false; lobbyUpdate();
          if (online.started) endOnline('상대가 나갔습니다'); else setMsg('lobbyMsg', '상대가 나갔습니다');
        }
      })
     .on('error', (e) => setMsg('onlineMsg', '오류: ' + (e && (e.message || e.type) || e)))
     .on('data', onNetData);
}
function onNetData(d, fromId) {
  if (!d || !d.t) return;
  if (online.gameType === 'dm') return dmOnData(d, fromId);
  // --- racing 1v1 ---
  if (d.t === 'ready') { online.oppReady = d.v; if (d.kart) { online.oppKart = d.kart; worlds[0].setOppVehicle(d.kart); } lobbyUpdate(); maybeStart(); }
  else if (d.t === 'start') beginCountdown(d.gt);
  else if (d.t === 'state') worlds[0].setOpponentState(d);
  else if (d.t === 'finish') { if (online.active && !online.raceOver) { online.raceOver = true; finishOnline(false); } }
  else if (d.t === 'rematch') { resetOnlineRound(); openLobby(net.code, net.isHost); }
}

// ---- N-player deathmatch (star: host relays) ----
function dmOnData(d, fromId) {
  if (net.isHost) {                                  // host receives from a guest
    if (d.t === 'ready') { const p = online.players.find(p => p.connId === fromId); if (p) { p.ready = d.v; p.kart = d.kart; } dmBroadcastLobby(); dmMaybeStart(); }
    else if (d.t === 'st') { if (arenaWorld && gameMode === 'DMO') arenaWorld.applyRemote(d.slot, d); net.relay(d, fromId); }
    else if (d.t === 'dead') { if (arenaWorld) arenaWorld.applyRemote(d.slot, { a: false }); if (d.killer === online.mySlot && arenaWorld) arenaWorld.riders[online.mySlot].score += DM.killScore; net.relay(d, fromId); }
  } else {                                           // guest receives from host
    if (d.t === 'welcome') online.mySlot = d.slot;
    else if (d.t === 'lobby') { online.lobby = d.players; dmRenderLobby(); }
    else if (d.t === 'start') dmBeginCountdown(d);
    else if (d.t === 'st') { if (arenaWorld && gameMode === 'DMO' && d.slot !== online.mySlot) arenaWorld.applyRemote(d.slot, d); }
    else if (d.t === 'dead') { if (arenaWorld && d.slot !== online.mySlot) arenaWorld.applyRemote(d.slot, { a: false }); if (d.killer === online.mySlot && arenaWorld) arenaWorld.riders[online.mySlot].score += DM.killScore; }
  }
}
function dmHostAssign(connId) {
  if (online.players.length >= 8) { net.sendTo(connId, { t: 'full' }); return; }
  const used = new Set(online.players.map(p => p.slot)); let slot = 1; while (used.has(slot)) slot++;
  online.players.push({ slot, connId, ready: false });
  net.sendTo(connId, { t: 'welcome', slot });
  dmBroadcastLobby();
}
function dmHostRemove(connId) {
  const p = online.players.find(p => p.connId === connId);
  online.players = online.players.filter(x => x.connId !== connId);
  dmBroadcastLobby();
  if (online.started && p && arenaWorld) { arenaWorld.applyRemote(p.slot, { a: false }); net.send({ t: 'dead', slot: p.slot }); }
}
function dmBroadcastLobby() {
  online.lobby = online.players.map(p => ({ slot: p.slot, ready: p.ready }));
  net.send({ t: 'lobby', players: online.lobby });   // host -> all guests
  dmRenderLobby();
}
function dmRenderLobby() {
  const list = online.lobby || [];
  const ready = list.filter(p => p.ready).length;
  $('lobbyCount').textContent = `👥 ${list.length}/8명 입장 · 준비 ${ready}/${list.length}`;
  const el = $('lobbyPlayers'); el.innerHTML = '';
  list.slice().sort((a, b) => a.slot - b.slot).forEach(p => {
    const c = document.createElement('div');
    c.className = 'pcard' + (p.ready ? ' ready' : '');
    c.style.color = '#' + DM_COLORS[p.slot % 8].toString(16).padStart(6, '0');
    c.innerHTML = (p.slot === online.mySlot ? '나' : ('P' + (p.slot + 1))) + '<span class="rdy">' + (p.ready ? '준비' : '대기') + '</span>';
    el.appendChild(c);
  });
}
function dmMaybeStart() {
  if (!net || !net.isHost || online.started) return;
  if (online.players.length >= 2 && online.players.every(p => p.ready)) {
    const slots = online.players.map(p => p.slot).sort((a, b) => a - b);
    const karts = {}; online.players.forEach(p => { if (p.kart) karts[p.slot] = p.kart; });
    net.send({ t: 'start', slots, karts, mode: dmModeKey });
    dmBeginCountdown({ slots, karts, mode: dmModeKey });
  }
}
function dmBeginCountdown(cfg) {
  if (online.started) return;
  online.started = true; online.gameType = 'dm'; online.active = true; online.raceOver = false; online.resultShown = false; closeMenu();
  const slots = cfg.slots || [0, online.mySlot];
  const karts = cfg.karts || {};
  const maxSlot = Math.max(...slots, online.mySlot);
  const defs = [];
  for (let s = 0; s <= maxSlot; s++) {
    const present = slots.includes(s);
    const k = karts[s];
    defs.push({ color: k && k.color != null ? k.color : DM_COLORS[s % 8], vehicle: k && k.vehicle,
      isBot: false, remote: s !== online.mySlot, dead: !present, name: 'P' + (s + 1) });
  }
  arenaWorld = createArenaWorld(defs, cfg.mode || dmModeKey);
  gameMode = 'DMO';
  hud.classList.remove('split', 'online'); hud.classList.add('dm'); camWrap.classList.remove('split');
  updateModeTag(); sizeTargets(); arenaWorld.setPaused(true);
  let n = 3; cdEl.classList.add('show'); cdEl.textContent = n;
  cdTimer = setInterval(() => {
    n--;
    if (n > 0) cdEl.textContent = n;
    else if (n === 0) { cdEl.textContent = 'GO!'; arenaWorld.setPaused(false); }
    else { clearInterval(cdTimer); cdTimer = null; cdEl.classList.remove('show'); }
  }, 800);
}
async function hostRoom() {
  setMsg('onlineMsg', '방 생성 중...'); net = new Net(); bindNet();
  try { const code = await net.host(); openLobby(code, true); }
  catch (e) { setMsg('onlineMsg', '방 생성 실패: ' + (e.message || e)); net = null; }
}
async function joinByCode(rawCode, gt) {
  const code = (rawCode || '').trim().toUpperCase();
  if (code.length < 4) { setMsg('onlineMsg', '코드를 입력하세요'); return; }
  if (gt) online.gameType = gt;
  setMsg('onlineMsg', '연결 중...'); net = new Net(); bindNet();
  try { await net.join(code); online.oppHere = true; openLobby(code, false); }
  catch (e) { setMsg('onlineMsg', '연결 실패: ' + (e.message || e)); net = null; }
}
function joinRoom() { joinByCode($('joinCode').value); }
function roomLink() { return location.origin + location.pathname + '?room=' + (net ? net.code : ''); }
function resetOnlineRound() { online.started = false; online.raceOver = false; online.meReady = false; online.oppReady = false; online.resultShown = false; }
function openLobby(code, isHost) {
  resetOnlineRound();
  $('lobbyCode').textContent = code; $('btnReady').textContent = '준비';
  showScreen('lobby');
  if (online.gameType === 'dm') {
    $('raceCards').style.display = 'none'; $('lobbyPlayers').style.display = 'flex';
    $('btnCopyLink').style.display = 'block'; $('lobbyCount').style.display = 'block';
    online.myReady = false;
    if (isHost) { online.mySlot = 0; online.players = [{ slot: 0, connId: null, ready: false }]; dmBroadcastLobby(); }
    else { online.lobby = []; dmRenderLobby(); }
    setMsg('lobbyMsg', isHost ? '대기실 · 링크/코드 공유, 전원 준비 시 시작 (최대 8인)' : '입장! 준비를 누르세요');
  } else {
    $('raceCards').style.display = 'flex'; $('lobbyPlayers').style.display = 'none';
    $('btnCopyLink').style.display = 'none'; $('lobbyCount').style.display = 'none';
    lobbyUpdate();
    setMsg('lobbyMsg', isHost ? '상대를 기다리는 중... 코드를 공유하세요' : '입장 완료!');
  }
}
function lobbyUpdate() {
  $('meCard').classList.toggle('ready', online.meReady);
  $('meRdy').textContent = online.meReady ? '준비 완료' : '대기 중';
  $('oppCard').classList.toggle('ready', online.oppReady);
  $('oppRdy').textContent = !online.oppHere ? '없음' : (online.oppReady ? '준비 완료' : '대기 중');
}
async function toggleReady() {
  if (online.gameType === 'dm') {
    if (!online.myReady) {  // about to ready up -> pick a kart first
      const [pick] = await openKartSelect({ count: 1, noCountdown: true, title: '카트 선택 — 온라인 데스매치' });
      online.myKart = pick;
    }
    online.myReady = !online.myReady;
    $('btnReady').textContent = online.myReady ? '준비 취소' : '준비';
    if (net.isHost) { const me = online.players.find(p => p.slot === 0); if (me) { me.ready = online.myReady; me.kart = online.myKart; } dmBroadcastLobby(); dmMaybeStart(); }
    else net.send({ t: 'ready', v: online.myReady, kart: online.myKart });
    return;
  }
  if (!online.oppHere) { setMsg('lobbyMsg', '상대가 아직 없습니다'); return; }
  if (!online.meReady) {  // about to ready up -> pick a kart first
    const [pick] = await openKartSelect({ count: 1, noCountdown: true, title: '카트 선택 — 온라인 레이스' });
    online.myKart = pick; worlds[0].setVehicle(pick);
  }
  online.meReady = !online.meReady;
  $('btnReady').textContent = online.meReady ? '준비 취소' : '준비';
  net.send({ t: 'ready', v: online.meReady, kart: online.myKart }); lobbyUpdate(); maybeStart();
}
function maybeStart() {
  if (net && net.isHost && online.meReady && online.oppReady && !online.started) { net.send({ t: 'start', gt: online.gameType }); beginCountdown(online.gameType); }
}
let cdTimer = null;
function beginCountdown(gt) {
  if (online.started) return;
  online.started = true; online.gameType = gt || online.gameType; closeMenu();
  online.active = true; online.raceOver = false; online.resultShown = false;
  const dm = online.gameType === 'dm';
  if (dm) {
    arenaWorld = createArenaWorld([
      { color: 0xff5a3c, isBot: false, name: '나' },
      { color: 0x3a8bff, isBot: false, remote: true, name: '상대' },
    ], dmModeKey);
    gameMode = 'DMO';
    hud.classList.remove('split', 'online'); hud.classList.add('dm'); camWrap.classList.remove('split');
    updateModeTag(); sizeTargets(); arenaWorld.setPaused(true);
  } else {
    setGameMode('ONLINE'); worlds[0].reset(); worlds[0].game.frozen = true;
  }
  let n = 3; cdEl.classList.add('show'); cdEl.textContent = n;
  cdTimer = setInterval(() => {
    n--;
    if (n > 0) cdEl.textContent = n;
    else if (n === 0) { cdEl.textContent = 'GO!'; if (dm) arenaWorld.setPaused(false); else { worlds[0].game.frozen = false; worlds[0].game.startTime = performance.now(); } }
    else { clearInterval(cdTimer); cdTimer = null; cdEl.classList.remove('show'); }
  }, 800);
}
function finishOnline(win) {
  online.active = false; worlds[0].game.frozen = true;
  if (win) worlds[0].celebrate();
  setTimeout(() => {
    $('resultText').textContent = win ? 'YOU WIN!' : 'YOU LOSE';
    $('resultText').className = 'm-result ' + (win ? 'win' : 'lose');
    inMenu = true; menuEl.classList.remove('hidden'); showScreen('result');
  }, win ? 1600 : 700);
}
function endOnline(msg) {
  online.active = false;
  $('resultText').textContent = msg; $('resultText').className = 'm-result';
  inMenu = true; menuEl.classList.remove('hidden'); showScreen('result');
}

// button wiring
// ---- front-end flow: PLAY -> SOLO/LOCAL/ONLINE -> setup lobby (대기실) ----
const setup = { kind: 'solo', gameType: 'dm', dmMode: 'score', bots: 3 };
$('btnPlay').onclick = () => showScreen('play');
$('btnPlayBack').onclick = () => showScreen('main');
$('btnSolo').onclick = () => openSetup('solo');
$('btnLocalPlay').onclick = () => openSetup('local');
$('btnOnlinePlay').onclick = () => openSetup('online');
$('btnSetupBack').onclick = () => showScreen('play');
function openSetup(kind) { setup.kind = kind; showScreen('setup'); renderSetup(); }
function renderSetup() {
  $('setupTitle').textContent = ({ solo: 'SOLO 대기실', local: 'LOCAL 대기실', online: 'ONLINE 대기실' })[setup.kind];
  const isDM = setup.gameType === 'dm';
  $('gtRace').classList.toggle('on', !isDM); $('gtDM').classList.toggle('on', isDM);
  $('dmModeRow').style.display = isDM ? 'flex' : 'none';
  $('smScore').classList.toggle('on', setup.dmMode === 'score');
  $('smSurvival').classList.toggle('on', setup.dmMode === 'survival');
  $('smLives').classList.toggle('on', setup.dmMode === 'lives');
  const botsAllowed = isDM && (setup.kind === 'solo' || setup.kind === 'local');
  const humans = setup.kind === 'local' ? 2 : 1, maxBots = 8 - humans;
  setup.bots = Math.max(0, Math.min(maxBots, setup.bots));
  $('botRow').style.display = botsAllowed ? 'flex' : 'none';
  $('botCount').textContent = setup.bots;
  $('setupHint').textContent = botsAllowed ? `최대 ${maxBots}` : '';
  const roster = $('setupRoster'); roster.innerHTML = '';
  const add = (label, cls) => { const d = document.createElement('div'); d.className = 'rchip ' + cls; d.textContent = label; roster.appendChild(d); };
  add('나', 'me');
  if (setup.kind === 'local') add('P2', 'me');
  if (setup.kind === 'online') add('+ 참가자', 'bot');
  if (botsAllowed) for (let i = 0; i < setup.bots; i++) add('봇' + (i + 1), 'bot');
  $('btnStartMatch').textContent = setup.kind === 'online' ? '방으로 ▶' : '시작 ▶';
}
$('gtRace').onclick = () => { setup.gameType = 'race'; renderSetup(); };
$('gtDM').onclick = () => { setup.gameType = 'dm'; renderSetup(); };
$('smScore').onclick = () => { setup.dmMode = 'score'; renderSetup(); };
$('smSurvival').onclick = () => { setup.dmMode = 'survival'; renderSetup(); };
$('smLives').onclick = () => { setup.dmMode = 'lives'; renderSetup(); };
$('botMinus').onclick = () => { setup.bots--; renderSetup(); };
$('botPlus').onclick = () => { setup.bots++; renderSetup(); };
$('btnStartMatch').onclick = () => {
  dmModeKey = setup.dmMode;
  if (setup.kind === 'online') {
    online.gameType = setup.gameType === 'dm' ? 'dm' : 'race';
    showScreen('online'); setMsg('onlineMsg', `${setup.gameType === 'dm' ? '데스매치' : '레이스'} · 방 만들기/코드 참가`);
    return;
  }
  if (setup.gameType === 'race') { if (setup.kind === 'solo') startSingle(); else startLocal2(); }
  else { if (setup.kind === 'solo') startDeathmatch(setup.bots); else startDeathmatchLocal2(setup.bots); }
};
$('btnBackMain').onclick = () => { teardownOnline(); showScreen('play'); };
// main-screen side boxes: mute toggle + controls help
window.__muted = false;
$('sideLeft').onclick = () => {
  window.__muted = !window.__muted;
  $('sideLeft').textContent = window.__muted ? '🔇' : '🔊';
  $('sideLeft').classList.toggle('muted', window.__muted);
};
$('sideRight').onclick = () => $('helpOverlay').classList.remove('hidden');
$('helpClose').onclick = () => $('helpOverlay').classList.add('hidden');
$('btnCreate').onclick = hostRoom;
$('btnJoin').onclick = joinRoom;
$('btnReady').onclick = toggleReady;
$('btnLeave').onclick = () => { teardownOnline(); showScreen('main'); };
$('btnRematch').onclick = () => { if (net) { resetOnlineRound(); net.send({ t: 'rematch' }); openLobby(net.code, net.isHost); } else openMenu(); };
$('btnToMenu').onclick = () => { teardownOnline(); openMenu(); };
$('btnCopyLink').onclick = () => {
  const url = roomLink();
  const ok = () => setMsg('lobbyMsg', '🔗 초대 링크 복사됨! 친구에게 보내세요');
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, () => setMsg('lobbyMsg', url));
  else setMsg('lobbyMsg', url);
};

// ---------------------------------------------------------------------------
// TETR.IO-style opponent mini-views (right column)
// ---------------------------------------------------------------------------
const miniEl = document.getElementById('miniViews');
const miniBoxes = [];
function getMiniBox(i) {
  if (!miniBoxes[i]) {
    const d = document.createElement('div'); d.className = 'mini';
    const l = document.createElement('div'); l.className = 'ml'; d.appendChild(l);
    const o = document.createElement('div'); o.className = 'out'; o.textContent = '리스폰…'; o.style.display = 'none'; d.appendChild(o);
    d.style.display = 'none'; miniEl.appendChild(d);
    miniBoxes[i] = { d, l, o };
  }
  return miniBoxes[i];
}
function renderMiniViews() {
  if ((gameMode !== 'DM' && gameMode !== 'DMO') || !arenaWorld || arenaWorld.S.over) {
    miniEl.classList.remove('on'); for (const b of miniBoxes) if (b) b.d.style.display = 'none'; return;
  }
  miniEl.classList.add('on');
  const W = window.innerWidth, H = window.innerHeight;
  const bw = 150, bh = 92, gap = 8, mr = 12, mt = 78;
  const me = gameMode === 'DMO' ? online.mySlot : 0;
  const opps = arenaWorld.riders.filter(r => r.idx !== me && !r.startDead);
  let shown = 0;
  for (const r of opps) {
    if (shown >= 7) break;
    const yTop = mt + shown * (bh + gap);
    if (yTop + bh > H - 16) break;
    const x = W - bw - mr;
    const box = getMiniBox(shown);
    box.d.style.cssText = `display:block; left:${x}px; top:${yTop}px; width:${bw}px; height:${bh}px; border-color:#${DM_COLORS[r.idx % 8].toString(16).padStart(6, '0')};`;
    box.l.textContent = 'P' + (r.idx + 1);
    box.d.classList.toggle('dead', !r.alive);
    box.o.style.display = r.alive ? 'none' : 'flex';
    if (!r.alive) box.o.textContent = (r.lives > 0) ? '리스폰…' : 'OUT';
    if (r.alive) {
      const yGl = H - yTop - bh, cam = arenaWorld.cameras[r.idx];
      cam.aspect = bw / bh; cam.updateProjectionMatrix();
      renderer.setViewport(x, yGl, bw, bh);
      renderer.setScissor(x, yGl, bw, bh); renderer.setScissorTest(true);
      renderer.setRenderTarget(null); renderer.clear();
      renderer.render(arenaWorld.scene, cam);
    }
    shown++;
  }
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
  for (let i = shown; i < miniBoxes.length; i++) if (miniBoxes[i]) miniBoxes[i].d.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
addEventListener('resize', sizeTargets);

const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (inputSource === 'motion' && tracker.ready) tracker.detect(performance.now());
  updateMotionDbg();

  // ---- TRAIL DEATHMATCH branch ----
  if ((gameMode === 'DM' || gameMode === 'DM2' || gameMode === 'DMO') && arenaWorld) {
    const two = gameMode === 'DM2', odm = gameMode === 'DMO';
    const mySlot = odm ? online.mySlot : 0;
    let inputs;
    if (two) inputs = [{ steer: dmSteer('KeyA', 'KeyD'), wheelie: keys.has('KeyW') ? 1 : -1 },
                       { steer: dmSteer('ArrowLeft', 'ArrowRight'), wheelie: keys.has('ArrowUp') ? 1 : -1 }];
    else if (odm) { inputs = []; inputs[mySlot] = inputFor(0); }
    else inputs = [inputFor(0)];
    arenaWorld.update(dt, inputs);
    const dst = arenaWorld.S;

    // online deathmatch networking: stream my rider, detect my death, show result
    if (odm && net && online.active) {
      const me = arenaWorld.riders[mySlot];
      online.sendT -= dt;
      if (online.sendT <= 0) { online.sendT = 0.066; net.send({ t: 'st', slot: mySlot, x: me.x, z: me.z, h: me.heading, p: me.pitch, y: me.y, j: me.air > 0 ? 1 : 0, a: me.alive, sc: me.score }); }
      // notify on each death (kill credit + remote explosion); respawn flows via 'st' a:true
      if (me.alive) online._wasAlive = true;
      else if (online._wasAlive) { online._wasAlive = false; net.send({ t: 'dead', slot: mySlot, killer: me.lastKiller }); }
      if (dst.over && !online.resultShown) {
        online.resultShown = true;
        const win = dst.winner === mySlot;
        setTimeout(() => {
          $('resultText').textContent = win ? 'YOU WIN!' : (dst.winner < 0 ? '무승부' : 'YOU LOSE');
          $('resultText').className = 'm-result ' + (win ? 'win' : 'lose');
          inMenu = true; menuEl.classList.remove('hidden'); showScreen('result');
        }, 1400);
      }
    }

    updateDmHud(arenaWorld, mySlot);
    els.dmWarn.classList.toggle('on', !two && !!dst.nearEdge);
    els.dmBanner.classList.toggle('show', dst.over);
    if (dst.over) {
      const isScore = (DM_MODES[dst.mode] || DM_MODES.score).timer > 0;
      const wScore = dst.winner >= 0 && arenaWorld.riders[dst.winner] ? arenaWorld.riders[dst.winner].score : 0;
      els.dmBannerBig.textContent = dst.winner < 0 ? '무승부' : `${dst.winner === mySlot ? '나' : 'PLAYER ' + (dst.winner + 1)} 우승!`;
      els.dmBanner.classList.toggle('win', dst.winner >= 0);
      const mine = dst.winner === mySlot;
      const detail = isScore ? `최고점 ${wScore}점` : '최후의 생존 🏁';
      els.dmBannerSub.textContent = `${mine ? '🎉 ' : ''}${detail}${odm ? '' : ' · R 재시작'}`;
    }
    // high-speed screen warp when wheelie-boosted (my rider)
    const r0 = arenaWorld.riders[mySlot];
    compositeMat.uniforms.uSpeedL.value = Math.min(1, Math.max(0, (r0.speed - DM.moveSpeed) / (DM.moveSpeed * (DM.wheelieMul - 1))));
    compositeMat.uniforms.uSpeedR.value = 0;
    compositeMat.uniforms.uFlashL.value.set(1, 1, 1, 0); compositeMat.uniforms.uFlashR.value.set(1, 1, 1, 0);
    const victory = dst.over && dst.winner >= 0;
    renderer.setScissorTest(false);
    renderer.setRenderTarget(rts[0]); renderer.clear(); renderer.render(arenaWorld.scene, victory ? arenaWorld.winCam : arenaWorld.cameras[mySlot]);
    if (two) { renderer.setRenderTarget(rts[1]); renderer.clear(); renderer.render(arenaWorld.scene, victory ? arenaWorld.winCam : arenaWorld.cameras[1]); }
    renderer.setRenderTarget(null); renderer.clear(); renderer.render(quadScene, quadCam);
    renderMiniViews();
    drawCamOverlay();
    requestAnimationFrame(loop);
    return;
  }

  const nWorlds = gameMode === '2P' ? 2 : 1;
  for (let i = 0; i < nWorlds; i++) worlds[i].update(dt, inputFor(i));

  // online: stream my state ~12Hz + detect my finish (first to finish wins)
  if (online.active && net) {
    online.sendT -= dt;
    if (online.sendT <= 0) {
      online.sendT = 0.08;
      const g = worlds[0].game;
      net.send({ t: 'state', s: g.distance, x: g.laneX, p: g.pitch, st: g.state === STATE.CRASHED ? 1 : 0 });
    }
    if (!online.raceOver && worlds[0].game.state === STATE.FINISHED) {
      online.raceOver = true; net.send({ t: 'finish' }); finishOnline(true);
    }
  }

  // push per-side flash + speed-warp factor to composite
  const f0 = worlds[0].fx;
  compositeMat.uniforms.uFlashL.value.set(f0.flashColor.r, f0.flashColor.g, f0.flashColor.b, f0.flash);
  compositeMat.uniforms.uSpeedL.value = worlds[0].game.speedFactor || 0;
  if (nWorlds > 1) {
    const f1 = worlds[1].fx;
    compositeMat.uniforms.uFlashR.value.set(f1.flashColor.r, f1.flashColor.g, f1.flashColor.b, f1.flash);
    compositeMat.uniforms.uSpeedR.value = worlds[1].game.speedFactor || 0;
  } else {
    compositeMat.uniforms.uSpeedR.value = 0;
  }

  // render each active world to its low-res RT
  renderer.setScissorTest(false);
  for (let i = 0; i < nWorlds; i++) {
    renderer.setRenderTarget(rts[i]);
    renderer.clear();
    renderer.render(worlds[i].scene, worlds[i].camera);
  }
  // composite to screen with pixel-art grade
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(quadScene, quadCam);

  drawCamOverlay();
  updateHud();
  checkResult();
  requestAnimationFrame(loop);
}

updateModeTag();
sizeTargets();
document.getElementById('loading').style.display = 'none';
openMenu();   // start at the menu (game runs behind as backdrop)
// auto-join a deathmatch room from a shared invite link (?room=CODE)
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) { online.gameType = 'dm'; showScreen('online'); setMsg('onlineMsg', '초대 링크로 입장 중...'); joinByCode(urlRoom, 'dm'); }
loop();

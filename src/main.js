// MOTO STUNT — Phase 0-3
//   Phase 0+1: setup + keyboard playable prototype
//   Phase 2:   MediaPipe hand controls + pixel-art grade
//   Phase 3:   local 2-player split-screen (independent worlds, low-res RT composite)
// SSOT: docs/GAMEPLAN.md
import * as THREE from 'three';
import { CFG, STATE, DM, DM_MODES, ITEM_ICON, HERO_COLORS, DM_COLORS } from './config.js';
import { HandTracker, computeControls } from './hands.js';
import { makeBayerTexture } from './pixelart.js';
import { Net } from './net.js';
import { VEHICLES, mountRider } from '../models/vehicles.js';
import { VMAP, DEFAULT_VEHICLE, VEH_EMOJI, vehEmoji, buildBike, vehStats } from './bike.js';
import { createArenaWorld } from './deathmatch.js';
import { buildGridFloor } from './scene.js';
import { at } from '../models/_kit.js';
import { buildItemModel, ITEM_KEYS } from '../models/items.js';
import { openKartSelect } from './kartselect.js';
import sfx from './sfx.js';
// click sound on any pixel button / segment / chip (one delegated listener)
addEventListener('click', (e) => {
  if (e.target.closest('.mbtn, .seg, .ks-chip, .ks-sw div, .side-box, .pcard, .chip, .sw')) sfx.play('ui_click');
}, true);

// vehicle/bike builders (VMAP/DEFAULT_VEHICLE/VEH_EMOJI/buildBike) now live in bike.js
// build one pixel slot card; empty slot -> dimmed 대기중
function makeSlot(opts) {
  const c = document.createElement('div');
  c.className = 'slot' + (opts.cls ? ' ' + opts.cls : '');
  if (opts.empty) {
    c.classList.add('empty');
    c.innerHTML = `<span class="s-num">${opts.num}</span><span class="s-veh">🏍️</span><span class="s-name">대기중...</span>`;
    return c;
  }
  const veh = `<span class="s-veh">${opts.vehKey ? vehEmoji(opts.vehKey) : '🛵'}</span>`;
  const sub = opts.sub ? `<span class="s-sub">${opts.sub}</span>` : '';
  const rdy = opts.rdy ? `<span class="s-rdy">${opts.rdy}</span>` : '';
  c.innerHTML = `<span class="s-num">${opts.num}</span>${veh}<span class="s-name">${opts.name}</span>${sub}${rdy}`;
  return c;
}
// build a vehicle model oriented for the game (forward = -Z) with a rider mounted
// Tuning (CFG/STATE/DM/DM_MODES/palettes) now live in config.js — see docs/ARCHITECTURE.md

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
// buildGridFloor moved to scene.js (shared with deathmatch)

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
// buildBike now lives in bike.js

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
  let st = vehStats(myChoice.vehicle);   // per-vehicle stat multipliers (see VEHICLE_DESIGN.md)
  // swap the player's bike to a chosen vehicle + color (from kart select)
  function setVehicle(choice) {
    if (choice) myChoice = { vehicle: choice.vehicle || myChoice.vehicle, color: choice.color != null ? choice.color : myChoice.color };
    st = vehStats(myChoice.vehicle); game.st = st;
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

  const game = { state: STATE.RIDING, distance: 0, laneX: 0, pitch: 0, turn: 0, speed: CFG.baseSpeed * st.speed, st,
    crashTimer: 0, invincible: 0, crashTilt: 0, startTime: performance.now(), finishTime: 0 };
  const fx = { flash: 0, flashColor: new THREE.Color(1, 1, 1), shake: 0 }; // screen effects
  const baseFov = 62;
  const history = [];           // {t, distance, laneX} samples for rewind-respawn
  let respawnDist = 0, respawnLane = 0;

  function reset() {
    Object.assign(game, { state: STATE.RIDING, distance: 0, laneX: 0, pitch: 0, speed: CFG.baseSpeed * st.speed,
      turn: 0, crashTimer: 0, invincible: 0, crashTilt: 0, startTime: performance.now(), finishTime: 0, frozen: false });
    fx.flash = 0; fx.shake = 0; camera.fov = baseFov; camera.updateProjectionMatrix();
    history.length = 0; respawnDist = 0; respawnLane = 0;
    clearFireworks(); clearOpponent();
    for (const o of obstacles) { o.userData.hit = false; o.visible = true; }
  }
  function triggerCrash() {
    if (game.state !== STATE.RIDING || game.invincible > 0) return;
    game.state = STATE.CRASHED; game.crashTimer = CFG.respawnFreeze; game.speed = 0; sfx.play('crash');
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
    game.speed = CFG.baseSpeed * st.speed; game.invincible = CFG.invincibleTime;
    game.distance = respawnDist; game.laneX = respawnLane;   // rewind to ~2s ago
    camera.position.set(game.laneX * 0.6, 4.2, -game.distance + 8); // snap camera to rewound spot
    history.length = 0;
    fx.flash = 1.0; fx.flashColor.setRGB(0.6, 0.95, 1.0); // cyan respawn flash (번쩍)
  }

  function update(dt, input) {
    if (game.state === STATE.RIDING && !game.frozen) {
      game.laneX += (input.steer || 0) * CFG.steerSpeed * st.turn * dt;
      const lim = CFG.roadWidth / 2 - 0.6;
      game.laneX = Math.max(-lim, Math.min(lim, game.laneX));

      const w = input.wheelie || 0;
      if (w > 0) game.pitch += CFG.pitchRiseRate * w * dt;
      else game.pitch += CFG.pitchFallRate * w * dt;   // w<=0 lowers front wheel (∝ |w|)
      game.pitch = Math.max(0, game.pitch);
      if (game.pitch > CFG.maxPitch * st.maxPitch) triggerCrash();

      const boost = 1 + (CFG.wheelieSpeedMul * st.wheelie - 1) * Math.min(1, game.pitch / (CFG.maxPitch * st.maxPitch));
      const target = CFG.baseSpeed * st.speed * (game.pitch > 0.05 ? boost : 1);
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
        game.state = STATE.FINISHED; sfx.play('finish');
        game.finishTime = (performance.now() - game.startTime) / 1000;
      }
      // high-wheelie sparks from the rear wheel contact
      if (game.pitch > CFG.maxPitch * st.maxPitch * 0.6) {
        const n = 1 + Math.floor((game.pitch / (CFG.maxPitch * st.maxPitch)) * 2);
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
    const spF = Math.min(1, Math.max(0, (game.speed - CFG.baseSpeed * st.speed) / (CFG.baseSpeed * st.speed * (CFG.wheelieSpeedMul * st.wheelie - 1))));
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
// createArenaWorld now lives in deathmatch.js (DM world factory)
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

// Responsive pixel grid: derive an INTEGER divisor from the window so the dot-row count
// (lowH) stays ~constant (CFG.targetH) instead of collapsing on small windows.
function computePixelGrid(contentW, contentH) {
  const ps = Math.max(CFG.dotMin, Math.min(CFG.dotMax, Math.round(contentH / CFG.targetH)));
  return { ps, lowW: Math.max(2, Math.round(contentW / ps)), lowH: Math.max(2, Math.round(contentH / ps)) };
}
// Hold horizontal FOV constant below aspectRef (narrow/portrait) so fixed-width in-canvas UI
// never clips; wide aspects keep the base vertical FOV unchanged.
function fovForAspect(baseFov, aspect) {
  if (aspect >= CFG.aspectRef) return baseFov;
  const hFovRef = 2 * Math.atan(Math.tan(baseFov * Math.PI / 360) * CFG.aspectRef);
  return 2 * Math.atan(Math.tan(hFovRef / 2) / aspect) * 180 / Math.PI;
}
function sizeTargets() {
  const W = window.innerWidth, H = window.innerHeight;
  const split = gameMode === '2P' || gameMode === 'DM2';
  const halfW = split ? W / 2 : W;
  const grid = computePixelGrid(halfW, H);
  rts[0].setSize(grid.lowW, grid.lowH);
  rts[1].setSize(grid.lowW, grid.lowH);
  renderer.setSize(W, H);                 // keep the main backbuffer + canvas matched to the window (Bayer alignment)
  const aspect = halfW / H, fMain = Math.min(fovForAspect(62, aspect), CFG.maxVFov);   // cap so split/narrow doesn't fisheye
  worlds[0].camera.fov = fMain; worlds[0].camera.aspect = aspect; worlds[0].camera.updateProjectionMatrix();
  worlds[1].camera.fov = fMain; worlds[1].camera.aspect = aspect; worlds[1].camera.updateProjectionMatrix();
  compositeMat.uniforms.uResolution.value.set(W, H);
  compositeMat.uniforms.uSplit.value = split ? 1 : 0;
  compositeMat.uniforms.uTint.value = split ? 0.4 : 0;
  if (arenaWorld) {
    const fDm = Math.min(fovForAspect(60, aspect), CFG.maxVFov);
    arenaWorld.cameras.forEach(c => { c.fov = fDm; c.aspect = aspect; c.updateProjectionMatrix(); });
    arenaWorld.winCam.fov = fDm; arenaWorld.winCam.aspect = aspect; arenaWorld.winCam.updateProjectionMatrix();
  }
  window.__grid = { ps: grid.ps, lowW: grid.lowW, lowH: grid.lowH, W, H, aspect: +aspect.toFixed(3), fMain: +fMain.toFixed(1) };
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
    if (e.code === 'KeyF') { const i = gameMode === 'DMO' ? online.mySlot : 0; const it = arenaWorld.riders[i] && arenaWorld.riders[i].item; arenaWorld.useItem(i); if (it) sfx.play('item_' + it); }
    else if (e.code === 'ShiftRight' && gameMode === 'DM2') { const it = arenaWorld.riders[1] && arenaWorld.riders[1].item; arenaWorld.useItem(1); if (it) sfx.play('item_' + it); }
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
    if (c.present) {   // ease-curve so fine hand moves give fine control (easier to drive)
      const st = Math.sign(c.steer) * Math.pow(Math.abs(c.steer), CFG.motionSteerCurve) * CFG.motionSteer;
      const wh = c.wheelie >= 0 ? Math.pow(c.wheelie, CFG.motionWheelieCurve) * CFG.motionWheelie : c.wheelie;
      return { steer: st, wheelie: wh, head };   // wheelie signed (+up/-down)
    }
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
  dmStandings: document.getElementById('dmStandings'), dmStandingsRows: document.getElementById('dmStandingsRows'),
  dmSpectate: document.getElementById('dmSpectate'),
  dmStandingsHint: document.getElementById('dmStandingsHint'),
  modeTagVal: document.getElementById('modeTagVal'),
  finishBanner: document.getElementById('finishBanner'), finishBig: document.getElementById('finishBig'), finishSub: document.getElementById('finishSub'),
  hud: document.getElementById('hud'),
};
let winner = null; // for 2P
function updateModeTag() {
  els.modeTagVal.textContent = `${gameMode} · ${inputSource.toUpperCase()}`;
}
// 3D item models pre-rendered to data-URLs — used as HUD icons + the slot-machine reel.
// Rendered with the MAIN renderer into an offscreen RT (reliable; a separate
// WebGL context was flaky at startup) then read back to a 2D canvas.
const ITEM_IMG = {};
function renderItemIcons() {
  try {
    if (!renderer) return;
    const S = 132;
    const rt = new THREE.WebGLRenderTarget(S, S);
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xffffff, 0x3a4252, 1.2));
    const k = new THREE.DirectionalLight(0xffffff, 1.8); k.position.set(2, 4, 5); sc.add(k);
    const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100); cam.position.set(0.7, 0.5, 3.1); cam.lookAt(0, 0, 0);
    const buf = new Uint8Array(S * S * 4);
    const cnv = document.createElement('canvas'); cnv.width = S; cnv.height = S;
    const ctx = cnv.getContext('2d'); const img = ctx.createImageData(S, S);
    const prevRT = renderer.getRenderTarget();
    for (const key of ITEM_KEYS) {
      const m = buildItemModel(key); sc.add(m);
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(sc, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {   // flip Y (GL origin = bottom-left)
        const si = ((S - 1 - y) * S + x) * 4, di = (y * S + x) * 4;
        img.data[di] = buf[si]; img.data[di + 1] = buf[si + 1]; img.data[di + 2] = buf[si + 2]; img.data[di + 3] = buf[si + 3];
      }
      ctx.putImageData(img, 0, 0); ITEM_IMG[key] = cnv.toDataURL('image/png');
      sc.remove(m); m.traverse(o => o.geometry && o.geometry.dispose());
    }
    renderer.setRenderTarget(prevRT); rt.dispose();
  } catch (e) { /* fall back to emoji icons */ }
}
renderItemIcons();
let itemRolling = false, lastLocalItem = null;
function setItemIcon(key) {
  if (key && !ITEM_IMG[key] && ITEM_KEYS.includes(key)) renderItemIcons();   // lazy build if the eager render missed
  if (key && ITEM_IMG[key]) els.dmItemIcon.innerHTML = `<img class="item-img" src="${ITEM_IMG[key]}" alt="">`;
  else els.dmItemIcon.textContent = key ? (ITEM_ICON[key] || '') : '';
}
function startItemRoll(target) {   // slot-machine reel: spin (띠로로로롱) then land on the granted item
  itemRolling = true; els.dmItem.classList.add('rolling');
  let n = 0; const total = 15; let delay = 42;
  const step = () => {
    setItemIcon(ITEM_KEYS[n % ITEM_KEYS.length]); sfx.play('ui_move');
    if (++n < total) { delay += 7; setTimeout(step, delay); }       // decelerate
    else { setItemIcon(target); sfx.play('item_grant'); itemRolling = false; els.dmItem.classList.remove('rolling'); }
  };
  step();
}
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
  // held item slot — slot-machine reel when a new item is granted
  const me = aw.riders[mySlot];
  const has = me && me.alive && me.item;
  els.dmItem.classList.toggle('has', !!has);
  if (has && me.item !== lastLocalItem && !itemRolling) { lastLocalItem = me.item; startItemRoll(me.item); }
  else if (!has) { if (!itemRolling) setItemIcon(null); lastLocalItem = null; }
  else if (has && !itemRolling) setItemIcon(me.item);
}
function showDmStandings(aw, mySlot, winner, showHint) {
  const ranked = aw.riders.filter(r => !r.startDead).sort((a, b) => b.score - a.score);
  els.dmStandingsRows.innerHTML = ranked.map((r, i) => {
    const col = '#' + (r.color >>> 0).toString(16).padStart(6, '0');
    const win = r.idx === winner;
    return `<div class="srow${win ? ' win' : ''}"><span class="rk">${win ? '👑' : i + 1}</span>` +
      `<span class="nm" style="color:${col}">${r.idx === mySlot ? '나' : 'P' + (r.idx + 1)}</span>` +
      `<span class="sc">${r.score}</span></div>`;
  }).join('');
  els.dmStandingsHint.style.display = showHint ? '' : 'none';
  els.dmStandings.classList.add('show');
}
function hideDmStandings() { els.dmStandings.classList.remove('show'); }
let popTimer = 0;
function scorePop(text, kind) {   // floating +2 / -1 feedback for the local player
  const el = document.createElement('div');
  el.className = 'dm-pop ' + kind; el.textContent = text;
  el.style.top = (38 + (popTimer++ % 3) * 5) + '%';   // stagger rapid pops so they don't overlap
  els.hud.appendChild(el);
  setTimeout(() => el.remove(), 950);
}
function showFinish(big, sub) { els.finishBig.textContent = big; els.finishSub.textContent = sub; els.finishBanner.classList.add('show'); }
function hideFinish() { els.finishBanner.classList.remove('show'); }

function tagHtml(g) {
  const t = [];
  if (g.pitch > 0.05) t.push(`<span class="wheelie">WHEELIE ${(g.pitch / (CFG.maxPitch * (g.st ? g.st.maxPitch : 1)) * 100 | 0)}%</span>`);
  if (g.invincible > 0) t.push(`<span class="invinc">무적</span>`);
  if (g.state === STATE.CRASHED) t.push(`<span class="crashed">CRASH!</span>`);
  return t.join(' ');
}
function updateHud() {
  const warnOf = g => CFG.maxPitch * (g.st ? g.st.maxPitch : 1) * 0.7;   // near-flip threshold (~70% of the per-vehicle cap)
  const g1 = worlds[0].game;
  els.p1speed.textContent = Math.round(g1.speed * 3.0);
  els.p1fill.style.width = `${Math.min(100, g1.distance / CFG.trackLength * 100).toFixed(1)}%`;
  els.p1tags.innerHTML = tagHtml(g1);
  els.p1warn.classList.toggle('on', g1.state === STATE.RIDING && g1.pitch > warnOf(g1));
  if (gameMode === '2P') {
    const g2 = worlds[1].game;
    els.p2speed.textContent = Math.round(g2.speed * 3.0);
    els.p2fill.style.width = `${Math.min(100, g2.distance / CFG.trackLength * 100).toFixed(1)}%`;
    els.p2tags.innerHTML = tagHtml(g2);
    els.p2warn.classList.toggle('on', g2.state === STATE.RIDING && g2.pitch > warnOf(g2));
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
let heroR, heroScene, heroCam, heroKart, heroRAF, heroOn = false, heroPlay, heroExit, heroSettings, heroHover = false, heroHoverBtn = null, heroFly = 0, heroTremble = 0, heroSpk = null;
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
  // unified in-canvas buttons (PLAY center, EXIT left, 설정 right) — all cel-shaded
  const mkBtn = (label, x, y, w, h, fs, col, txtCol) => {
    const g = new THREE.Group(); g.position.set(x, y, 2);
    const bd = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.3, h + 0.3), new THREE.MeshBasicMaterial({ color: 0x06283a, depthTest: false })); bd.renderOrder = 9; bd.position.z = -0.15;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, depthTest: false })); pl.renderOrder = 10; pl.position.z = -0.1;
    const tx = heroText(label, { fs, color: txtCol, h: h * 0.6 }); tx.material.depthTest = false; tx.renderOrder = 11;
    g.add(bd, pl, tx); g.userData.plate = pl; g.userData.base = { x, y }; heroScene.add(g); return g;
  };
  heroPlay = mkBtn('▶ PLAY', 0, -0.35, 3.2, 0.82, 118, 0x5ad1ff, '#04121c');
  heroExit = mkBtn('EXIT', -3.9, -1.45, 1.9, 0.72, 74, 0xff6a6a, '#1a0606');
  heroSettings = mkBtn('설정', 3.9, -1.45, 1.9, 0.72, 74, 0x5ad1ff, '#04121c');
  // spark burst for the wheelie flyoff
  const HN = 80, hp = new Float32Array(HN * 3).fill(-9999), hv = new Float32Array(HN * 3), hl = new Float32Array(HN);
  const hgeo = new THREE.BufferGeometry(); hgeo.setAttribute('position', new THREE.BufferAttribute(hp, 3));
  { const p = new THREE.Points(hgeo, new THREE.PointsMaterial({ color: 0xffd84a, size: 4, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); p.frustumCulled = false; heroScene.add(p); }
  heroSpk = { hp, hv, hl, hgeo, i: 0, N: HN };
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
  const g = computePixelGrid(innerWidth, innerHeight);   // same grid as the game → consistent dot size
  heroR.setSize(g.lowW, g.lowH, false);
  const aspect = innerWidth / innerHeight;
  heroCam.fov = fovForAspect(32, aspect);
  heroCam.aspect = aspect; heroCam.updateProjectionMatrix();
  // keep EXIT/설정 in frame on narrow/portrait: pull them inward to the visible half-width if needed
  if (heroExit && heroSettings) {
    const visHalfW = (12.8 - 2) * Math.tan(heroCam.fov * Math.PI / 360) * aspect;   // world half-width at the button plane (z=2)
    const sideX = Math.max(2.2, Math.min(3.9, visHalfW - 1.15));
    heroExit.position.x = -sideX; heroExit.userData.base.x = -sideX;
    heroSettings.position.x = sideX; heroSettings.userData.base.x = sideX;
  }
}
function doExit() {
  if (!confirm('게임을 종료할까요?')) return;
  try { window.open('', '_self'); window.close(); } catch (e) {}
  document.body.innerHTML = '<div style="position:fixed;inset:0;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;background:#06080f;color:#5ad1ff;font-family:Galmuri11,monospace;font-size:22px;">또 만나요! 👋<div style="font-size:12px;color:#8aa0c0">탭을 닫아 종료하세요</div></div>';
}
const heroRay = new THREE.Raycaster(), heroM = new THREE.Vector2();
function heroPoint(e, click) {
  if (!heroOn || !heroPlay || heroFly || heroTremble > 0) return;
  heroM.x = (e.clientX / innerWidth) * 2 - 1; heroM.y = -(e.clientY / innerHeight) * 2 + 1;
  heroRay.setFromCamera(heroM, heroCam);
  let hit = null;
  for (const b of [heroPlay, heroExit, heroSettings]) if (b && heroRay.intersectObject(b.userData.plate).length) { hit = b; break; }
  heroHover = (hit === heroPlay); heroHoverBtn = hit; heroCanvas.style.cursor = hit ? 'pointer' : 'default';
  if (hit && click) {
    if (hit === heroPlay) startMainTransition();
    else if (hit === heroExit) doExit();
    else if (hit === heroSettings) { sfx.play('ui_click'); document.getElementById('soundOverlay').classList.remove('hidden'); }
  }
}
heroCanvas.addEventListener('pointermove', e => heroPoint(e, false));
heroCanvas.addEventListener('click', e => heroPoint(e, true));
let transitioning = false;
function startMainTransition() {   // PLAY: bike trembles, pops a wheelie, then zooms off; next UI slides in
  if (transitioning) return; transitioning = true; heroTremble = 0.45;
  sfx.init(); sfx.play('wheelie_boost');                       // engine rev on press
  setTimeout(() => { heroTremble = 0; heroFly = 1; sfx.play('count_go'); }, 450);   // tremble -> wheelie launch (vroom)
  setTimeout(() => {
    showScreen('play');
    const ps = menuEl.querySelector('.m-screen[data-s="play"]');
    if (ps) { ps.classList.add('slidein'); setTimeout(() => ps.classList.remove('slidein'), 460); }
    heroTremble = 0; heroFly = 0; transitioning = false;
  }, 860);
}
function heroLoop() {
  if (!heroOn) return;
  if (heroTremble > 0) {   // 부들부들 — rev/anticipation before the wheelie
    heroTremble -= 0.016;
    if (heroKart) { heroKart.rotation.y = 0; heroKart.position.set((Math.random() - 0.5) * 0.32, 0.4 + (Math.random() - 0.5) * 0.12, 0); heroKart.rotation.z = (Math.random() - 0.5) * 0.13; }
  } else if (heroFly) {   // 윌리(앞바퀴 들고) 한 상태로 오른쪽으로 쭉 쓩~
    if (heroKart) { heroKart.rotation.y = 0; heroKart.position.y = 0.4; heroKart.rotation.z = Math.min(0.9, heroKart.rotation.z + 0.09); heroKart.position.x += 1.0; }
  } else if (heroKart) heroKart.rotation.y += 0.008;   // idle showcase spin
  // sparks: spew from the rear wheel while revving (tremble) and flying off
  if (heroSpk) {
    const emit = (heroTremble > 0 ? 2 : 0) + (heroFly ? 6 : 0);
    if (emit && heroKart) for (let s = 0; s < emit; s++) {
      const i = heroSpk.i; heroSpk.i = (heroSpk.i + 1) % heroSpk.N;
      heroSpk.hp[i*3] = heroKart.position.x - 1.5; heroSpk.hp[i*3+1] = 0.45 + Math.random() * 0.5; heroSpk.hp[i*3+2] = (Math.random() - 0.5) * 0.8;
      heroSpk.hv[i*3] = -3 - Math.random() * 5; heroSpk.hv[i*3+1] = 2 + Math.random() * 3; heroSpk.hv[i*3+2] = (Math.random() - 0.5) * 3;
      heroSpk.hl[i] = 0.4 + Math.random() * 0.3;
    }
    for (let i = 0; i < heroSpk.N; i++) {
      if (heroSpk.hl[i] <= 0) continue;
      heroSpk.hl[i] -= 0.016; if (heroSpk.hl[i] <= 0) { heroSpk.hp[i*3+1] = -9999; continue; }
      heroSpk.hv[i*3+1] -= 0.18; heroSpk.hp[i*3] += heroSpk.hv[i*3]*0.05; heroSpk.hp[i*3+1] += heroSpk.hv[i*3+1]*0.05; heroSpk.hp[i*3+2] += heroSpk.hv[i*3+2]*0.05;
    }
    heroSpk.hgeo.attributes.position.needsUpdate = true;
  }
  // hover: subtle 부들부들 tremble + slight scale on whichever button is pointed
  if (!heroFly && heroTremble <= 0) for (const b of [heroPlay, heroExit, heroSettings]) {
    if (!b || !b.userData.base) continue;
    const hov = (b === heroHoverBtn), bx = b.userData.base.x, by = b.userData.base.y;
    if (hov) { b.position.set(bx + (Math.random() - 0.5) * 0.06, by + (Math.random() - 0.5) * 0.06, 2); b.rotation.z = (Math.random() - 0.5) * 0.018; }
    else { b.position.set(bx, by, 2); b.rotation.z = 0; }
    const s = hov ? 1.05 : 1.0; b.scale.x += (s - b.scale.x) * 0.25; b.scale.y = b.scale.x;
  }
  heroCam.position.set(0, 3.6, 12.8); heroCam.lookAt(0, 1.3, 0);
  heroR.render(heroScene, heroCam);
  heroRAF = requestAnimationFrame(heroLoop);
}
function showHero(on) {
  if (on && !heroR) { initHero(); rollHero(); }
  else if (on && !heroOn) { heroFly = 0; heroTremble = 0; transitioning = false; rollHero(); }   // fresh kart each time the main screen opens
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
  arenaWorld = createArenaWorld(defs, dmModeKey, scorePop);
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
  arenaWorld = createArenaWorld(defs, dmModeKey, scorePop);
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
  const bySlot = {}; list.forEach(p => { bySlot[p.slot] = p; });
  for (let s = 0; s < 8; s++) {
    const p = bySlot[s];
    if (!p) { el.appendChild(makeSlot({ num: 'P' + (s + 1), empty: true })); continue; }
    const me = s === online.mySlot;
    const card = makeSlot({
      num: 'P' + (s + 1), name: me ? '나' : ('P' + (s + 1)),
      cls: (me ? 'me' : 'bot') + (p.ready ? ' ready' : ''),
      rdy: p.ready ? '✔ READY' : '대기',
    });
    if (!me) { card.querySelector('.s-name').style.color = '#' + DM_COLORS[s % 8].toString(16).padStart(6, '0'); }
    el.appendChild(card);
  }
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
  arenaWorld = createArenaWorld(defs, cfg.mode || dmModeKey, scorePop);
  gameMode = 'DMO';
  hud.classList.remove('split', 'online'); hud.classList.add('dm'); camWrap.classList.remove('split');
  updateModeTag(); sizeTargets(); arenaWorld.setPaused(true);
  let n = 3; cdEl.classList.add('show'); cdEl.textContent = n;
  cdTimer = setInterval(() => {
    n--;
    if (n > 0) { cdEl.textContent = n; sfx.play('count_beep'); }
    else if (n === 0) { cdEl.textContent = 'GO!'; sfx.play('count_go'); arenaWorld.setPaused(false); }
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
    $('raceCards').style.display = 'none'; $('lobbyPlayers').style.display = 'grid';
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
    ], dmModeKey, scorePop);
    gameMode = 'DMO';
    hud.classList.remove('split', 'online'); hud.classList.add('dm'); camWrap.classList.remove('split');
    updateModeTag(); sizeTargets(); arenaWorld.setPaused(true);
  } else {
    setGameMode('ONLINE'); worlds[0].reset(); worlds[0].game.frozen = true;
  }
  let n = 3; cdEl.classList.add('show'); cdEl.textContent = n;
  cdTimer = setInterval(() => {
    n--;
    if (n > 0) { cdEl.textContent = n; sfx.play('count_beep'); }
    else if (n === 0) { cdEl.textContent = 'GO!'; sfx.play('count_go'); if (dm) arenaWorld.setPaused(false); else { worlds[0].game.frozen = false; worlds[0].game.startTime = performance.now(); } }
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
  // build slot list: me (+ P2 local) + bots, padded to 8 with empty 대기중 cards
  const slots = [{ name: '나', cls: 'me' }];
  if (setup.kind === 'local') slots.push({ name: 'P2', cls: 'me' });
  if (setup.kind === 'online') slots.push({ name: '참가자', cls: 'bot', sub: '코드 공유' });
  if (botsAllowed) for (let i = 0; i < setup.bots; i++) slots.push({ name: '봇' + (i + 1), cls: 'bot' });
  for (let i = 0; i < 8; i++) {
    const s = slots[i];
    roster.appendChild(s ? makeSlot({ num: 'P' + (i + 1), name: s.name, cls: s.cls, sub: s.sub }) : makeSlot({ num: 'P' + (i + 1), empty: true }));
  }
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
// main-screen side boxes: sound settings (volume + mute), persisted to localStorage
window.__muted = false;
function saveSettings() { try { localStorage.setItem('moto.snd', JSON.stringify({ vol: +$('volSlider').value, muted: window.__muted })); } catch (e) {} }
function applyMuteUi() {
  $('muteBtn').textContent = window.__muted ? '🔇 음소거됨 — 해제' : '음소거';
  $('sideLeft').textContent = window.__muted ? '🔇' : '🔊';
  $('sideLeft').classList.toggle('muted', window.__muted);
}
(function loadSettings() {
  let v = Math.round(sfx.getVolume() * 100);   // default = sfx master volume
  try {
    const s = JSON.parse(localStorage.getItem('moto.snd') || '{}');
    if (typeof s.vol === 'number') v = s.vol;
    if (s.muted) window.__muted = true;
  } catch (e) {}
  $('volSlider').value = v; $('volVal').textContent = v; sfx.setVolume(v / 100);
  applyMuteUi();
})();
$('sideLeft').onclick = () => $('soundOverlay').classList.remove('hidden');
$('soundClose').onclick = () => $('soundOverlay').classList.add('hidden');
$('volSlider').oninput = (e) => { const v = +e.target.value; $('volVal').textContent = v; sfx.setVolume(v / 100); if (!window.__muted) sfx.play('ui_move'); saveSettings(); };
$('muteBtn').onclick = () => { window.__muted = !window.__muted; applyMuteUi(); saveSettings(); };
$('btnExit').onclick = () => {
  if (!confirm('게임을 종료할까요?')) return;
  try { window.open('', '_self'); window.close(); } catch (e) {}
  document.body.innerHTML = '<div style="position:fixed;inset:0;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;background:#06080f;color:#5ad1ff;font-family:Galmuri11,monospace;font-size:22px;">또 만나요! 👋<div style="font-size:12px;color:#8aa0c0">탭을 닫아 종료하세요</div></div>';
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
      cam.fov = 60; cam.aspect = bw / bh; cam.updateProjectionMatrix();   // fixed mini FOV (not the widened gameplay FOV)
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
let engineOn = false;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (inputSource === 'motion' && tracker.ready) tracker.detect(performance.now());
  updateMotionDbg();

  // continuous engine drone (부릉부릉) — only while actually racing (not in menu / kart-select)
  const racing = !inMenu && !document.getElementById('ksRoot');
  if (racing && !engineOn) { sfx.engineStart(); engineOn = true; }
  else if (!racing && engineOn) { sfx.engineStop(); engineOn = false; }

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
      showDmStandings(arenaWorld, mySlot, dst.winner, !odm);
    } else hideDmStandings();
    // high-speed screen warp when wheelie-boosted (my rider)
    const r0 = arenaWorld.riders[mySlot];
    if (engineOn) sfx.engineSet(r0.alive ? r0.speed / (DM.moveSpeed * 2.4) : 0.18);
    compositeMat.uniforms.uSpeedL.value = Math.min(1, Math.max(0, (r0.speed - DM.moveSpeed) / (DM.moveSpeed * (DM.wheelieMul - 1))));
    compositeMat.uniforms.uSpeedR.value = 0;
    compositeMat.uniforms.uFlashL.value.set(1, 1, 1, 0); compositeMat.uniforms.uFlashR.value.set(1, 1, 1, 0);
    const victory = dst.over && dst.winner >= 0;
    // spectate: eliminated (no lives left) -> follow a living rider instead of staring at your wreck
    let viewCam = arenaWorld.cameras[mySlot];
    const eliminated = r0 && !r0.alive && r0.lives <= 0 && !r0.startDead && (r0.respawnT || 0) <= 0;
    if (eliminated && !victory) {
      const spec = arenaWorld.riders.find(r => r.alive && !r.startDead && r.idx !== mySlot);
      if (spec) {   // restore full-screen projection (renderMiniViews leaves opponent cams at the mini fov/aspect)
        viewCam = arenaWorld.cameras[spec.idx];
        const a = innerWidth / innerHeight;
        viewCam.fov = Math.min(fovForAspect(60, a), CFG.maxVFov); viewCam.aspect = a; viewCam.updateProjectionMatrix();
      }
      els.dmSpectate.textContent = spec ? '💀 관전 중 · P' + (spec.idx + 1) : '💀 탈락';
      els.dmSpectate.classList.add('on');
    } else els.dmSpectate.classList.remove('on');
    renderer.setScissorTest(false);
    renderer.setRenderTarget(rts[0]); renderer.clear(); renderer.render(arenaWorld.scene, victory ? arenaWorld.winCam : viewCam);
    if (two) { renderer.setRenderTarget(rts[1]); renderer.clear(); renderer.render(arenaWorld.scene, victory ? arenaWorld.winCam : arenaWorld.cameras[1]); }
    renderer.setRenderTarget(null); renderer.clear(); renderer.render(quadScene, quadCam);
    renderMiniViews();
    drawCamOverlay();
    requestAnimationFrame(loop);
    return;
  }

  const nWorlds = gameMode === '2P' ? 2 : 1;
  for (let i = 0; i < nWorlds; i++) worlds[i].update(dt, inputFor(i));
  if (engineOn) { const g0 = worlds[0].game; sfx.engineSet((g0.speed || 0) / 35 + (g0.speedFactor || 0) * 0.3); }

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

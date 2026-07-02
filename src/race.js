// MOTO STUNT — FINAL RACE world factory (createRaceArena).
// The multi-racer climax of 레전드 정규전 (Legend Ranked): a long straight sprint,
// one human (idx 0) + AI pack, chase cam per racer, finish-order scoring.
// Mirrors createWorld's racing feel (lane steer + wheelie boost + overflip crash)
// and createArenaWorld's SHAPE (riderDefs, cameras[], winCam, S, update, reset).
// Deps: THREE, config, bike, scene. No DOM. GPU-lean (controller disposes the scene).
import * as THREE from 'three';
import { CFG } from './config.js';
import { buildBike, vehStats } from './bike.js';
import { buildGridFloor } from './scene.js';

// resolved 레전드 증강 mods; missing -> identity (read defensively w/ ||1 too)
const NO_AUG = { speedMul: 1, turnMul: 1, wheelieMul: 1, maxPitchMul: 1 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createRaceArena(riderDefs, opts = {}) {
  const trackLength = opts.trackLength || 3600;
  const laneWidth = opts.laneWidth || CFG.roadWidth;
  const timeCap = opts.timeCap || 90;               // force-finish stragglers after this
  const lim = laneWidth / 2 - 0.6;                  // lane clamp (matches createWorld)

  // --- scene + lights (racing palette, like createWorld) ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a14);
  scene.fog = new THREE.Fog(0x0a0a14, 70, 320);
  scene.add(new THREE.HemisphereLight(0x88bbff, 0x222233, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(6, 12, 4); scene.add(sun);
  const floor = buildGridFloor(); scene.add(floor);   // shared neon grid (spans -trackLength area)

  // --- the straight road running down -Z, with cyan edge bars + a gold FINISH gate ---
  const road = new THREE.Mesh(new THREE.PlaneGeometry(laneWidth, trackLength),
    new THREE.MeshStandardMaterial({ color: 0x141824, roughness: 0.92 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -trackLength / 2); scene.add(road);
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x5ad1ff });
  for (const s of [1, -1]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, trackLength), edgeMat);
    bar.position.set(s * (laneWidth / 2), 0.25, -trackLength / 2); scene.add(bar);
  }
  // start line
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(laneWidth, 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
  startLine.rotation.x = -Math.PI / 2; startLine.position.set(0, 0.03, -1); scene.add(startLine);
  // gold finish gate + checker strip at z = -trackLength
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0x6b5800, emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.4 });
  const gz = -trackLength;
  for (const s of [1, -1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7, 0.8), goldMat); post.position.set(s * (laneWidth / 2 + 0.6), 3.5, gz); scene.add(post); }
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(laneWidth + 3, 1.0, 0.8), goldMat); topBar.position.set(0, 7, gz); scene.add(topBar);
  const checker = new THREE.Mesh(new THREE.PlaneGeometry(laneWidth, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  checker.rotation.x = -Math.PI / 2; checker.position.set(0, 0.04, gz + 1.5); scene.add(checker);

  // --- racers ---
  const n = riderDefs.length;
  function startLane(i) { return n > 1 ? (i / (n - 1) - 0.5) * (laneWidth - 2) : 0; }
  function makeRacer(def, idx) {
    const st = vehStats(def.vehicle);
    const aug = def.aug || NO_AUG;
    const bike = buildBike(def.color, { vehicle: def.vehicle }); scene.add(bike);
    bike.rotation.order = 'YXZ';
    const base = startLane(idx);
    return {
      idx, name: def.name, isBot: !!def.isBot, color: def.color, bike, st, aug,
      baseLane: base, varf: 0.97 + ((idx * 0.37) % 1) * 0.09,   // deterministic per-racer speed bias
      dist: 0, lane: base, speed: CFG.baseSpeed * st.speed, pitch: 0, y: 0, crashT: 0,
      finished: false, finishT: 0, place: 0,
    };
  }
  const racers = riderDefs.map(makeRacer);
  const cameras = racers.map(() => new THREE.PerspectiveCamera(62, 1, 0.1, 1000));
  const winCam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  let winAng = 0;

  const S = { time: 0, over: false, finishOrder: [], winner: -1 };

  // --- per-frame steppers ---
  // local racer (idx 0): lane steer + wheelie pitch/boost + overflip crash, mirroring createWorld
  function stepLocal(r, dt, inp) {
    if (r.crashT > 0) {   // brief crash freeze: bleed speed + drop the wheelie
      r.crashT -= dt; r.pitch = Math.max(0, r.pitch - CFG.pitchFallRate * dt);
      r.speed *= Math.max(0, 1 - dt * 3); r.dist += r.speed * dt; return;
    }
    r.lane = clamp(r.lane + (inp.steer || 0) * CFG.steerSpeed * r.st.turn * (r.aug.turnMul || 1) * dt, -lim, lim);
    const w = inp.wheelie || 0;
    r.pitch = Math.max(0, r.pitch + (w > 0 ? CFG.pitchRiseRate * w : CFG.pitchFallRate * w) * dt);
    const maxP = CFG.maxPitch * r.st.maxPitch * (r.aug.maxPitchMul || 1);
    if (r.pitch > maxP) { r.crashT = CFG.respawnFreeze; r.pitch = maxP; r.speed = 0; return; }  // 윌리 전복
    const boost = 1 + (CFG.wheelieSpeedMul * r.st.wheelie * (r.aug.wheelieMul || 1) - 1) * Math.min(1, r.pitch / maxP);
    const target = CFG.baseSpeed * r.st.speed * (r.aug.speedMul || 1) * (r.pitch > 0.05 ? boost : 1);
    r.speed += (target - r.speed) * Math.min(1, dt * CFG.wheelieAccel);
    r.dist += r.speed * dt;
  }
  // AI racer: target speed from vehicle+aug, per-racer variance + light rubber-banding (trailing = faster),
  // gentle sine weave + a cosmetic wheelie bob. No collision. dist += speed*dt.
  function stepBot(r, dt, lead) {
    const gap = lead - r.dist;
    const rubber = 1 + Math.min(0.16, gap * 0.0016);              // catch-up for trailers
    const ease = r.dist >= lead - 0.01 ? 0.97 : 1;               // leader eases so the pack stays tight
    const target = CFG.baseSpeed * r.st.speed * (r.aug.speedMul || 1) * r.varf * rubber * ease;
    r.speed += (target - r.speed) * Math.min(1, dt * 2.5);
    r.dist += r.speed * dt;
    r.pitch = Math.max(0, 0.22 + 0.18 * Math.sin((S.time + r.idx) * 1.4));   // idle wheelie bob
    r.lane = clamp(r.baseLane + Math.sin(S.time * 0.7 + r.idx * 1.3) * 1.5, -lim, lim);
  }

  function finishRacer(r) {
    r.finished = true; r.dist = trackLength; r.finishT = S.time;
    r.place = S.finishOrder.length + 1; S.finishOrder.push(r.idx);
  }
  // close out: append unfinished (sorted by dist desc) to finishOrder, then set winner/over
  function finalize() {
    if (S.over) return;
    racers.filter(r => !r.finished).sort((a, b) => b.dist - a.dist).forEach(r => {
      r.finished = true; r.finishT = S.time; r.place = S.finishOrder.length + 1; S.finishOrder.push(r.idx);
    });
    S.winner = S.finishOrder[0]; S.over = true; winAng = 0;
  }

  function positionAll(dt) {
    for (const r of racers) {
      r.bike.position.set(r.lane, r.y || 0, -r.dist);
      r.bike.rotation.set(r.pitch || 0, 0, 0);   // forward = -Z, pitch = wheelie
      for (const wm of r.bike.userData.wheels) wm.rotation.z -= r.speed * dt * 0.6;
    }
    racers.forEach((r, i) => {
      cameras[i].position.lerp(new THREE.Vector3(r.lane * 0.6, 6, -r.dist + 12), Math.min(1, dt * 5));
      cameras[i].lookAt(r.lane * 0.3, 1.6, -r.dist - 8);
    });
  }

  function update(dt, localInput) {
    if (S.over) {   // freeze the field; orbit the winner for results
      const w = racers[S.winner] || racers[0];
      winAng += dt * 0.4;
      winCam.position.set(w.lane + Math.sin(winAng) * 14, 9, -w.dist + Math.cos(winAng) * 14);
      winCam.lookAt(w.lane, 2, -w.dist);
      positionAll(dt); return;
    }
    S.time += dt;
    const lead = racers.reduce((m, r) => Math.max(m, r.dist), 0);
    for (const r of racers) {
      if (r.finished) continue;
      if (r.isBot) stepBot(r, dt, lead); else stepLocal(r, dt, localInput || {});
      if (!r.finished && r.dist >= trackLength) finishRacer(r);
    }
    if (racers.every(r => r.finished) || S.time > timeCap) finalize();
    positionAll(dt);
  }

  function reset() {
    S.time = 0; S.over = false; S.winner = -1; S.finishOrder.length = 0; winAng = 0;
    for (const r of racers) {
      r.dist = 0; r.lane = r.baseLane; r.speed = CFG.baseSpeed * r.st.speed;
      r.pitch = 0; r.y = 0; r.crashT = 0; r.finished = false; r.finishT = 0; r.place = 0;
    }
    positionAll(0.016);
  }

  reset();
  return { scene, racers, cameras, winCam, localSlot: 0, S, update, reset };
}

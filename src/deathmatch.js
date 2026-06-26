// MOTO STUNT — TRAIL DEATHMATCH world factory (createArenaWorld).
// The whole aerial-arena game: trail/items/bots/jump-pads/respawn. See docs/MODE_DEATHMATCH.md + ARCHITECTURE.md.
// scorePop is injected (UI decoupled). Deps: THREE, config, bike, sfx.
import * as THREE from 'three';
import { CFG, STATE, DM, DM_MODES } from './config.js';
import { buildBike } from './bike.js';
import { at } from '../models/_kit.js';
import { buildGridFloor } from './scene.js';
import sfx from './sfx.js';

export function createArenaWorld(riderDefs, modeKey = 'score', scorePop = () => {}) {
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
  function padSpot(R, exclude) {   // a random non-overlapping spot, off the very edge
    let px = 0, pz = 0;
    for (let t = 0; t < 24; t++) {
      const a = Math.random() * Math.PI * 2, pr = (0.18 + Math.random() * 0.72) * R;
      px = Math.cos(a) * pr; pz = Math.sin(a) * pr;
      if (PADS.every(p => p === exclude || Math.hypot(p.x - px, p.z - pz) > DM.jumpPadR * 3)) break;
    }
    return { x: px, z: pz };
  }
  function placePads() {
    for (const m of padMeshes) { scene.remove(m); m.geometry.dispose(); }
    padMeshes.length = 0; PADS.length = 0;
    const R = (mode.startR || DM.arenaR);
    for (let i = 0; i < DM.jumpPads; i++) {
      const s = padSpot(R, null);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(DM.jumpPadR, DM.jumpPadR, 0.4, 18), new THREE.MeshBasicMaterial({ color: 0xffd54a }));
      pad.position.set(s.x, 0.2, s.z); scene.add(pad); padMeshes.push(pad);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(DM.jumpPadR, 0.22, 6, 22), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      rim.rotation.x = Math.PI / 2; rim.position.set(s.x, 0.45, s.z); scene.add(rim); padMeshes.push(rim);
      PADS.push({ x: s.x, z: s.z, pad, rim });
    }
  }
  // a pad that gets used vanishes and pops up somewhere else
  function relocatePad(p) {
    const R = (arena.radius || mode.startR || DM.arenaR);
    const s = padSpot(R, p);
    p.x = s.x; p.z = s.z; p.pad.position.set(s.x, 0.2, s.z); p.rim.position.set(s.x, 0.45, s.z);
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
    // item VFX (children of the bike): shield bubble + boost flame, toggled in positionAll
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.9, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.34, depthWrite: false }));
    bubble.position.y = 1.1; bubble.visible = false; bike.add(bubble);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.72, 2.4, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb648, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    flame.rotation.x = Math.PI / 2; flame.position.set(0, 0.7, 2.0); flame.visible = false; bike.add(flame);  // +Z = behind (bike faces -Z)
    // gold crown for the current leader (1등), floats above the rider's head
    const crown = new THREE.Group();
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffe000, emissive: 0x6b5800, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.3 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.28, 8), goldMat); crown.add(band);
    for (let kk = 0; kk < 5; kk++) { const a = kk / 5 * Math.PI * 2; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 6), goldMat); sp.position.set(Math.cos(a) * 0.46, 0.28, Math.sin(a) * 0.46); crown.add(sp); }
    crown.position.y = 3.5; crown.visible = false; bike.add(crown);
    return { idx, isBot: !!def.isBot, remote: !!def.remote, startDead: !!def.dead, name: def.name, color: def.color, bike, bubble, flame, crown,
      trailMat: new THREE.MeshBasicMaterial({ color: def.color }), trailSegs: [], trailMeshes: [],
      x: 0, z: 0, heading: 0, pitch: 0, speed: DM.moveSpeed, alive: true, lastTX: 0, lastTZ: 0, trailInit: false,
      air: 0, y: 0, head: 0, airFlag: false,   // jump timer / height / head-look / remote airborne
      score: 0, lives: 0, respawnT: 0, invuln: 0, lastKiller: -1,  // score / lives / respawn / invincibility / killer
      kills: 0, deaths: 0,                      // for item rewards (3 kills / 2 deaths)
      item: null, boost: 0, shield: 0,         // held item key / boost timer / shield (trail-immune) timer
      tx: 0, tz: 0, th: 0 };   // remote target (network)
  }
  const riders = riderDefs.map((d, i) => makeRider(d, i));
  const cameras = riders.map(() => new THREE.PerspectiveCamera(60, 1, 0.1, 1000));

  function addSeg(r, x1, z1, x2, z2, y0 = 0) {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.25, DM.trailH, len), r.trailMat);
    mesh.position.set((x1 + x2) / 2, y0 + DM.trailH / 2, (z1 + z2) / 2);   // y0>0 = floating wall (laid mid-jump) you can pass under
    mesh.rotation.y = Math.atan2(dx, dz);
    scene.add(mesh); r.trailSegs.push({ x1, z1, x2, z2, y0 }); r.trailMeshes.push(mesh);
    if (r.trailSegs.length > DM.trailMax) { const old = r.trailMeshes.shift(); scene.remove(old); old.geometry.dispose(); r.trailSegs.shift(); }
  }
  function clearRiderTrail(r) { for (const m of r.trailMeshes) { scene.remove(m); m.geometry.dispose(); } r.trailMeshes.length = 0; r.trailSegs.length = 0; r.trailInit = false; }
  function emitTrail(r) {
    if (r.invuln > 0) { r.trailInit = false; return; }   // no tail while post-respawn invincible; resume fresh when it ends
    if (!r.trailInit) { r.lastTX = r.x; r.lastTZ = r.z; r.trailInit = true; return; }
    const d = Math.hypot(r.x - r.lastTX, r.z - r.lastTZ);
    if (d >= DM.trailGap) {
      if (d <= DM.trailGap * 4) addSeg(r, r.lastTX, r.lastTZ, r.x, r.z, r.y || 0);   // skip an over-long bridge (teleport / frame hitch / jump arc)
      r.lastTX = r.x; r.lastTZ = r.z;
    }
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
  // --- bot aggression tuning (higher = hunts harder; safety always overrides) ---
  const BOT_AGGRO = 0.7;     // 0 = passive (old behavior), 1 = relentless hunter
  // free-ahead clearance for a heading (used by both avoidance and offense)
  function clearAhead(r, h, maxStep) {
    const fx = Math.sin(h), fz = -Math.cos(h);
    let clear = 0;
    for (let step = 2; step <= maxStep; step += 2) {
      if (blockedAt(r, r.x + fx * step, r.z + fz * step, 0.9)) break;
      clear = step;
    }
    return clear;
  }
  // pick the bot's prey: nearest living opponent, with a per-bot bias toward the human (idx 0)
  function botTarget(r) {
    const huntHuman = ((r.idx * 0.37) % 1) < BOT_AGGRO;   // some bots fixate on the player
    let best = null, bestD = 1e9;
    for (const rr of riders) {
      if (rr === r || !rr.alive || rr.startDead) continue;
      let d = Math.hypot(rr.x - r.x, rr.z - r.z);
      if (huntHuman && rr.idx === 0) d *= 0.45;            // weight the player closer so we chase them
      if (d < bestD) { bestD = d; best = rr; }
    }
    return best;
  }
  function botSteer(r, dt) {
    // 1) SAFETY: cast rays, find the openest direction (avoid boundary + every trail)
    const angles = [0, 0.3, -0.3, 0.6, -0.6, 1.0, -1.0, 1.5, -1.5];
    let best = -1e9, safeA = 0, fwdClear = 0;
    for (const da of angles) {
      const clear = clearAhead(r, r.heading + da, 18);
      if (da === 0) fwdClear = clear;
      const score = clear - Math.abs(da) * 2.0;   // prefer straighter when clearance is similar
      if (score > best) { best = score; safeA = da; }
    }
    const safeSteer = Math.max(-1, Math.min(1, safeA * 2.2));

    // 2) OFFENSE: steer toward a lead/intercept point ahead of the target to cut them off
    const perBot = ((r.idx * 0.61) % 1);              // per-bot variation (lead amount, wheelie taste)
    const target = botTarget(r);
    let pursueSteer = safeSteer, wantWheelie = false;
    if (target) {
      const tdist = Math.hypot(target.x - r.x, target.z - r.z);
      const lead = (1.4 + perBot * 1.6) * BOT_AGGRO;     // how far ahead of the target we aim
      const tfx = Math.sin(target.heading), tfz = -Math.cos(target.heading);
      const aimX = target.x + tfx * target.speed * lead * 0.12;
      const aimZ = target.z + tfz * target.speed * lead * 0.12;
      const wantH = Math.atan2(aimX - r.x, -(aimZ - r.z));   // heading that points at the intercept
      let dh = ((wantH - r.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;   // signed turn, [-π,π]
      pursueSteer = Math.max(-1, Math.min(1, dh * 1.6));
      // wheelie burst to close distance when far + the lane ahead is clear (and not about to flip)
      wantWheelie = tdist > 24 && fwdClear >= 12 && r.pitch < CFG.maxPitch * 0.78;
    }

    // 3) BLEND: pursue when the road ahead is open; let avoidance take over as danger closes in
    const danger = Math.max(0, Math.min(1, (10 - fwdClear) / 10));   // 0 = clear, 1 = wall in face
    const aggro = BOT_AGGRO * (1 - danger);                          // offense fades near hazards
    let steer = safeSteer * (1 - aggro) + pursueSteer * aggro;
    if (fwdClear <= 4) steer = safeSteer;                            // imminent collision: pure escape

    // 4) WHEELIE control (bots manage their own pitch; never flip — respect maxPitch)
    const flipGuard = CFG.maxPitch * 0.82;
    if (wantWheelie && danger < 0.3) {
      r.pitch = Math.min(flipGuard, r.pitch + CFG.pitchRiseRate * 0.7 * dt);
    } else {
      r.pitch = Math.max(0, r.pitch - CFG.pitchFallRate * dt);       // settle back down when turning/avoiding
    }
    return Math.max(-1, Math.min(1, steer));
  }

  // --- death explosion (shared pool) ---
  const EXP_MAX = 80;
  const expPos = new Float32Array(EXP_MAX * 3).fill(-9999), expVel = new Float32Array(EXP_MAX * 3), expLife = new Float32Array(EXP_MAX);
  let expIdx = 0;
  const expGeo = new THREE.BufferGeometry(); expGeo.setAttribute('position', new THREE.BufferAttribute(expPos, 3));
  { const p = new THREE.Points(expGeo, new THREE.PointsMaterial({ color: 0xff8a3a, size: 2.6, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); p.frustumCulled = false; scene.add(p); }
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
  // shattered-bike debris: chunky boxes in the dead rider's color that fly out, spin, bounce, shrink
  const DEBRIS_MAX = 56, debris = [];
  for (let i = 0; i < DEBRIS_MAX; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.6 }));
    m.visible = false; m.frustumCulled = false; scene.add(m);
    debris.push({ m, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, sz: 0, life: 0 });
  }
  let debrisIdx = 0;
  function spawnDebris(x, y, z, color) {
    for (let k = 0; k < 12; k++) {
      const d = debris[debrisIdx]; debrisIdx = (debrisIdx + 1) % DEBRIS_MAX;
      const s = 0.26 + Math.random() * 0.5; d.m.scale.set(s, s * (0.55 + Math.random() * 0.7), s);
      d.m.material.color.setHex(color); d.m.position.set(x, y, z); d.m.visible = true;
      d.m.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      const th = Math.random() * Math.PI * 2, sp = 5 + Math.random() * 9;
      d.vx = Math.cos(th) * sp; d.vz = Math.sin(th) * sp; d.vy = 4 + Math.random() * 8;
      d.sx = (Math.random() - 0.5) * 16; d.sy = (Math.random() - 0.5) * 16; d.sz = (Math.random() - 0.5) * 16;
      d.life = 1.1 + Math.random() * 0.6;
    }
  }
  function updateDebris(dt) {
    for (const d of debris) {
      if (d.life <= 0) continue;
      d.life -= dt; if (d.life <= 0) { d.m.visible = false; continue; }
      d.vy -= 22 * dt;
      d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt;
      if (d.m.position.y < 0.16) { d.m.position.y = 0.16; d.vy *= -0.38; d.vx *= 0.66; d.vz *= 0.66; }   // bounce on the floor
      d.m.rotation.x += d.sx * dt; d.m.rotation.y += d.sy * dt; d.m.rotation.z += d.sz * dt;
      if (d.life < 0.35) d.m.scale.multiplyScalar(0.9);   // shrink away at the end
    }
  }
  function clearDebris() { for (const d of debris) { d.life = 0; d.m.visible = false; } }

  // --- wheelie sparks (continuous) ---
  const SPK_MAX = 120;
  const spkPos = new Float32Array(SPK_MAX * 3).fill(-9999), spkVel = new Float32Array(SPK_MAX * 3), spkLife = new Float32Array(SPK_MAX);
  let spkIdx = 0;
  const spkGeo = new THREE.BufferGeometry(); spkGeo.setAttribute('position', new THREE.BufferAttribute(spkPos, 3));
  { const p = new THREE.Points(spkGeo, new THREE.PointsMaterial({ color: 0xffd84a, size: 5, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); p.frustumCulled = false; scene.add(p); }
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
  { const p = new THREE.Points(fwGeo, new THREE.PointsMaterial({ size: 2.6, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); p.frustumCulled = false; scene.add(p); }
  const FWPAL = [[1,0.3,0.3],[1,0.8,0.2],[0.4,0.8,1],[0.6,1,0.5],[1,0.5,0.9],[1,1,1]];
  function launchFw(x,y,z){ const c=FWPAL[(Math.random()*FWPAL.length)|0], sp=9+Math.random()*6; for(let k=0;k<40;k++){ const i=fwIdx; fwIdx=(fwIdx+1)%FW_MAX; const th=Math.random()*Math.PI*2, ph=Math.acos(2*Math.random()-1), s=sp*(0.6+Math.random()*0.4); fwPos[i*3]=x;fwPos[i*3+1]=y;fwPos[i*3+2]=z; fwVel[i*3]=Math.sin(ph)*Math.cos(th)*s; fwVel[i*3+1]=Math.cos(ph)*s; fwVel[i*3+2]=Math.sin(ph)*Math.sin(th)*s; fwCol[i*3]=c[0];fwCol[i*3+1]=c[1];fwCol[i*3+2]=c[2]; fwLife[i]=1.0+Math.random()*0.6; } fwGeo.attributes.color.needsUpdate=true; }
  function updateFw(dt){ for(let i=0;i<FW_MAX;i++){ if(fwLife[i]<=0)continue; fwLife[i]-=dt; if(fwLife[i]<=0){fwPos[i*3+1]=-9999;continue;} fwVel[i*3+1]-=9*dt; fwPos[i*3]+=fwVel[i*3]*dt; fwPos[i*3+1]+=fwVel[i*3+1]*dt; fwPos[i*3+2]+=fwVel[i*3+2]*dt; } fwGeo.attributes.position.needsUpdate=true; }
  function clearFx() { winAng = 0; for(let i=0;i<FW_MAX;i++){fwLife[i]=0;fwPos[i*3+1]=-9999;} for(let i=0;i<SPK_MAX;i++){spkLife[i]=0;spkPos[i*3+1]=-9999;} fwGeo.attributes.position.needsUpdate=true; spkGeo.attributes.position.needsUpdate=true; }

  function reset() {
    arena.radius = mode.startR; ring.scale.setScalar(mode.startR / DM.arenaR);
    placePads();   // random jump-pad layout each game
    Object.assign(S, { time: 0, timeLeft: mode.timer || 0, itemT: null, mode: modeKey,
      alive: true, nearEdge: false, over: false, winner: -1, result: '', cause: '' });
    const n = riders.length;
    riders.forEach((r, i) => {
      const a = n > 1 ? (i * Math.PI * 2 / n) : 0, sr = n > 1 ? Math.min(DM.startR, mode.startR * 0.6) : 0;
      r.x = Math.sin(a) * sr; r.z = Math.cos(a) * sr; r.heading = (n > 1 ? Math.PI / 2 - a : 0); // tangent (circle), single=forward
      r.alive = !r.startDead; r.speed = DM.moveSpeed; r.trailInit = false; r.bike.visible = !r.startDead;
      r.pitch = 0; r.air = 0; r.y = 0; r.head = 0; r.bike.rotation.x = 0;
      r.score = 0; r.respawnT = 0; r.invuln = 0; r.item = null; r.boost = 0; r.shield = 0;
      r.kills = 0; r.deaths = 0; r.rsX = null;
      r.lives = mode.maxLives === 0 ? Infinity : mode.maxLives;
      clearRiderTrail(r);
    });
    clearExplosion(); clearDebris(); clearFx();
  }
  // respawn a downed rider at a random spot away from trails (brief invincibility)
  function pickRespawn(r) {
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2, rad = Math.random() * arena.radius * 0.7;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (!blockedAt(r, x, z, 3)) return { x, z, h: Math.atan2(-x, -z) };
    }
    return { x: 0, z: 0, h: 0 };
  }
  function respawnRider(r) {
    if (r.rsX != null) { r.x = r.rsX; r.z = r.rsZ; r.heading = r.rsH; r.rsX = null; }   // camera already panned here
    else { const s = pickRespawn(r); r.x = s.x; r.z = s.z; r.heading = s.h; }
    r.alive = true; r.bike.visible = true; r.speed = DM.moveSpeed; r.pitch = 0; r.air = 0; r.y = 0;
    r.trailInit = false; r.invuln = DM.invulnTime; r.boost = 0; r.shield = 0;
    if (r.idx === 0) sfx.play('respawn');
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
      if (r.idx === 0) sfx.play('item_grant');
    });
  }
  // performance reward: 3 kills -> a light item, 2 deaths -> a strong (comeback) item
  function grantItem(r, kind) {
    if (!r || r.item) return;   // keep an unused item
    r.item = kind === 'death' ? (Math.random() < 0.5 ? 'shield' : 'super') : (Math.random() < 0.5 ? 'jump' : 'boost');
    if (r.idx === 0 && r.alive) sfx.play('item_grant');
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
    r.deaths++; if (r.deaths % 2 === 0) grantItem(r, 'death');   // every 2 deaths -> a comeback item
    if (killerIdx >= 0 && killerIdx !== r.idx && riders[killerIdx]) {
      const k = riders[killerIdx]; k.score += DM.killScore;
      k.kills++; if (k.kills % 3 === 0) grantItem(k, 'kill');    // every 3 kills -> a light item
      if (killerIdx === 0) { sfx.play('kill'); setTimeout(() => sfx.play('score_up'), 90); scorePop('+' + DM.killScore, 'plus'); }
    }
    r.alive = false; r.bike.visible = false; r.boost = 0; r.shield = 0; r.lastKiller = killerIdx;
    r.lives = Math.max(0, r.lives - 1);              // Infinity-1 = Infinity (score mode)
    r.respawnT = r.lives > 0 ? DM.respawnDelay : 0;  // 0 lives -> eliminated (no respawn)
    if (r.lives > 0) { const s = pickRespawn(r); r.rsX = s.x; r.rsZ = s.z; r.rsH = s.h; }  // choose spot now; camera pans there during the delay
    spawnExplosion(r.x, 1.4, r.z); spawnDebris(r.x, 1.2, r.z, r.color); clearRiderTrail(r);
    if (r.idx === 0) { S.cause = cause; sfx.play('dm_death'); scorePop('-1', 'minus'); }
  }
  function topScorer() {
    let best = -1e9, bi = -1;
    riders.forEach(r => { if (!r.startDead && r.score > best) { best = r.score; bi = r.idx; } });
    return bi;
  }
  function positionAll(dt) {
    const tnow = performance.now();
    const leaderIdx = topScorer();
    for (const r of riders) {
      r.bike.position.set(r.x, r.y || 0, r.z); r.bike.rotation.y = -r.heading; r.bike.rotation.x = r.pitch || 0;
      // shield item -> bubble; post-respawn invuln -> blink the bike (반투명 깜빡)
      r.bubble.visible = r.alive && r.shield > 0;
      if (r.bubble.visible) r.bubble.material.opacity = 0.34 + 0.16 * Math.abs(Math.sin(tnow * 0.008));
      if (r.alive) r.bike.visible = !(r.invuln > 0 && r.shield <= 0 && Math.floor(tnow / 90) % 2 === 0);
      // boost flame
      r.flame.visible = r.alive && r.boost > 0;
      if (r.flame.visible) r.flame.scale.set(1, 0.85 + 0.5 * Math.abs(Math.sin(tnow * 0.03)), 1);
      // crown on the current leader
      if (r.crown) r.crown.visible = r.alive && r.idx === leaderIdx;
    }
    riders.forEach((r, i) => {
      const fx = Math.sin(r.heading), fz = -Math.cos(r.heading);
      const rx = Math.cos(r.heading), rz = Math.sin(r.heading); // right vector for head-look pan
      const hl = (r.head || 0) * 9;
      cameras[i].position.lerp(new THREE.Vector3(r.x - fx * 13, 7.5 + (r.y || 0) * 0.4, r.z - fz * 13), Math.min(1, dt * 5));
      cameras[i].lookAt(r.x + fx * 6 + rx * hl, (r.y || 0) + 1.6, r.z + fz * 6 + rz * hl);
    });
  }
  function update(dt, inputs) {
    if (paused) { positionAll(dt); updateExplosion(dt); updateDebris(dt); updateSparks(dt); updateFw(dt); return; }
    if (S.over) {   // freeze; victory camera orbits the winner + fireworks
      if (S.winner >= 0) {
        const w = riders[S.winner];
        winAng += dt * 0.4;
        winCam.position.set(w.x + Math.sin(winAng) * 14, 9, w.z + Math.cos(winAng) * 14);
        winCam.lookAt(w.x, 2, w.z);
        fwT -= dt; if (fwT <= 0) { fwT = 0.45; launchFw(w.x + (Math.random() - 0.5) * 18, 10 + Math.random() * 10, w.z + (Math.random() - 0.5) * 18); }
      }
      updateExplosion(dt); updateDebris(dt); updateSparks(dt); updateFw(dt); positionAll(dt); return;
    }
    S.time += dt;
    if (mode.timer > 0) S.timeLeft = Math.max(0, S.timeLeft - dt);          // score mode counts down
    if (mode.shrink) {
      arena.radius = Math.max(DM.minR, arena.radius - DM.shrinkRate * dt); ring.scale.setScalar(arena.radius / DM.arenaR);
      for (const p of PADS) if (Math.hypot(p.x, p.z) > arena.radius) relocatePad(p);   // pads that fall outside the shrinking ring hop back in (placed at <=0.9R so no per-frame jitter)
    }
    if (S.itemT != null) { S.itemT -= dt; if (S.itemT <= 0) { S.itemT = DM.itemInterval; grantItems(); } }
    for (const r of riders) {
      if (!r.alive) {   // downed -> count down to respawn (no elimination)
        if (!r.remote && r.respawnT > 0) {
          if (r.rsX != null) { const k = Math.min(1, dt * 2.6); r.x += (r.rsX - r.x) * k; r.z += (r.rsZ - r.z) * k; r.heading = r.rsH; }  // glide (camera follows) to the respawn spot
          r.respawnT -= dt; if (r.respawnT <= 0) respawnRider(r);
        }
        continue;
      }
      if (r.remote) {   // network-driven: lerp to target, build trail, no local sim/collision
        const k = Math.min(1, dt * 12);
        r.x += (r.tx - r.x) * k; r.z += (r.tz - r.z) * k; r.heading = r.th;
        if (!r.airFlag) emitTrail(r);   // skip trail while opponent airborne
        continue;
      }
      const inp = (inputs && inputs[r.idx]) || {};
      const steer = r.isBot ? botSteer(r, dt) : (inp.steer || 0);
      if (!r.isBot) r.head = inp.head || 0;
      let dead = false, cause = '', killer = -1;

      if (r.invuln > 0) r.invuln -= dt;
      if (r.boost > 0) r.boost -= dt;
      if (r.shield > 0) r.shield -= dt;
      const immune = r.invuln > 0 || r.shield > 0;   // trail/boundary-proof

      // bots: use items offensively — fire shield/super to ram a nearby target, boost to close in
      if (r.isBot && r.item) {
        const prey = botTarget(r);
        const pd = prey ? Math.hypot(prey.x - r.x, prey.z - r.z) : 1e9;
        let fire = Math.random() < dt * 0.4;            // baseline (keeps old cadence)
        if (r.item === 'shield' || r.item === 'super') fire = fire || (pd < 16 && Math.random() < dt * 3.0); // strike range -> body-check
        else if (r.item === 'boost') fire = fire || (pd > 26 && Math.random() < dt * 2.0);                   // far -> burst to catch up
        if (fire) useItem(r.idx);
      }

      // jump pad launch + airborne parabola (over trails, immune while flying)
      if (r.air > 0) r.air -= dt;
      else for (const p of PADS) if (Math.hypot(r.x - p.x, r.z - p.z) < DM.jumpPadR) { r.air = DM.jumpTime; relocatePad(p); if (r.idx === 0) sfx.play('jump_launch'); break; }   // pad used -> moves elsewhere
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
      emitTrail(r);                                // tail keeps following even mid-air
      if (!dead && !airborne && !immune) for (const rr of riders) {   // can't hit trails mid-air / while shielded
        const skip = (rr === r) ? DM.graceSegs : 0;
        for (let i = 0; i < rr.trailSegs.length - skip; i++) {
          const sg = rr.trailSegs[i];
          if (Math.abs((r.y || 0) - (sg.y0 || 0)) < DM.trailH && distToSeg(r.x, r.z, sg) < DM.trailW) {   // pass under floating (mid-jump) trail walls
            dead = true; cause = (rr === r) ? '트레일 충돌' : '상대 트레일'; if (rr !== r) killer = rr.idx; break;
          }
        }
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

    for (const r of riders) if (r.alive && r.air <= 0 && r.pitch > CFG.maxPitch * 0.22) {   // no sparks while airborne (no ground contact)
      const sfx2 = Math.sin(r.heading), sfz2 = -Math.cos(r.heading);   // spew sparks from the rear wheel
      for (let s = 0; s < 4; s++) spawnSpark(r.x - sfx2 * 1.3 + (Math.random() - 0.5) * 0.7, 0.3, r.z - sfz2 * 1.3 + (Math.random() - 0.5) * 0.7);
    }
    updateExplosion(dt); updateDebris(dt); updateSparks(dt); updateFw(dt);
    positionAll(dt);
  }
  reset();
  return { scene, get camera() { return cameras[0]; }, cameras, winCam, update, reset, setPaused, applyRemote, useItem, S, riders };
}

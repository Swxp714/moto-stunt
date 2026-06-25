// MOTO STUNT — in-game kart select overlay (Mario-Kart-inspired)
// openKartSelect({count}) -> Promise<[{vehicle, color}, ...]> (length = count).
// Players pick a vehicle + body color; both lock -> 3s countdown -> resolves.
import * as THREE from 'three';
import { VEHICLES, mountRider } from '../models/vehicles.js';

const ICONS = { scooter: '🛵', dirtbike: '🏍️', sportbike: '🏎️', wheelbarrow: '🛒' };
const PALETTE = [0xe8842a, 0xe14b4b, 0x4b86e1, 0x49b96a, 0x9b59d0, 0xf2c53d, 0x37c7c2, 0xec6aa8];
const N = VEHICLES.length, NC = PALETTE.length;
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const TINT = [0xffd0c4, 0xc4d8ff];
const PODX = [0xe8503a, 0x3a78e8];

let injected = false;
function injectCSS() {
  if (injected) return; injected = true;
  const s = document.createElement('style');
  s.textContent = `
  #ksRoot{position:fixed;inset:0;z-index:60;font-family:'Galmuri11',system-ui,sans-serif;display:none}
  #ksRoot.on{display:block}
  #ksBg{position:absolute;inset:0;background:linear-gradient(180deg,#6fd0ff 0%,#4aa8ee 55%,#2f86d8 100%)}
  #ksBg::after{content:'';position:absolute;inset:0;opacity:.14;background-image:linear-gradient(45deg,#fff 25%,transparent 25%,transparent 75%,#fff 75%),linear-gradient(45deg,#fff 25%,transparent 25%,transparent 75%,#fff 75%);background-size:56px 56px;background-position:0 0,28px 28px}
  #ksCanvas{position:absolute;inset:0;width:100%;height:100%}
  #ksUi{position:absolute;inset:0;pointer-events:none}
  .ks-title{position:absolute;top:16px;left:0;right:0;text-align:center;color:#fff;font-size:24px;font-weight:800;letter-spacing:.05em;text-shadow:0 3px 0 #1c5fae}
  .ks-panel{position:absolute;top:92px;width:300px;padding:13px;border-radius:16px;background:rgba(255,255,255,.16);border:3px solid rgba(255,255,255,.5);box-shadow:0 8px 0 rgba(0,0,0,.12)}
  .ks-panel.l{left:26px}.ks-panel.r{right:26px}.ks-panel.c{left:50%;transform:translateX(-50%)}
  .ks-tag{display:inline-block;font-weight:800;font-size:14px;color:#fff;padding:3px 12px;border-radius:8px}
  .ks-name{margin:8px 2px 10px;font-size:21px;font-weight:800;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.25);min-height:26px}
  .ks-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
  .ks-chip{position:relative;aspect-ratio:1;border-radius:11px;background:rgba(255,255,255,.85);display:flex;align-items:center;justify-content:center;font-size:26px;border:3px solid transparent;box-shadow:inset 0 -4px 0 rgba(0,0,0,.08)}
  .ks-chip .nm{position:absolute;bottom:2px;left:0;right:0;text-align:center;font-size:8px;color:#5a4f3f;font-weight:700}
  .ks-chip.sel{transform:translateY(-3px) scale(1.06);box-shadow:0 0 0 3px #fff,0 6px 10px rgba(0,0,0,.25)}
  .ks-chip.locked::after{content:'OK';position:absolute;top:-8px;right:-8px;background:#ffd23f;color:#5a3b00;font-size:10px;font-weight:800;padding:2px 6px;border-radius:8px;border:2px solid #fff;transform:rotate(8deg)}
  .ks-clab{margin:11px 2px 5px;font-size:11px;color:#eaf6ff;opacity:.85;font-weight:700}
  .ks-sw{display:flex;gap:6px;flex-wrap:wrap}
  .ks-sw div{width:28px;height:28px;border-radius:8px;border:3px solid rgba(255,255,255,.5);box-shadow:inset 0 -3px 0 rgba(0,0,0,.18)}
  .ks-sw div.sel{border-color:#fff;transform:translateY(-2px) scale(1.12);box-shadow:0 0 0 2px #ffd23f,0 4px 8px rgba(0,0,0,.3)}
  .ks-ready{margin-top:11px;text-align:center;font-size:17px;font-weight:800;height:20px;color:#ffe08a}
  .ks-hint{position:absolute;bottom:14px;left:0;right:0;text-align:center;color:#eaf6ff;font-size:12px}
  .ks-hint b{color:#fff}
  #ksCount{position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:#fff;font-size:150px;font-weight:900;text-shadow:0 8px 0 #1c5fae}
  #ksCount.go{color:#ffe23f}`;
  document.head.appendChild(s);
}

export function openKartSelect(opts = {}) {
  injectCSS();
  const count = opts.count === 2 ? 2 : 1;
  const sides = count === 2 ? ['l', 'r'] : ['l'];
  const labels = count === 2 ? ['P1', 'P2'] : ['P1'];

  // ---- DOM overlay ----
  const root = document.createElement('div'); root.id = 'ksRoot';
  root.innerHTML = `<div id="ksBg"></div><canvas id="ksCanvas"></canvas>
    <div id="ksUi">
      <div class="ks-title">${opts.title || '카트 선택 — 준비되면 출발!'}</div>
      ${sides.map((sd, i) => `<div class="ks-panel ${sd}" data-p="${i}">
        <span class="ks-tag" style="background:${hex(PODX[i] || 0xe8503a)}">${labels[i]}</span>
        <div class="ks-name"></div><div class="ks-strip"></div>
        <div class="ks-clab">색상</div><div class="ks-sw"></div><div class="ks-ready"></div></div>`).join('')}
      <div class="ks-hint">${count === 2
        ? 'P1 <b>A/D</b> 카트·<b>W</b> 색·<b>LSHIFT</b> 선택　|　P2 <b>←/→</b> 카트·<b>↑</b> 색·<b>ENTER</b> 선택'
        : '<b>A/D · ←/→</b> 카트 · <b>W/↑</b> 색 · <b>SPACE/ENTER</b> 선택'}</div>
    </div><div id="ksCount"></div>`;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('on'));

  // ---- 3D ----
  const canvas = root.querySelector('#ksCanvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbfd8ee, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(4, 9, 6);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004;
  scene.add(key); scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  const podiums = [];
  const px = count === 2 ? [-4, 4] : [2.8];
  px.forEach((x, i) => {
    const g = new THREE.Group(); g.position.x = x;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.2, 0.5, 36),
      new THREE.MeshStandardMaterial({ color: PODX[i] || 0xe8503a, roughness: 0.6 }));
    base.position.y = 0.25; base.receiveShadow = true; g.add(base);
    scene.add(g); podiums.push(g);
  });

  const players = sides.map((sd, i) => ({
    idx: i % N, colorIdx: (i + 1) % NC, locked: false, kart: null, podium: podiums[i], tint: TINT[i % 2],
    panel: root.querySelector(`.ks-panel[data-p="${i}"]`),
  }));

  function rebuild(p) {
    if (p.kart) { p.kart.parent && p.kart.parent.remove(p.kart); p.kart.traverse(o => o.geometry && o.geometry.dispose()); }
    const v = VEHICLES[p.idx];
    const kart = v.build(PALETTE[p.colorIdx]);
    if (v.seat) mountRider(kart, v.seat, p.tint);
    kart.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    kart.position.y = 0.5;
    kart.rotation.y = count === 2 ? (p === players[0] ? -0.5 : 0.5) : -0.4;
    p.kart = kart; p.podium.add(kart);
  }
  function buildUI(p) {
    p.panel.querySelector('.ks-strip').innerHTML = VEHICLES.map((v, i) =>
      `<div class="ks-chip" data-i="${i}">${ICONS[v.key] || '🛞'}<span class="nm">${v.name}</span></div>`).join('');
    p.panel.querySelector('.ks-sw').innerHTML = PALETTE.map((c, i) => `<div data-i="${i}" style="background:${hex(c)}"></div>`).join('');
  }
  function refresh(p) {
    p.panel.querySelector('.ks-name').textContent = VEHICLES[p.idx].name;
    [...p.panel.querySelectorAll('.ks-chip')].forEach((c, i) => {
      c.classList.toggle('sel', i === p.idx); c.classList.toggle('locked', p.locked && i === p.idx);
    });
    [...p.panel.querySelectorAll('.ks-sw div')].forEach((c, i) => c.classList.toggle('sel', i === p.colorIdx));
    p.panel.querySelector('.ks-ready').textContent = p.locked ? '✔ READY' : '';
  }
  function move(p, d) { if (p.locked) return; p.idx = (p.idx + d + N) % N; rebuild(p); refresh(p); }
  function cyc(p, d) { if (p.locked) return; p.colorIdx = (p.colorIdx + d + NC) % NC; rebuild(p); refresh(p); }
  function lock(p) { p.locked = !p.locked; refresh(p); if (players.every(q => q.locked)) startCountdown(); }

  let counting = false, done = false;
  const countEl = root.querySelector('#ksCount');
  function startCountdown() {
    if (counting) return; counting = true;
    countEl.style.display = 'flex'; let n = 3; countEl.textContent = n; countEl.classList.remove('go');
    const t = setInterval(() => {
      n--;
      if (n > 0) countEl.textContent = n;
      else if (n === 0) { countEl.textContent = 'GO!'; countEl.classList.add('go'); }
      else { clearInterval(t); finish(); }
    }, 750);
  }

  function onKey(e) {
    if (counting || done) return;
    const p1 = players[0], p2 = players[1];
    if (count === 2) {
      if (e.code === 'KeyA') move(p1, -1); else if (e.code === 'KeyD') move(p1, 1);
      else if (e.code === 'KeyW' || e.code === 'KeyS') cyc(p1, e.code === 'KeyS' ? -1 : 1);
      else if (e.code === 'ShiftLeft') lock(p1);
      else if (e.code === 'ArrowLeft') move(p2, -1); else if (e.code === 'ArrowRight') move(p2, 1);
      else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') cyc(p2, e.code === 'ArrowDown' ? -1 : 1);
      else if (e.code === 'Enter') lock(p2);
    } else {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') move(p1, -1);
      else if (e.code === 'KeyD' || e.code === 'ArrowRight') move(p1, 1);
      else if (e.code === 'KeyW' || e.code === 'ArrowUp') cyc(p1, 1);
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') cyc(p1, -1);
      else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ShiftLeft') lock(p1);
    }
    e.preventDefault();
  }
  addEventListener('keydown', onKey);

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  let raf;
  function loop() {
    if (!done) players.forEach(p => p.kart && (p.kart.rotation.y += 0.006));
    const cx = count === 2 ? 0 : 2.8;
    camera.position.set(count === 2 ? 0 : 1.4, 4.0, count === 2 ? 13.5 : 8.5);
    camera.lookAt(cx, 1.2, 0);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }

  let resolveFn;
  const promise = new Promise((res) => { resolveFn = res; });
  function finish() {
    done = true;
    const picks = players.map(p => ({ vehicle: VEHICLES[p.idx].key, color: PALETTE[p.colorIdx] }));
    cancelAnimationFrame(raf); removeEventListener('keydown', onKey); removeEventListener('resize', resize);
    root.classList.remove('on');
    setTimeout(() => { renderer.dispose(); root.remove(); }, 200);
    resolveFn(picks);
  }

  players.forEach(p => { buildUI(p); rebuild(p); refresh(p); });
  loop();
  return promise;
}

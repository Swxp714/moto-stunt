// MOTO STUNT — 레전드 정규전 augment 3D icon models (low-poly, faceted).
// Theme: REAL famous motorcycle parts. Same angular/flatShading aesthetic as the
// vehicles + DM items. Each builder is `(THREE) => THREE.Group` returning a small,
// centered group (~2-unit cube, facing +Z, lit for a 3/4 view), bold & readable
// when baked at ~96px, using each brand's iconic color.
//
// THREE is passed as a param (the baker hands it in) so this file pulls in no
// globals and no module-level `three` dependency for the builders themselves.

// ---------------------------------------------------------------------------
// tiny local kit — mirrors models/_kit.js but THREE-parametrised + flatShading.
// ---------------------------------------------------------------------------
function mk(THREE) {
  const mat = (hex, o = {}) => new THREE.MeshStandardMaterial({
    color: hex,
    roughness: o.rough ?? 0.6,
    metalness: o.metal ?? 0.0,
    transparent: o.opacity != null && o.opacity < 1,
    opacity: o.opacity ?? 1,
    flatShading: o.flat !== undefined ? o.flat : true,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
  });
  // angular box
  const box = (w, h, d, color, o = {}) =>
    new THREE.Mesh(new THREE.BoxGeometry(w, h, d), color.isMaterial ? color : mat(color, o));
  // faceted prism cylinder (axis +Y). sides default 8.
  const cyl = (rTop, rBot, h, color, o = {}) =>
    new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, o.sides ?? 8), color.isMaterial ? color : mat(color, o));
  // faceted low-poly ball
  const ball = (r, color, o = {}) =>
    new THREE.Mesh(new THREE.IcosahedronGeometry(r, o.detail ?? 0), color.isMaterial ? color : mat(color, o));
  // torus (chain links, coils, loops, rims)
  const ring = (r, tube, color, o = {}) =>
    new THREE.Mesh(new THREE.TorusGeometry(r, tube, o.rseg ?? 6, o.tseg ?? 10, o.arc ?? Math.PI * 2),
      color.isMaterial ? color : mat(color, o));
  // cone = cylinder with zero top
  const cone = (r, h, color, sides = 6, o = {}) => cyl(0, r, h, color, { ...o, sides });
  // place + rotate (euler degrees)
  const at = (obj, x, y, z, rx = 0, ry = 0, rz = 0) => {
    obj.position.set(x, y, z);
    obj.rotation.set(rx * Math.PI / 180, ry * Math.PI / 180, rz * Math.PI / 180);
    return obj;
  };
  return { THREE, mat, box, cyl, ball, ring, cone, at };
}

// ---------------------------------------------------------------------------
// builders — one per augment id (REAL motorcycle parts). Each returns a centered
// THREE.Group facing +Z, using the brand's iconic color.
// ---------------------------------------------------------------------------
export const AUGMENT_MODELS = {
  // 아크라포빅 — titanium exhaust muffler / slip-on pipe (brushed silver-blue tip)
  akra(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    const ti = { metal: 0.85, rough: 0.35 };
    // hexagonal muffler can lying along X
    g.add(k.at(k.cyl(0.4, 0.4, 1.3, 0xc6ccd4, { sides: 6, ...ti }), -0.1, 0, 0, 0, 0, 90));
    // brushed silver-blue burnt tip
    g.add(k.at(k.cyl(0.42, 0.42, 0.28, 0x6f93c4, { sides: 6, metal: 0.9, rough: 0.25 }), 0.62, 0, 0, 0, 0, 90));
    // carbon end cap clamp
    g.add(k.at(k.cyl(0.44, 0.44, 0.12, 0x1c1f24, { sides: 6, rough: 0.5 }), 0.78, 0, 0, 0, 0, 90));
    // inlet pipe
    g.add(k.at(k.cyl(0.16, 0.16, 0.5, 0xb6bcc4, { sides: 8, ...ti }), -0.92, 0.02, 0, 0, 0, 90));
    return g;
  },

  // 브렘보 캘리퍼 — brake caliper clamped on a drilled disc (RED caliper, silver disc)
  brembo(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    // silver brake disc facing camera
    g.add(k.at(k.cyl(0.72, 0.72, 0.1, 0xb9bfc7, { sides: 16, metal: 0.7, rough: 0.35 }), 0, 0, 0, 90, 0, 0));
    // inner hub
    g.add(k.at(k.cyl(0.26, 0.26, 0.14, 0x8c9098, { sides: 12, metal: 0.6, rough: 0.4 }), 0, 0, 0, 90, 0, 0));
    // drill holes
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      g.add(k.at(k.cyl(0.07, 0.07, 0.14, 0x303338, { sides: 6 }), Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0, 90, 0, 0));
    }
    // iconic RED Brembo caliper straddling the rim (top)
    g.add(k.at(k.box(0.5, 0.46, 0.42, 0xd61f1f, { rough: 0.4, emissive: 0x3a0606, emissiveIntensity: 0.4 }), 0, 0.62, 0));
    g.add(k.at(k.box(0.54, 0.16, 0.12, 0x9a1414), 0, 0.62, 0.2));   // caliper rib
    return g;
  },

  // 올린즈 서스펜션 — coilover shock with coil spring (GOLD spring, black body)
  ohlins(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    // black shock body / damper rod
    g.add(k.at(k.cyl(0.13, 0.13, 1.4, 0x141414, { sides: 8, rough: 0.45 }), 0, 0, 0));
    // top + bottom mounts
    g.add(k.at(k.ring(0.16, 0.07, 0x222222, { rseg: 5, tseg: 8 }), 0, 0.78, 0, 0, 90, 0));
    g.add(k.at(k.ring(0.16, 0.07, 0x222222, { rseg: 5, tseg: 8 }), 0, -0.78, 0, 0, 90, 0));
    // iconic ÖHLINS GOLD coil spring
    const coils = 7;
    for (let i = 0; i < coils; i++) {
      const c = k.ring(0.34, 0.08, 0xffb01f, { metal: 0.55, rough: 0.35, rseg: 5, tseg: 10 });
      k.at(c, 0, (i - (coils - 1) / 2) * 0.17, 0, 80, 0, 0);
      g.add(c);
    }
    // gold preload collar
    g.add(k.at(k.cyl(0.2, 0.2, 0.14, 0xe6a014, { sides: 8, metal: 0.6, rough: 0.3 }), 0, 0.58, 0));
    return g;
  },

  // 피렐리 타이어 — treaded motorcycle tire (black, visible tread blocks)
  pirelli(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    g.add(k.at(k.cyl(0.7, 0.7, 0.4, 0x202024, { sides: 16, rough: 0.9 }), 0, 0, 0, 90, 0, 0));
    // road tread blocks around the crown
    const tm = k.mat(0x141416, { rough: 1 });
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.44), tm);
      b.position.set(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0);
      b.rotation.z = a; g.add(b);
    }
    // inner rim accent (subtle yellow Pirelli flash)
    g.add(k.at(k.cyl(0.34, 0.34, 0.42, 0xe8c020, { sides: 14, metal: 0.4, rough: 0.4 }), 0, 0, 0, 90, 0, 0));
    g.add(k.at(k.cyl(0.26, 0.26, 0.44, 0x2a2a2e, { sides: 12 }), 0, 0, 0, 90, 0, 0));
    return g;
  },

  // 카본 파이버 — carbon-fiber weave panel/plate (dark grey checker/weave)
  carbon(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    // backing plate
    g.add(k.at(k.box(1.3, 1.0, 0.12, 0x15171b, { rough: 0.3, metal: 0.4 }), 0, 0, 0));
    // woven checker pattern of glossy tiles
    const cols = 6, rows = 5, tw = 0.19, th = 0.17;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const dark = (r + c) % 2 === 0;
      const tile = k.box(tw, th, 0.06, dark ? 0x33373d : 0x4a4f57, { metal: 0.6, rough: 0.25 });
      tile.position.set((c - (cols - 1) / 2) * (tw + 0.015), (r - (rows - 1) / 2) * (th + 0.015), 0.08);
      g.add(tile);
    }
    return g;
  },

  // 에어로 윙렛 — aerodynamic winglet / spoiler fin (sleek black blade)
  winglet(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    const blk = { rough: 0.25, metal: 0.35 };
    // main swept blade (thin, raked)
    g.add(k.at(k.box(1.4, 0.12, 0.5, 0x101216, blk), 0, 0.18, 0, 0, 0, -14));
    // upturned endplate winglet
    g.add(k.at(k.box(0.12, 0.5, 0.46, 0x171a1f, blk), 0.66, 0.36, 0, 0, 0, -14));
    // lower vane
    g.add(k.at(k.box(1.0, 0.1, 0.42, 0x1c1f25, blk), -0.06, -0.18, 0, 0, 0, -8));
    // red trim edge accent
    g.add(k.at(k.box(1.42, 0.04, 0.08, 0xd61f1f, { emissive: 0x3a0606, emissiveIntensity: 0.4 }), 0, 0.25, 0.26, 0, 0, -14));
    return g;
  },

  // NOS 나이트로 — nitrous bottle (iconic NOS BLUE cylinder, valve on top)
  nos(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    const blue = 0x1f6fff;
    // bottle body
    g.add(k.at(k.cyl(0.42, 0.42, 1.15, blue, { sides: 12, metal: 0.5, rough: 0.3, emissive: 0x06183a, emissiveIntensity: 0.4 }), 0, -0.1, 0));
    // domed shoulder
    g.add(k.at(k.cyl(0.42, 0.22, 0.3, blue, { sides: 12, metal: 0.5, rough: 0.3 }), 0, 0.62, 0));
    // neck
    g.add(k.at(k.cyl(0.16, 0.16, 0.18, 0x9aa0a8, { sides: 8, metal: 0.7, rough: 0.3 }), 0, 0.85, 0));
    // brass valve + red knob
    g.add(k.at(k.box(0.34, 0.16, 0.16, 0xc9a23a, { metal: 0.7, rough: 0.3 }), 0.08, 0.98, 0));
    g.add(k.at(k.cyl(0.1, 0.1, 0.14, 0xd61f1f, { sides: 6 }), 0.28, 1.0, 0, 0, 0, 90));
    // white label band
    g.add(k.at(k.cyl(0.43, 0.43, 0.28, 0xeef2f7, { sides: 12, rough: 0.5 }), 0, 0.0, 0));
    return g;
  },

  // 마르케시니 휠 — forged 5-spoke alloy wheel (bronze/gold)
  marche(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    const bronze = 0xc78a2e;
    // outer rim
    g.add(k.at(k.ring(0.66, 0.13, bronze, { metal: 0.7, rough: 0.3, rseg: 6, tseg: 16 }), 0, 0, 0));
    // tire shadow ring behind
    g.add(k.at(k.ring(0.78, 0.07, 0x202024, { rseg: 5, tseg: 16 }), 0, 0, -0.06));
    // hub
    g.add(k.at(k.cyl(0.2, 0.2, 0.22, 0x9a6a1e, { sides: 10, metal: 0.7, rough: 0.3 }), 0, 0, 0, 90, 0, 0));
    // 5 forged spokes
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      const sp = k.box(0.5, 0.16, 0.12, bronze, { metal: 0.65, rough: 0.32 });
      sp.position.set(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0);
      sp.rotation.z = a; g.add(sp);
    }
    return g;
  },

  // DID 레이싱 체인 — drive chain loop of links (GOLD links)
  did(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    const gold = 0xe8b21f, n = 12, R = 0.62;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      // outer plate (link)
      const plate = k.box(0.26, 0.13, 0.1, gold, { metal: 0.7, rough: 0.3, emissive: 0x3a2a00, emissiveIntensity: 0.3 });
      plate.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      plate.rotation.z = a + Math.PI / 2;
      g.add(plate);
      // roller pin
      const pin = k.cyl(0.05, 0.05, 0.18, 0x8a6a12, { sides: 6, metal: 0.6, rough: 0.4 });
      g.add(k.at(pin, Math.cos(a) * R, Math.sin(a) * R, 0, 90, 0, 0));
    }
    return g;
  },

  // 터보차저 — turbocharger snail housing with compressor inlet (metallic)
  turbo(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    const steel = { metal: 0.8, rough: 0.35 };
    // snail volute = spiral of growing cylinder segments
    const segs = 9;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const a = t * Math.PI * 1.9;
      const r = 0.18 + t * 0.5;                 // growing radius from center
      const tube = 0.16 + t * 0.16;             // growing cross-section
      const s = k.cyl(tube, tube, 0.34, 0xb8bec6, { sides: 6, ...steel });
      g.add(k.at(s, Math.cos(a) * r, Math.sin(a) * r, 0, 90, 0, 0));
    }
    // central hub
    g.add(k.at(k.cyl(0.24, 0.24, 0.42, 0x8a9098, { sides: 10, ...steel }), 0, 0, 0, 90, 0, 0));
    // compressor inlet snout pointing toward camera
    g.add(k.at(k.cyl(0.26, 0.34, 0.4, 0x9aa0a8, { sides: 10, ...steel }), 0, 0, 0.45));
    g.add(k.at(k.cyl(0.34, 0.34, 0.1, 0x6f757d, { sides: 10, ...steel }), 0, 0, 0.66));
    return g;
  },

  // 케블라 슈트 — racing leather suit / chest armor with shoulder pads (red+black)
  kevlar(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    const red = 0xd61f1f, blk = 0x16181c;
    // chest torso
    g.add(k.at(k.box(0.9, 1.1, 0.5, red, { rough: 0.5, emissive: 0x2a0404, emissiveIntensity: 0.3 }), 0, 0, 0));
    // black center stripe / zipper
    g.add(k.at(k.box(0.16, 1.1, 0.52, blk), 0, 0, 0.01));
    // shoulder pads
    g.add(k.at(k.ball(0.3, blk, { detail: 0, rough: 0.4 }), -0.52, 0.46, 0.1));
    g.add(k.at(k.ball(0.3, blk, { detail: 0, rough: 0.4 }), 0.52, 0.46, 0.1));
    // collar
    g.add(k.at(k.box(0.5, 0.18, 0.5, blk), 0, 0.62, 0));
    // ribbed back-protector lines
    for (let i = 0; i < 3; i++)
      g.add(k.at(k.box(0.7, 0.08, 0.54, 0x9a1414), 0, -0.34 + i * 0.26, 0));
    return g;
  },

  // 모토크로스 킷 — knobby off-road dirt tire (chunky deep knobs)
  dirt_flip(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    g.add(k.at(k.cyl(0.6, 0.6, 0.42, 0x1b1b1f, { sides: 12, rough: 1 }), 0, 0, 0, 90, 0, 0));
    // chunky deep knobs (alternating in/out for off-road look)
    const km = k.mat(0x101012, { rough: 1 });
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const z = (i % 2 ? 1 : -1) * 0.12;
      const kn = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.22), km);
      kn.position.set(Math.cos(a) * 0.66, Math.sin(a) * 0.66, z);
      kn.rotation.z = a; g.add(kn);
    }
    // muddy orange rim accent (MX vibe)
    g.add(k.at(k.cyl(0.3, 0.3, 0.44, 0xff7a1a, { sides: 10, metal: 0.4, rough: 0.5 }), 0, 0, 0, 90, 0, 0));
    g.add(k.at(k.cyl(0.2, 0.2, 0.46, 0x202024, { sides: 8 }), 0, 0, 0, 90, 0, 0));
    return g;
  },

  // 레이스 페어링 — sportbike front fairing / cowl with windscreen (red/white)
  sport_aero(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    const red = 0xe11020, white = 0xeef2f7;
    // main shell body (tapered, axis toward camera)
    g.add(k.at(k.cyl(0.5, 0.74, 1.0, red, { sides: 8, rough: 0.4, emissive: 0x2a0404, emissiveIntensity: 0.3 }), 0, -0.05, 0, 90, 0, 0));
    // white nose stripe
    g.add(k.at(k.box(0.3, 0.2, 1.0, white), 0, -0.05, 0.4));
    // tinted windscreen up top
    g.add(k.at(k.box(0.62, 0.36, 0.12, 0x2a3550, { metal: 0.4, rough: 0.2, opacity: 0.9 }), 0, 0.5, -0.2, -24, 0, 0));
    // twin headlight eyes
    g.add(k.at(k.ball(0.16, 0xdfe8ff, { detail: 0, metal: 0.5, rough: 0.2, emissive: 0x9ab0ff, emissiveIntensity: 0.5 }), -0.22, 0.06, 0.46));
    g.add(k.at(k.ball(0.16, 0xdfe8ff, { detail: 0, metal: 0.5, rough: 0.2, emissive: 0x9ab0ff, emissiveIntensity: 0.5 }), 0.22, 0.06, 0.46));
    return g;
  },

  // 퀵서비스 킷 — food-delivery top box / rear cargo case (square box + plate)
  scoot_courier(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    const shell = 0xf04a2a, dark = 0x2a2a2e;
    // main top-box body
    g.add(k.at(k.box(1.1, 0.9, 0.86, shell, { rough: 0.5 }), 0, 0, 0));
    // slightly domed lid
    g.add(k.at(k.box(1.14, 0.16, 0.9, 0xd83a1c), 0, 0.5, 0));
    // black mounting base
    g.add(k.at(k.box(0.7, 0.14, 0.6, dark), 0, -0.52, 0));
    // logo plate on the front
    g.add(k.at(k.box(0.6, 0.46, 0.06, 0xfff4e0), 0, 0.02, 0.45));
    g.add(k.at(k.box(0.42, 0.12, 0.07, shell), 0, 0.1, 0.47));     // logo bar
    // latch / handle
    g.add(k.at(k.box(0.34, 0.1, 0.12, dark), 0, -0.18, 0.46));
    return g;
  },

  // 강화 적재함 — reinforced cargo crate / bin (riveted metal box)
  barrow_cargo(THREE) {
    const k = mk(THREE), g = new THREE.Group();
    const steel = 0x8b9199, edge = 0x5a5f66;
    // main bin
    g.add(k.at(k.box(1.1, 0.86, 0.8, steel, { metal: 0.6, rough: 0.45 }), 0, 0, 0));
    // reinforcing corner posts
    const post = (x, z) => g.add(k.at(k.box(0.1, 0.92, 0.1, edge, { metal: 0.6, rough: 0.4 }), x, 0, z));
    post(-0.52, 0.38); post(0.52, 0.38); post(-0.52, -0.38); post(0.52, -0.38);
    // top + bottom rails
    g.add(k.at(k.box(1.16, 0.12, 0.86, edge, { metal: 0.6, rough: 0.4 }), 0, 0.44, 0));
    g.add(k.at(k.box(1.16, 0.12, 0.86, edge, { metal: 0.6, rough: 0.4 }), 0, -0.44, 0));
    // rivets across the front
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      g.add(k.at(k.ball(0.05, 0xc6ccd4, { detail: 0, metal: 0.8, rough: 0.3 }),
        -0.36 + i * 0.24, -0.26 + j * 0.26, 0.41));
    }
    return g;
  },
};

// ---------------------------------------------------------------------------
// bakeAugmentIcons — mirrors src/main.js renderItemIcons exactly:
// render each model with the passed-in MAIN renderer into an offscreen RT,
// readRenderTargetPixels -> a 2D canvas (Y-flipped) -> toDataURL('image/png').
// No globals: renderer + THREE are params. Returns { <id>: dataURL }.
// ---------------------------------------------------------------------------
export function bakeAugmentIcons(renderer, THREE, size = 96) {
  const out = {};
  if (!renderer || !THREE) return out;
  let rt;
  try {
    const S = size;
    rt = new THREE.WebGLRenderTarget(S, S);
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xffffff, 0x3a4252, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(2, 4, 5); sc.add(key);
    const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    cam.position.set(0.6, 0.45, 3.4); cam.lookAt(0, 0, 0);

    const buf = new Uint8Array(S * S * 4);
    const cnv = document.createElement('canvas'); cnv.width = S; cnv.height = S;
    const ctx = cnv.getContext('2d'); const img = ctx.createImageData(S, S);
    const prevRT = renderer.getRenderTarget();

    for (const id of Object.keys(AUGMENT_MODELS)) {
      const m = AUGMENT_MODELS[id](THREE);
      sc.add(m);
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(sc, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {  // flip Y (GL origin = bottom-left)
        const si = ((S - 1 - y) * S + x) * 4, di = (y * S + x) * 4;
        img.data[di] = buf[si]; img.data[di + 1] = buf[si + 1];
        img.data[di + 2] = buf[si + 2]; img.data[di + 3] = buf[si + 3];
      }
      ctx.putImageData(img, 0, 0);
      out[id] = cnv.toDataURL('image/png');
      sc.remove(m);
      m.traverse(o => o.geometry && o.geometry.dispose());
    }
    renderer.setRenderTarget(prevRT);
  } catch (e) { /* fall back to emoji icons */ }
  finally { if (rt) rt.dispose(); }
  return out;
}

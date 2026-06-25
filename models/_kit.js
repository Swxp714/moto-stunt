// MOTO STUNT — soft 3D vehicle kit
// Shared helpers for the "soft rounded matte icon" look (claymation/3D-emoji style).
// All builders compose these so the 4 vehicles share one coherent aesthetic.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// matte material — high roughness, no metalness = soft clay look
export function mat(hex, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: hex,
    roughness: opts.rough ?? 0.85,
    metalness: opts.metal ?? 0.0,
    transparent: opts.opacity != null && opts.opacity < 1,
    opacity: opts.opacity ?? 1,
    flatShading: !!opts.flat,
  });
}

// rounded box — the workhorse for soft panels, tanks, bodies, the wheelbarrow tray
export function rbox(w, h, d, color, r = 0.12, opts = {}) {
  const seg = opts.seg ?? 4;
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2)),
    color.isMaterial ? color : mat(color, opts));
  m.castShadow = m.receiveShadow = true;
  return m;
}

// sphere / blob
export function ball(r, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, opts.seg ?? 24, opts.seg ?? 18),
    color.isMaterial ? color : mat(color, opts));
  m.castShadow = m.receiveShadow = true;
  return m;
}

// rounded tube (capsule) — frames, handlebars, forks, wheelbarrow legs. Axis along Y by default.
export function tube(len, rad, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(rad, Math.max(0.001, len - 2 * rad), 4, 12),
    color.isMaterial ? color : mat(color, opts));
  m.castShadow = m.receiveShadow = true;
  return m;
}

// plain cylinder (axis Y) — hubs, exhausts, small parts
export function cyl(rTop, rBot, h, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, opts.seg ?? 24),
    color.isMaterial ? color : mat(color, opts));
  m.castShadow = m.receiveShadow = true;
  return m;
}

// a soft cartoon wheel. Axle runs along Z (so it rolls forward in +X). Returns a Group
// centered on the axle; place it by setting group.position.
//   tireR: outer radius, width: along Z, tire/hub/spoke colors
export function wheel(tireR, width, tireColor = 0x2b2725, hubColor = 0xb9b9bd, opts = {}) {
  const g = new THREE.Group();
  // fat tire: a cylinder with a torus tread wrapped on its outer edge for the rounded profile
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(tireR, tireR, width, 32), mat(tireColor, { rough: 0.95 }));
  tire.rotation.x = Math.PI / 2; tire.castShadow = tire.receiveShadow = true; g.add(tire);
  const tread = new THREE.Mesh(new THREE.TorusGeometry(tireR, width * 0.5, 12, 32), mat(tireColor, { rough: 0.95 }));
  tread.castShadow = true; g.add(tread);
  // hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(opts.hubR ?? tireR * 0.45, opts.hubR ?? tireR * 0.45, width * 1.04, 24), mat(hubColor, { rough: 0.7 }));
  hub.rotation.x = Math.PI / 2; hub.castShadow = true; g.add(hub);
  // optional center cap
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(tireR * 0.16, tireR * 0.16, width * 1.1, 16), mat(opts.capColor ?? hubColor, { rough: 0.6 }));
  cap.rotation.x = Math.PI / 2; g.add(cap);
  // optional knobby tread (dirt bike): little blocks around the rim
  if (opts.knobby) {
    const km = mat(tireColor, { rough: 1 });
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      const k = new THREE.Mesh(new THREE.BoxGeometry(width * 1.15, tireR * 0.16, tireR * 0.16), km);
      k.position.set(Math.cos(a) * tireR, Math.sin(a) * tireR, 0);
      k.rotation.z = a; g.add(k);
    }
  }
  // optional spokes (sport/dirt): thin radial bars on a lighter hub
  if (opts.spokes) {
    const sm = mat(hubColor, { rough: 0.6 });
    for (let i = 0; i < (opts.spokes === true ? 6 : opts.spokes); i++) {
      const a = i / (opts.spokes === true ? 6 : opts.spokes) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.BoxGeometry(tireR * 0.85, tireR * 0.09, width * 0.5), sm);
      s.position.set(Math.cos(a) * tireR * 0.42, Math.sin(a) * tireR * 0.42, 0);
      s.rotation.z = a; g.add(s);
    }
  }
  return g;
}

// small helper: place + rotate (euler deg) + return the object, for terse composition
export function at(obj, x, y, z, rx = 0, ry = 0, rz = 0) {
  obj.position.set(x, y, z);
  obj.rotation.set(rx * Math.PI / 180, ry * Math.PI / 180, rz * Math.PI / 180);
  return obj;
}

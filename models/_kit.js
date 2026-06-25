// MOTO STUNT — angular low-poly vehicle kit
// Shared helpers for a faceted, geometric low-poly look (sharp edges, flat
// shading). All builders compose these so the vehicles share one aesthetic.
import * as THREE from 'three';

// faceted matte material — flatShading gives the low-poly angular look
export function mat(hex, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: hex,
    roughness: opts.rough ?? 0.68,
    metalness: opts.metal ?? 0.0,
    transparent: opts.opacity != null && opts.opacity < 1,
    opacity: opts.opacity ?? 1,
    flatShading: opts.flat !== undefined ? opts.flat : true,
  });
}

// angular box (sharp corners). r/seg args kept for API compatibility but ignored.
export function rbox(w, h, d, color, r = 0, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), color.isMaterial ? color : mat(color, opts));
  m.castShadow = m.receiveShadow = true;
  return m;
}

// faceted low-poly ball (icosahedron). opts.detail: 0=very chunky, 1=default
export function ball(r, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, opts.detail ?? 1), color.isMaterial ? color : mat(color, opts));
  m.castShadow = m.receiveShadow = true;
  return m;
}

// angular tube = low-sided prism (axis along +Y). opts.sides (default 6 = hex).
export function tube(len, rad, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, opts.sides ?? 6), color.isMaterial ? color : mat(color, opts));
  m.castShadow = m.receiveShadow = true;
  return m;
}

// prism cylinder (axis +Y) — hubs, exhausts, headlights. opts.sides (default 8).
export function cyl(rTop, rBot, h, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, opts.sides ?? opts.seg ?? 8), color.isMaterial ? color : mat(color, opts));
  m.castShadow = m.receiveShadow = true;
  return m;
}

// a faceted low-poly wheel. Axle along Z (rolls toward +X). Returns a Group.
export function wheel(tireR, width, tireColor = 0x2b2725, hubColor = 0xb9b9bd, opts = {}) {
  const g = new THREE.Group();
  const sides = opts.sides ?? 12;                 // faceted, not smooth
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(tireR, tireR, width, sides), mat(tireColor, { rough: 0.92 }));
  tire.rotation.x = Math.PI / 2; tire.castShadow = tire.receiveShadow = true; g.add(tire);
  // hub
  const hubR = opts.hubR ?? tireR * 0.45;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, width * 1.06, sides), mat(hubColor, { rough: 0.55 }));
  hub.rotation.x = Math.PI / 2; hub.castShadow = true; g.add(hub);
  // center cap (chunky hex)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(tireR * 0.16, tireR * 0.16, width * 1.12, 6), mat(opts.capColor ?? hubColor, { rough: 0.5 }));
  cap.rotation.x = Math.PI / 2; g.add(cap);
  // knobby tread blocks (angular)
  if (opts.knobby) {
    const km = mat(tireColor, { rough: 1 });
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2;
      const k = new THREE.Mesh(new THREE.BoxGeometry(width * 1.18, tireR * 0.18, tireR * 0.2), km);
      k.position.set(Math.cos(a) * tireR, Math.sin(a) * tireR, 0);
      k.rotation.z = a; k.castShadow = true; g.add(k);
    }
  }
  // flat spokes (angular bars)
  if (opts.spokes) {
    const sm = mat(hubColor, { rough: 0.5 });
    const n = opts.spokes === true ? 6 : opts.spokes;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.BoxGeometry(tireR * 0.85, tireR * 0.1, width * 0.5), sm);
      s.position.set(Math.cos(a) * tireR * 0.42, Math.sin(a) * tireR * 0.42, 0);
      s.rotation.z = a; g.add(s);
    }
  }
  return g;
}

// connect two points with a prism (e.g. an arm shoulder->grip) so nothing floats.
// a, b are THREE.Vector3. Returns an oriented Mesh spanning a..b.
export function link(a, b, rad, color, opts = {}) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.001, dir.length());
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, opts.sides ?? 6),
    color.isMaterial ? color : mat(color, opts));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  return m;
}

// place + rotate (euler degrees) terse helper
export function at(obj, x, y, z, rx = 0, ry = 0, rz = 0) {
  obj.position.set(x, y, z);
  obj.rotation.set(rx * Math.PI / 180, ry * Math.PI / 180, rz * Math.PI / 180);
  return obj;
}

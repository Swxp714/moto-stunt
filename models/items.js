// MOTO STUNT — angular low-poly item models (used as 3D HUD icons + slot reel).
// Same faceted/flatShading aesthetic as the vehicles. Each builder returns a
// THREE.Group roughly within a 1.4-unit box, centered, facing the +Z camera.
import * as THREE from 'three';
import { rbox, ball, cyl, at } from './_kit.js';

// cone = a cylinder with a zero top radius
const cone = (r, h, color, sides = 6) => cyl(0, r, h, color, { sides });

export function buildItemModel(key) {
  const g = new THREE.Group();
  if (key === 'jump') {                 // green UP arrow (점프)
    g.add(at(rbox(0.34, 0.62, 0.34, 0x3f9e3f), 0, -0.2, 0));
    g.add(at(cone(0.52, 0.58, 0x66d166), 0, 0.42, 0));
  } else if (key === 'boost') {         // orange forward double-chevron (부스트)
    g.add(at(cone(0.42, 0.62, 0xff8a3a, 4), -0.22, 0, 0, 0, 0, -90));
    g.add(at(cone(0.42, 0.62, 0xffb648, 4), 0.16, 0, 0, 0, 0, -90));
  } else if (key === 'shield') {        // blue shield (보호막)
    g.add(at(rbox(0.82, 0.6, 0.22, 0x5a9bff), 0, 0.16, 0));
    g.add(at(cone(0.48, 0.52, 0x4a86e6, 3), 0, -0.34, 0, 180, 0, 0));   // pointed bottom
    g.add(at(rbox(0.26, 0.34, 0.27, 0xdcebff), 0, 0.18, 0.02));         // emblem
  } else {                              // super — gold orb with a red star burst (무적질주)
    g.add(at(ball(0.42, 0xffd23a, { detail: 0 }), 0, 0, 0));
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      const sp = cone(0.14, 0.44, 0xff5a3a, 4);
      sp.position.set(Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0);
      sp.rotation.z = a - Math.PI / 2;
      g.add(sp);
    }
  }
  return g;
}

export const ITEM_KEYS = ['jump', 'boost', 'shield', 'super'];

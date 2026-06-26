// MOTO STUNT — vehicle/bike builders. Turns a vehicle key into a game-ready
// bike pivot (forward = -Z, wheels tagged for spin). See docs/ARCHITECTURE.md.
import * as THREE from 'three';
import { VEHICLES, mountRider } from '../models/vehicles.js';

export const VMAP = Object.fromEntries(VEHICLES.map(v => [v.key, v]));
export const DEFAULT_VEHICLE = 'dirtbike';
export const VEH_EMOJI = { scooter: '🛵', dirtbike: '🏍️', sportbike: '🏎️', wheelbarrow: '🛒' };
export function vehEmoji(key) { return VEH_EMOJI[key] || '🛵'; }

// the inner 3D model (rider mounted), oriented + scaled for the in-game camera
export function buildVehicleModel(key, bodyColor, riderColor) {
  const v = VMAP[key] || VMAP[DEFAULT_VEHICLE];
  const inner = v.build(bodyColor);
  if (v.seat) mountRider(inner, v.seat, riderColor != null ? riderColor : 0xf4ead6);
  inner.rotation.y = Math.PI / 2;        // model faces +X -> rotate so forward is -Z
  inner.scale.setScalar(1.4);            // size up for the in-game camera
  return inner;
}

// the game bike: a YXZ pivot (steer/wheelie/lean) wrapping the model; wheels collected for spin
export function buildBike(bodyColor, opts = {}) {
  const pivot = new THREE.Group();
  pivot.rotation.order = 'YXZ';   // yaw (steer) -> pitch (wheelie) -> roll (lean)
  const inner = buildVehicleModel(opts.vehicle || DEFAULT_VEHICLE, bodyColor, opts.rider);
  pivot.add(inner);
  // collect wheel groups so the game can spin them (about their local Z axle)
  pivot.userData.wheels = [];
  inner.traverse(o => { if (o.userData && o.userData.isWheel) pivot.userData.wheels.push(o); });
  return pivot;
}

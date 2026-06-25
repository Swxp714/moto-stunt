// MOTO STUNT — soft 3D vehicles (4 selectable karts)
// Each builder returns a THREE.Group: faces +X (forward), wheels rest at y=0,
// roughly centered in XZ, ~3-4 units long. Built from the shared _kit helpers
// so all four share the soft rounded matte "3D icon" look.
import * as THREE from 'three';
import { mat, rbox, ball, tube, cyl, wheel, at } from './_kit.js';

function buildScooter() {
  const g = new THREE.Group();

  // --- Floorboard: low center of the step-through body ---
  const floor = rbox(1.4, 0.22, 0.8, 0xe0552e, 0.11);
  g.add(at(floor, 0.05, 0.42, 0, 0, 0, 0));

  // --- Front leg-shield: tall rounded panel at front, tilted back ---
  const shield = rbox(0.55, 1.25, 0.78, 0xe0552e, 0.2);
  g.add(at(shield, 0.78, 0.95, 0, 0, 0, 14));

  // --- Rear body hump: swelling orange mass under the seat ---
  const hump = rbox(1.05, 0.85, 0.82, 0xe0552e, 0.28);
  g.add(at(hump, -0.55, 0.78, 0, 0, 0, 0));
  // sphere to round out the hump tail
  const humpTail = ball(0.42, 0xe0552e);
  g.add(at(humpTail, -1.0, 0.72, 0, 0, 0, 0));

  // --- Front fender hugging the top of the front wheel ---
  const fender = rbox(0.6, 0.2, 0.42, 0xe0552e, 0.09);
  g.add(at(fender, 0.92, 0.78, 0, 0, 0, 6));

  // --- Headlight: cream cylinder facing +X, set into the leg-shield front ---
  const headlight = cyl(0.17, 0.17, 0.12, 0xf0e2c0);
  g.add(at(headlight, 1.12, 1.18, 0, 0, 0, 90));

  // --- Handlebar stem rising from top of leg-shield ---
  const stem = tube(0.32, 0.05, 0x3a3232);
  g.add(at(stem, 0.78, 1.62, 0, 0, 0, 14));
  // horizontal bar (axis along Z)
  const bar = tube(0.66, 0.045, 0x3a3232);
  g.add(at(bar, 0.74, 1.78, 0, 90, 0, 0));
  // grips at the ends
  const gripL = tube(0.16, 0.06, 0x2b2725);
  g.add(at(gripL, 0.74, 1.78, 0.34, 90, 0, 0));
  const gripR = tube(0.16, 0.06, 0x2b2725);
  g.add(at(gripR, 0.74, 1.78, -0.34, 90, 0, 0));

  // --- Seat: dark brown rounded seat on top of rear hump ---
  const seat = rbox(0.7, 0.18, 0.55, 0x4a3b34, 0.09);
  g.add(at(seat, -0.4, 1.28, 0, 0, 0, -3));

  // --- Rack/bracket: dark gray supporting the delivery box ---
  const rack = rbox(0.5, 0.32, 0.6, 0x3a3232, 0.06);
  g.add(at(rack, -0.85, 1.42, 0, 0, 0, 0));

  // --- Delivery box: LARGE cream rounded box, the signature feature ---
  const box = rbox(0.7, 0.78, 0.78, 0xe8d8a8, 0.14);
  g.add(at(box, -0.85, 2.0, 0, 0, 0, 0));
  // little lid lip detail
  const boxLid = rbox(0.74, 0.12, 0.82, 0xdcc890, 0.06);
  g.add(at(boxLid, -0.85, 2.36, 0, 0, 0, 0));

  // --- Wheels: fat dark tires, tan hubs (center y === tireR so they rest on y=0) ---
  const frontWheel = wheel(0.5, 0.34, 0x2b2725, 0xc9a37a, { hubR: 0.18, knobby: true });
  g.add(at(frontWheel, 1.0, 0.5, 0));
  const rearWheel = wheel(0.5, 0.34, 0x2b2725, 0xc9a37a, { hubR: 0.18, knobby: true });
  g.add(at(rearWheel, -0.95, 0.5, 0));

  return g;
}

function buildDirtBike() {
  const g = new THREE.Group();
  const ORANGE = 0xf39320, BLACK = 0x2a2a2c, GRAY = 0x8a8a8e;

  // --- Wheels (big knobby, gray spoke hubs) rest on y=0 at center y=R ---
  const R = 0.68;
  const frontWheel = wheel(R, 0.34, BLACK, 0xb9b9bd, { knobby: true, spokes: true });
  const rearWheel  = wheel(R, 0.34, BLACK, 0xb9b9bd, { knobby: true, spokes: true });
  g.add(at(frontWheel,  1.35, R, 0));
  g.add(at(rearWheel,  -1.35, R, 0));

  // --- Front forks: two parallel gray tubes from headstem down to front wheel ---
  const forkLen = 1.5;
  g.add(at(tube(forkLen, 0.07, GRAY),  1.18, R + 0.55,  0.16, 0, 0, -28));
  g.add(at(tube(forkLen, 0.07, GRAY),  1.18, R + 0.55, -0.16, 0, 0, -28));
  // Headstem hub where forks meet (axis along Z, lined up over the forks)
  g.add(at(cyl(0.1, 0.1, 0.4, GRAY), 1.18, R + 1.15, 0, 90, 0, 0));

  // --- Engine block: gray boxy lump low in the middle ---
  g.add(at(rbox(0.85, 0.7, 0.55, GRAY, 0.14), -0.1, R + 0.1, 0));

  // --- Swingarm tube to rear wheel ---
  g.add(at(tube(1.3, 0.07, GRAY), -0.75, R + 0.18, 0.18, 0, 0, 78));

  // --- Main frame backbone (gray) tying headstem to tail ---
  g.add(at(tube(1.9, 0.08, GRAY), 0.25, R + 0.85, 0, 0, 0, 70));

  // --- Fuel tank: orange rounded, mid-upper ---
  g.add(at(rbox(0.95, 0.55, 0.65, ORANGE, 0.22), 0.35, R + 0.95, 0));

  // --- Seat: black long flat, rising slightly to tail ---
  g.add(at(rbox(1.45, 0.22, 0.5, BLACK, 0.1), -0.55, R + 1.0, 0, 0, 0, 7));

  // --- Rear fender / tail: orange, kicks UP at the back ---
  g.add(at(rbox(1.0, 0.18, 0.55, ORANGE, 0.16), -1.35, R + 1.25, 0, 0, 0, 22));
  // Tail tip flourish
  g.add(at(rbox(0.4, 0.15, 0.5, ORANGE, 0.14), -1.85, R + 1.5, 0, 0, 0, 30));

  // --- Front fender: orange over front wheel ---
  g.add(at(rbox(0.8, 0.16, 0.5, ORANGE, 0.16), 1.45, R + 0.62, 0, 0, 0, -10));

  // --- Front number plate: orange rounded rect, tilted, front above wheel ---
  g.add(at(rbox(0.55, 0.6, 0.12, ORANGE, 0.2), 1.55, R + 1.0, 0, 0, 0, 22));

  // --- Handlebar: gray bar high above forks (axis along Z) ---
  g.add(at(tube(0.95, 0.05, GRAY), 1.1, R + 1.35, 0, 90, 0, 0));
  // Stem riser connecting bar to headstem
  g.add(at(tube(0.3, 0.05, GRAY), 1.14, R + 1.25, 0));
  // Dark grips on the bar ends (axis along Z, matching the bar)
  g.add(at(tube(0.22, 0.07, BLACK), 1.1, R + 1.35,  0.5, 90, 0, 0));
  g.add(at(tube(0.22, 0.07, BLACK), 1.1, R + 1.35, -0.5, 90, 0, 0));

  // --- Exhaust pipe: gray cylinder running back along the side ---
  g.add(at(cyl(0.09, 0.11, 1.1, GRAY), -0.9, R + 0.35, 0.28, 0, 0, 82));

  return g;
}

function buildSportBike() {
  const g = new THREE.Group();
  const ORANGE = 0xe8842a, DARK = 0x3c3a3e, BLACK = 0x2a2a2c, GRAY = 0x9a9a9e;

  // ---- Wheels: low stance, radius 0.6, thin spokes (center y = tireR = 0.6) ----
  g.add(at(wheel(0.6, 0.32, BLACK, GRAY, { spokes: 5 }), -1.18, 0.6, 0));
  g.add(at(wheel(0.6, 0.32, BLACK, GRAY, { spokes: 5 }),  1.28, 0.6, 0));

  // ---- Main body: long low dark mass (tank + belly fused), sleek ----
  g.add(at(rbox(2.5, 0.55, 0.55, DARK, 0.24), 0.0, 0.98, 0));
  g.add(at(rbox(1.7, 0.4, 0.46, DARK, 0.18), 0.25, 0.66, 0, 0, 0, -4)); // belly pan
  g.add(at(rbox(0.95, 0.42, 0.58, DARK, 0.24), 0.0, 1.28, 0));          // tank hump

  // ---- Seat (black) ----
  g.add(at(rbox(0.85, 0.16, 0.46, BLACK, 0.1), -0.7, 1.2, 0, 0, 0, 3));

  // ---- FRONT FAIRING: orange, elongated swoop down toward the front wheel ----
  g.add(at(rbox(1.15, 0.66, 0.6, ORANGE, 0.28), 1.12, 1.12, 0, 0, 0, 26)); // angled nose
  g.add(at(rbox(0.78, 0.6, 0.5, ORANGE, 0.22), 1.5, 0.82, 0, 0, 0, 44));   // rounded lower cowl (no cone)
  g.add(at(rbox(0.16, 0.3, 0.4, 0xefe2d2, 0.1), 1.64, 1.18, 0, 0, 0, 26)); // headlight patch
  // small windscreen, tilted back
  g.add(at(rbox(0.1, 0.34, 0.42, 0xc8c8d0, 0.05, { opacity: 0.5 }), 1.28, 1.55, 0, 0, 0, 42));

  // ---- REAR seat cowl: orange, small rising tail (rounded, gentle point) ----
  g.add(at(rbox(0.8, 0.4, 0.4, ORANGE, 0.2), -1.02, 1.34, 0, 0, 0, 18));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 16), mat(ORANGE));
  g.add(at(tip, -1.46, 1.46, 0, 0, 0, 102)); // small tip pointing back, slightly up

  // ---- Front fork + low clip-on grips ----
  g.add(at(tube(0.85, 0.06, GRAY), 1.36, 0.95, 0, 0, 0, -22));
  g.add(at(tube(0.26, 0.05, BLACK), 1.12, 1.36, 0.32, 90, 0, 0));
  g.add(at(tube(0.26, 0.05, BLACK), 1.12, 1.36, -0.32, 90, 0, 0));

  // ---- Exhaust: small dark cylinder low on the side, toward the back ----
  g.add(at(cyl(0.1, 0.11, 0.7, DARK), -0.9, 0.6, -0.32, 0, 0, 90));

  return g;
}

function buildWheelbarrow() {
  const g = new THREE.Group();

  // ----- Single front wheel (at +X, front-bottom). center y === tireR (0.5) so it rests on y=0 -----
  const w = wheel(0.5, 0.34, 0x2e2a28, 0xf2a024); // black tire, orange hub
  g.add(at(w, 1.45, 0.5, 0));

  // ----- Orange TUB (wider at top than bottom), tilted slightly nose-down -----
  const tub = new THREE.Group();
  const tubBody = rbox(1.7, 0.8, 1.4, 0xe0552e, 0.22); // main bucket
  tub.add(at(tubBody, 0, 0, 0));
  // taper: a smaller box tucked under for a narrower-bottom feel
  const tubBottom = rbox(1.3, 0.3, 1.0, 0xe0552e, 0.2);
  tub.add(at(tubBottom, 0, -0.42, 0));
  // recessed darker inset on top face -> hollow look
  const tubInset = rbox(1.5, 0.18, 1.2, 0xc0461f, 0.16);
  tub.add(at(tubInset, 0, 0.34, 0));
  g.add(at(tub, 0.35, 1.05, 0, 0, 0, -7)); // tilt nose-down toward wheel

  // ----- Frame: light gray-beige tubes -----
  const fHex = 0xc9c4b4;

  // Two short rails reaching FORWARD to the wheel axle (left & right of wheel)
  const fwdL = tube(1.1, 0.06, fHex);
  g.add(at(fwdL, 1.0, 0.62, 0.32, 0, 0, 70));
  const fwdR = tube(1.1, 0.06, fHex);
  g.add(at(fwdR, 1.0, 0.62, -0.32, 0, 0, 70));

  // Two long handle rails: from under the tub back and UP to the grips (behind, -X, raised)
  const railL = tube(2.6, 0.07, fHex);
  g.add(at(railL, -0.65, 0.95, 0.42, 0, 0, 78));
  const railR = tube(2.6, 0.07, fHex);
  g.add(at(railR, -0.65, 0.95, -0.42, 0, 0, 78));

  // Pair of LEGS / stand going down at the back so the barrow rests level (bottoms reach ~y=0)
  const legL = tube(0.85, 0.06, fHex);
  g.add(at(legL, -0.55, 0.42, 0.42));
  const legR = tube(0.85, 0.06, fHex);
  g.add(at(legR, -0.55, 0.42, -0.42));
  // little feet pads on the ground
  g.add(at(rbox(0.22, 0.12, 0.22, fHex, 0.06), -0.55, 0.06, 0.42));
  g.add(at(rbox(0.22, 0.12, 0.22, fHex, 0.06), -0.55, 0.06, -0.42));

  // ----- Two GRIPS: orange crossbar caps on the raised back handle ends -----
  const gripL = tube(0.4, 0.09, 0xf2a024);
  g.add(at(gripL, -1.6, 1.32, 0.42, 90, 0, 0));
  const gripR = tube(0.4, 0.09, 0xf2a024);
  g.add(at(gripR, -1.6, 1.32, -0.42, 90, 0, 0));

  return g;
}

export { buildScooter, buildDirtBike, buildSportBike, buildWheelbarrow };

export const VEHICLES = [
  { key: 'scooter',     name: '배달 스쿠터',  build: buildScooter },
  { key: 'dirtbike',    name: '더트바이크',    build: buildDirtBike },
  { key: 'sportbike',   name: '스포츠바이크',  build: buildSportBike },
  { key: 'wheelbarrow', name: '손수레',        build: buildWheelbarrow },
];

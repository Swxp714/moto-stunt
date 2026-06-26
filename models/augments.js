// MOTO STUNT — 레전드 정규전 (Legend Ranked) augment system.
// Pure data + resolver. ZERO THREE.js, ZERO DOM imports. See docs/LEGEND_MODE.md §6.
//
// CONTRACT (downstream integrates against this — do not break):
//   augment = { id, name(ko), tier:'silver'|'gold'|'prismatic', desc(ko,≤14),
//               icon(single emoji), apply(m, ctx) }  — apply() MUTATES mods `m`.
//   ctx = { vehicle, mode }  — pass-through, unused in MVP.
//
//   DEFAULT_MODS — the ONLY fields downstream reads. Do NOT add fields here.
//   resolveMods(ownedIds, vehicle, mode) → fresh DEFAULT_MODS clone with each
//     owned augment applied, in tier order (silver→gold→prismatic) then array order.
//   offerAugments(ownedIds, count, rng) → `count` distinct un-owned augments,
//     tier-weighted (silver 70 / gold 26 / prismatic 4). Seedable via `rng`.
//   botPickAugment(ownedIds, rng) → one un-owned augment id (offer 3, pick one).

export const DEFAULT_MODS = {
  speedMul: 1, turnMul: 1, wheelieMul: 1, maxPitchMul: 1, trailMul: 1,
  boostDurAdd: 0, shieldDurAdd: 0, invulnAdd: 0,
  killEveryDelta: 0, deathEveryDelta: 0, startItem: null,
};

// tier roll weights — used by offerAugments / botPickAugment
const TIER_WEIGHT = { silver: 70, gold: 26, prismatic: 4 };
// stable resolve order: silver effects first, then gold, then prismatic
const TIER_RANK = { silver: 0, gold: 1, prismatic: 2 };

export const AUGMENTS = [
  // --- Silver (은장) ---
  { id: 'M3', name: '가속 본능', tier: 'silver', desc: '속도 +6%', icon: '⚡',
    apply(m) { m.speedMul *= 1.06; } },
  { id: 'M1', name: '민첩', tier: 'silver', desc: '회전 +12%', icon: '🌀',
    apply(m) { m.turnMul *= 1.12; } },
  { id: 'M2', name: '윌리 감각', tier: 'silver', desc: '윌리한계 +15%', icon: '🛞',
    apply(m) { m.maxPitchMul *= 1.15; } },
  { id: 'O2', name: '장벽 본능', tier: 'silver', desc: '트레일 +20%', icon: '🧱',
    apply(m) { m.trailMul *= 1.20; } },
  { id: 'D1', name: '두꺼운 가죽', tier: 'silver', desc: '무적 +0.8초', icon: '🦏',
    apply(m) { m.invulnAdd += 0.8; } },
  { id: 'D2', name: '방어막 강화', tier: 'silver', desc: '실드 +1.5초', icon: '🧰',
    apply(m) { m.shieldDurAdd += 1.5; } },
  { id: 'I1', name: '손버릇', tier: 'silver', desc: '킬아이템 빨리', icon: '✋',
    apply(m) { m.killEveryDelta -= 1; } },
  { id: 'I2', name: '근성', tier: 'silver', desc: '데스아이템 빨리', icon: '💢',
    apply(m) { m.deathEveryDelta -= 1; } },

  // --- Gold (금장) ---
  { id: 'M5', name: '윌리 폭주', tier: 'gold', desc: '윌리속도 +12%', icon: '🔥',
    apply(m) { m.wheelieMul *= 1.12; } },
  { id: 'M6', name: '드리프트 킹', tier: 'gold', desc: '회전+18% 속도+5%', icon: '🏁',
    apply(m) { m.turnMul *= 1.18; m.speedMul *= 1.05; } },
  { id: 'D5', name: '수호 출발', tier: 'gold', desc: '시작 실드 보유', icon: '🛡️',
    apply(m) { m.startItem = 'shield'; } },
  { id: 'I5', name: '창고', tier: 'gold', desc: '시작 부스트 보유', icon: '💨',
    apply(m) { m.startItem = 'boost'; } },

  // --- Prismatic (무지개) ---
  { id: 'M7', name: '로켓 스타트', tier: 'prismatic', desc: '속도·윌리+15% 회전-8%', icon: '🚀',
    apply(m) { m.speedMul *= 1.15; m.wheelieMul *= 1.15; m.turnMul *= 0.92; } },
  { id: 'I8', name: '한탕', tier: 'prismatic', desc: '시작 SUPER 보유', icon: '💥',
    apply(m) { m.startItem = 'super'; } },
];

export const AUG_MAP = Object.fromEntries(AUGMENTS.map(a => [a.id, a]));

// fresh clone so callers never share/mutate the canonical default
function cloneDefault() { return { ...DEFAULT_MODS }; }

// resolve owned augments into a mods object. Tier order (silver→gold→prismatic),
// then AUGMENTS array order, so stacking is deterministic. Unknown ids ignored.
export function resolveMods(ownedIds, vehicle, mode) {
  const m = cloneDefault();
  const ctx = { vehicle, mode };
  const owned = (ownedIds || [])
    .map(id => AUG_MAP[id])
    .filter(Boolean)
    .sort((a, b) =>
      (TIER_RANK[a.tier] - TIER_RANK[b.tier]) ||
      (AUGMENTS.indexOf(a) - AUGMENTS.indexOf(b)));
  for (const a of owned) a.apply(m, ctx);
  return m;
}

// Fisher–Yates shuffle using the supplied rng (seedable).
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// weighted pick (by tier) of one item from `pool`; returns its index.
function weightedPick(pool, rng) {
  const total = pool.reduce((s, a) => s + (TIER_WEIGHT[a.tier] || 1), 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= TIER_WEIGHT[pool[i].tier] || 1;
    if (r < 0) return i;
  }
  return pool.length - 1;
}

// offer `count` DISTINCT un-owned augments, tier-weighted. Never owned, never dup.
// Returns all remaining (shuffled) if fewer than `count` un-owned exist.
export function offerAugments(ownedIds, count = 3, rng = Math.random) {
  const owned = new Set(ownedIds || []);
  let pool = AUGMENTS.filter(a => !owned.has(a.id));
  if (pool.length <= count) return shuffle(pool, rng);
  const out = [];
  while (out.length < count && pool.length) {
    const i = weightedPick(pool, rng);
    out.push(pool[i]);
    pool = pool.slice(0, i).concat(pool.slice(i + 1));
  }
  return out;
}

// bot draft: offer 3 un-owned augments, pick one (id). Simple + deterministic via rng.
export function botPickAugment(ownedIds, rng = Math.random) {
  const offer = offerAugments(ownedIds, 3, rng);
  if (!offer.length) return null;
  return offer[Math.floor(rng() * offer.length)].id;
}

// --- self-test (uncomment to verify) --------------------------------------
// resolveMods(['M7','M3']).speedMul === 1.15 * 1.06 ≈ 1.218
// const __m = resolveMods(['M7', 'M3']);
// console.assert(Math.abs(__m.speedMul - 1.218) < 1e-9, `got ${__m.speedMul}`);
// console.log('resolveMods([M7,M3]).speedMul =', __m.speedMul);  // → 1.2189999999999999

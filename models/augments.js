// MOTO STUNT — 레전드 정규전 (Legend Ranked) augment system.
// Pure data + resolver. ZERO THREE.js, ZERO DOM imports. See docs/LEGEND_MODE.md §6.
// Augments are named after REAL famous motorcycle parts/brands. Each bike also has its
// own EXCLUSIVE augment (the `veh` field) that only appears in that vehicle's offers.
//
// CONTRACT (downstream integrates against this — do not break):
//   augment = { id, name(ko), tier:'silver'|'gold'|'prismatic', desc(ko), icon?(emoji),
//               veh?:'scooter'|'dirtbike'|'sportbike'|'wheelbarrow', apply(m, ctx) }
//   DEFAULT_MODS — the ONLY fields downstream reads. resolveMods clones + applies owned.
//   offerAugments(ownedIds, count, rng, vehicle) → distinct un-owned, vehicle-legal, tier-weighted.

export const DEFAULT_MODS = {
  speedMul: 1, turnMul: 1, wheelieMul: 1, maxPitchMul: 1, trailMul: 1,
  boostDurAdd: 0, shieldDurAdd: 0, invulnAdd: 0, killEveryDelta: 0, deathEveryDelta: 0,
  boostMul: 0,                         // extra boost-speed bonus while boosting (아크라포빅)
  jumpHeightMul: 1, jumpTimeMul: 1,    // jump arc scaling
  startItem: null,                     // item held at round start
  chainBoost: false,                   // kill -> short boost (DID 체인)
  reviveOnce: false,                   // first death each round costs 0 lives (케블라)
  jumpFlip: false,                     // jump-pad launch does a 360 backflip (모토크로스 킷)
  plantMine: false,                    // using an item also plants a 새싹 지뢰 (손수레 지뢰 농부)
};

const TIER_WEIGHT = { silver: 70, gold: 26, prismatic: 4 };
const TIER_RANK = { silver: 0, gold: 1, prismatic: 2 };

export const AUGMENTS = [
  // ===== Shared pool — famous motorcycle parts =====
  { id: 'akra',    name: '아크라포빅',    tier: 'gold',      desc: '부스트 시 속도 +50%', icon: '🔥',
    apply(m) { m.boostMul += 0.5; } },
  { id: 'brembo',  name: '브렘보 캘리퍼',  tier: 'silver',    desc: '회전 +15%', icon: '🛑',
    apply(m) { m.turnMul *= 1.15; } },
  { id: 'ohlins',  name: '올린즈 서스펜션', tier: 'silver',    desc: '윌리 한계 +20%', icon: '🟡',
    apply(m) { m.maxPitchMul *= 1.20; } },
  { id: 'pirelli', name: '피렐리 타이어',   tier: 'silver',    desc: '회전+12% 속도+4%', icon: '🛞',
    apply(m) { m.turnMul *= 1.12; m.speedMul *= 1.04; } },
  { id: 'carbon',  name: '카본 파이버',    tier: 'silver',    desc: '속도+6% 회전+6%', icon: '🏁',
    apply(m) { m.speedMul *= 1.06; m.turnMul *= 1.06; } },
  { id: 'winglet', name: '에어로 윙렛',    tier: 'silver',    desc: '트레일 +25%', icon: '🪽',
    apply(m) { m.trailMul *= 1.25; } },
  { id: 'nos',     name: 'NOS 나이트로',   tier: 'gold',      desc: '시작 부스트 + 부스트 +30%', icon: '💨',
    apply(m) { m.startItem = 'boost'; m.boostMul += 0.3; } },
  { id: 'marche',  name: '마르케시니 휠',  tier: 'gold',      desc: '회전+20% 속도+6%', icon: '⚙️',
    apply(m) { m.turnMul *= 1.20; m.speedMul *= 1.06; } },
  { id: 'did',     name: 'DID 레이싱 체인', tier: 'gold',      desc: '킬 시 2초 부스트', icon: '⛓️',
    apply(m) { m.chainBoost = true; } },
  { id: 'turbo',   name: '터보차저',       tier: 'prismatic', desc: '속도·윌리 +18%', icon: '🌀',
    apply(m) { m.speedMul *= 1.18; m.wheelieMul *= 1.18; } },
  { id: 'kevlar',  name: '케블라 슈트',    tier: 'prismatic', desc: '첫 죽음 무효 (라운드당)', icon: '🦺',
    apply(m) { m.reviveOnce = true; } },

  // ===== Vehicle-EXCLUSIVE (only offered for that bike) =====
  { id: 'dirt_flip',     veh: 'dirtbike',    name: '모토크로스 킷',  tier: 'prismatic', desc: '점프대 = 더 높이 + 백플립', icon: '🏍️',
    apply(m) { m.jumpFlip = true; m.jumpHeightMul *= 1.5; m.jumpTimeMul *= 1.4; } },
  { id: 'sport_aero',    veh: 'sportbike',   name: '레이스 페어링',  tier: 'prismatic', desc: '속도 +22%', icon: '🏎️',
    apply(m) { m.speedMul *= 1.22; } },
  { id: 'scoot_courier', veh: 'scooter',     name: '퀵서비스 킷',    tier: 'prismatic', desc: '아이템 빨리 + 시작 부스트', icon: '🛵',
    apply(m) { m.killEveryDelta -= 1; m.deathEveryDelta -= 1; m.startItem = 'boost'; } },
  { id: 'barrow_cargo',  veh: 'wheelbarrow', name: '강화 적재함',    tier: 'prismatic', desc: '아이템 지속 2배 + 시작 SUPER', icon: '🛒',
    apply(m) { m.boostDurAdd += 3; m.shieldDurAdd += 3; m.startItem = 'super'; } },
  { id: 'barrow_mine',   veh: 'wheelbarrow', name: '지뢰 농부',      tier: 'gold',      desc: '아이템 사용 시 바닥에 새싹 지뢰', icon: '🌱',
    apply(m) { m.plantMine = true; } },
];

export const AUG_MAP = Object.fromEntries(AUGMENTS.map(a => [a.id, a]));

function cloneDefault() { return { ...DEFAULT_MODS }; }

// resolve owned augments into a mods object. Tier order then array order (deterministic).
export function resolveMods(ownedIds, vehicle, mode) {
  const m = cloneDefault();
  const ctx = { vehicle, mode };
  const owned = (ownedIds || [])
    .map(id => AUG_MAP[id]).filter(Boolean)
    .sort((a, b) => (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || (AUGMENTS.indexOf(a) - AUGMENTS.indexOf(b)));
  for (const a of owned) a.apply(m, ctx);
  return m;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function weightedPick(pool, rng) {
  const total = pool.reduce((s, a) => s + (TIER_WEIGHT[a.tier] || 1), 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) { r -= TIER_WEIGHT[pool[i].tier] || 1; if (r < 0) return i; }
  return pool.length - 1;
}

// is this augment legal to offer to `vehicle`? shared augments (no veh) always; exclusives only to their bike.
function legalFor(a, vehicle) { return !a.veh || a.veh === vehicle; }

// offer `count` DISTINCT un-owned augments legal for `vehicle`, tier-weighted.
export function offerAugments(ownedIds, count = 3, rng = Math.random, vehicle) {
  const owned = new Set(ownedIds || []);
  let pool = AUGMENTS.filter(a => !owned.has(a.id) && legalFor(a, vehicle));
  if (pool.length <= count) return shuffle(pool, rng);
  const out = [];
  while (out.length < count && pool.length) {
    const i = weightedPick(pool, rng);
    out.push(pool[i]);
    pool = pool.slice(0, i).concat(pool.slice(i + 1));
  }
  return out;
}

// bot draft: offer 3 (vehicle-legal), pick one id.
export function botPickAugment(ownedIds, rng = Math.random, vehicle) {
  const offer = offerAugments(ownedIds, 3, rng, vehicle);
  if (!offer.length) return null;
  return offer[Math.floor(rng() * offer.length)].id;
}

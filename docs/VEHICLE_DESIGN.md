# VEHICLE_DESIGN.md — Kart Roster Balance Proposal

> **Status: PROPOSAL.** No code is changed by this doc. It defines 4 distinct
> vehicle identities mapped to the *actual* tunables in `src/config.js`,
> `src/deathmatch.js`, and `src/main.js` (`createWorld`). Review before implementing.

Today all 4 karts play identically — they only differ in the 3D model. Every
rider reads the same globals: `DM.moveSpeed`, `DM.turnRate`, `DM.wheelieMul`,
`CFG.maxPitch`, `CFG.baseSpeed`, `CFG.steerSpeed`, etc. This proposal adds a small
per-vehicle **multiplier table** that scales those globals, so the scooter stays
the literal baseline (all ×1.0) and the other three trade off around it.

**Design rule:** deltas stay small (mostly 0.85–1.20) so the game stays balanced
and any single number is easy to walk back. The scooter is the tuning anchor —
if the roster feels off, re-center everyone toward scooter first.

---

## 0. The tunables each stat maps to (so every number is implementable)

| Proposed stat key | Scales this real global | Read site (deathmatch) | Read site (racing) |
|---|---|---|---|
| `moveSpeed` | `DM.moveSpeed` | `deathmatch.js` `makeRider` (init `r.speed`), `respawnRider`, and `r.speed = DM.moveSpeed * …` in `update` (~L458) | — (racing uses `baseSpeed`) |
| `baseSpeed` | `CFG.baseSpeed` | — | `main.js` `update` L302–304 (`target = CFG.baseSpeed * …`), `reset`/`respawn` |
| `turnRate` | `DM.turnRate` | `deathmatch.js` `update` L459 (`r.heading += steer * DM.turnRate * dt`) | — |
| `steerSpeed` | `CFG.steerSpeed` | — | `main.js` `update` L292 (`game.laneX += steer * CFG.steerSpeed * dt`) |
| `maxPitch` | `CFG.maxPitch` (wheelie flip cap) | `update` L456 (`r.pitch > CFG.maxPitch → flip`), bot flip-guard L184/L194 | `update` L300 (`game.pitch > CFG.maxPitch → crash`) |
| `wheelieMul` | `DM.wheelieMul` (DM wheelie speed boost) | `update` L458 speed formula | — |
| `wheelieSpeedMul` | `CFG.wheelieSpeedMul` (racing wheelie boost) | — | `update` L302 boost formula |
| `itemRate` | item cadence (kills/deaths thresholds + interval) | `applyDeath` L353 / L356 (`% 2`, `% 3`), `grantItems` interval `DM.itemInterval` | — |
| `trailMul` | `DM.trailMax` (tail length cap) | `addSeg` L100 (`r.trailSegs.length > DM.trailMax`) | — |

> Everything above is a **multiplier on an existing global**. No new mechanics,
> no new physics — just per-rider scaling of knobs that already exist.

---

## 1. Per-vehicle profile table (modifiers vs. SCOOTER baseline = ×1.0)

All values are **multipliers** unless noted. Scooter is the anchor (all ×1.0).

| Stat → global | 🛵 스쿠터 (scooter) | 🏍️ 더트바이크 (dirtbike) | 🏎️ 스포츠바이크 (sportbike) | 🛒 손수레 (wheelbarrow) |
|---|:---:|:---:|:---:|:---:|
| `moveSpeed` (DM `DM.moveSpeed`) | **1.00** | 0.97 | **1.12** | 0.85 |
| `baseSpeed` (race `CFG.baseSpeed`) | **1.00** | 0.97 | **1.12** | 0.85 |
| `turnRate` (DM `DM.turnRate`) | **1.00** | 1.10 | **0.82** | 1.05 |
| `steerSpeed` (race `CFG.steerSpeed`) | **1.00** | 1.10 | **0.82** | 1.05 |
| `maxPitch` (wheelie flip cap) | **1.00** | **1.50** | 0.90 | 0.80 |
| `wheelieMul` (DM boost `DM.wheelieMul`) | **1.00** | **1.15** | 1.05 | 0.90 |
| `wheelieSpeedMul` (race boost `CFG.wheelieSpeedMul`) | **1.00** | **1.15** | 1.05 | 0.90 |
| `itemRate` (item cadence) | **1.00** | 1.00 | 0.90 | **1.50** |
| `trailMul` (DM tail length `DM.trailMax`) | **1.00** | 0.95 | **1.15** | 0.80 |

### What the concrete numbers come out to

Resolving the multipliers against today's globals (scooter values shown for context):

| Resolved value | scooter | dirtbike | sportbike | wheelbarrow |
|---|:---:|:---:|:---:|:---:|
| DM `moveSpeed` (base 34) | 34.0 | 33.0 | 38.1 | 28.9 |
| Race `baseSpeed` (base 60) | 60.0 | 58.2 | 67.2 | 51.0 |
| DM `turnRate` (base 2.6) | 2.60 | 2.86 | 2.13 | 2.73 |
| Race `steerSpeed` (base 22) | 22.0 | 24.2 | 18.0 | 23.1 |
| `maxPitch` (base 1.0) | 1.00 | **1.50** | 0.90 | 0.80 |
| DM `wheelieMul` (base 2.4) | 2.40 | 2.76 | 2.52 | 2.16 |
| Race `wheelieSpeedMul` (base 2.3) | 2.30 | 2.65 | 2.42 | 2.07 |
| DM `trailMax` (base 55) | 55 | 52 | 63 | 44 |
| Item cadence (see §4 `itemRate`) | kills 3 / deaths 2 / 20s | 3 / 2 / 20s | 4 / 2 / 22s | **2 / 1 / 13s** |

**Sportbike top wheelie speed** (DM): `38.1 × (1 + (2.52−1)×1.0) = 96` vs scooter `34 × 2.4 = 82`.
**Dirtbike top wheelie speed** (DM): `33 × (1 + (2.76−1)×1.0) = 91`, but it can hold the
wheelie *higher and longer* before flipping (maxPitch 1.5), so it spends more time
near peak and pops jump arcs better. That is the "윌리 150%" feel, expressed as a
`maxPitch` cap rather than a raw speed number.

---

## 2. Identities — pros / cons / who it's for

### 🛵 배달 스쿠터 — "The Honest Baseline"
**Identity:** Everything at ×1.0. The yardstick the others are measured against.
- **Pros:** No weakness; predictable; easiest wheelie control (flips exactly at the cap you learn first); great for learning the trail-dodging.
- **Cons:** No standout strength; loses straight drags to sportbike, loses jump/wheelie duels to dirtbike, loses the item war to wheelbarrow.
- **For:** New players, and anyone who wants pure skill expression with zero stat crutch. *"딱 중간 감성."*

### 🏍️ 산악 더트바이크 — "The Wheelie King"
**Identity:** `maxPitch ×1.5` — can wheelie ~50% higher before flipping, plus a stronger wheelie boost. Owns the wheelie-speed mechanic and jump pads.
- **Pros:** Huge wheelie ceiling = more uptime in the wheelie speed-zone (`wheelieMul`/`wheelieSpeedMul` boosted too); best at jump pads and clearing trail walls mid-air; sharpest turning of the bikes (`turnRate ×1.10`) so it can wheelie *and* weave.
- **Cons:** Slightly slower flat-out (`moveSpeed ×0.97`); the high cap is a double-edged sword — *easier to actually flip* if you over-hold (the failure state is more available, even if the cap is higher); rewards skill, punishes mashing.
- **For:** Aggressive players who live on the wheelie mechanic and jump pads, and want the highest skill ceiling. *"윌리가 150%까지."*

### 🏎️ 스포츠바이크 — "The Straight-Line Demon"
**Identity:** `baseSpeed / moveSpeed ×1.12` — fastest in a straight line, but turns like a boat.
- **Pros:** Highest top speed (best in racing and for outrunning/chasing in DM); longest trail (`trailMul ×1.15`) so it can wall off larger zones; low, slightly lower wheelie cap keeps it stable on the straights.
- **Cons:** Worst turning (`turnRate/steerSpeed ×0.82`) — clumsy in tight arena scraps and slow chicanes; long trail is also a longer self-collision risk; gets fewer items (`itemRate ×0.90`).
- **For:** Players who win on raw pace and open-arena kiting, and can plan turns early. *"기본 속도가 더 빠름."*

### 🛒 손수레 — "The Loot Goblin"
**Identity:** `itemRate ×1.5` — earns items roughly twice as fast (lower kill/death thresholds + shorter interval). Slow and clunky to pay for it.
- **Pros:** Gets `boost`/`shield`/`super` constantly — comeback machine and item-spam disruptor; turning is fine (`turnRate ×1.05`); short trail (`trailMul ×0.80`) means low self-collision risk.
- **Cons:** Slowest base speed (`×0.85`) and weakest wheelie (`maxPitch ×0.80`, `wheelieMul ×0.90`) — bad at the speed game and jumps; can't capitalize on an item lead with raw mobility; short trail = poor at zoning.
- **For:** Chaos players who want a steady item firehose and don't mind being outrun. *"아이템을 막 개많이 먹는 느낌."*

---

## 3. Balance rationale — the tradeoff triangle (no single best pick)

The four form a **rock-paper-scissors-ish loop** on two axes — *Speed*, *Agility/Wheelie*,
and *Items* — with scooter sitting dead-center as the neutral reference.

```
                 SPEED (sportbike)
                      ▲
                      │   sportbike outruns wheelbarrow,
                      │   but can't corner with dirtbike
        ITEMS ◀───────┼───────▶ AGILITY / WHEELIE
     (wheelbarrow)    │            (dirtbike)
                      │   dirtbike out-jumps/out-turns sportbike,
                      ▼   but wheelbarrow's item-spam grinds it down
                 (scooter = center, no axis dominates)
```

**Deathmatch loop:**
- **Sportbike beats wheelbarrow:** raw speed kites the slow barrow; the barrow can't close distance to use its items offensively (bots `useItem` boost-to-close at `pd > 26`, but the barrow's `moveSpeed ×0.85` makes the chase stall).
- **Dirtbike beats sportbike:** the arena is a turning fight; sportbike's `turnRate ×0.82` and longer self-trail get punished in tight scraps, while dirtbike weaves + uses jump pads to escape/ambush.
- **Wheelbarrow beats dirtbike:** the item firehose (`shield`/`super` body-checks via the ram-kill at L480–483) wears down a dirtbike that relies on mechanical skill over item economy.
- **Scooter beats no one and loses to no one hard** — it's a coin-flip vs each, won on player skill, which is exactly the "all-rounder" promise.

**Racing loop** (only `baseSpeed`, `steerSpeed`, `wheelieSpeedMul`, `maxPitch` apply — no items, no trails):
- Sportbike wins **wide straights** (top speed) but loses time fighting `steerSpeed ×0.82` on the lane-weave around obstacles.
- Dirtbike wins **obstacle-dense / wheelie-heavy** stretches: maxPitch 1.5 lets it sit in the wheelie boost zone longer without crashing (race crash at L300), and tighter steering dodges obstacles cleanly.
- Scooter is the consistent mid-pack metronome.
- Wheelbarrow is intentionally the *racing underdog* (items don't exist in racing) — see risk R4 for the lever to keep it from being strictly worse.

The key property: **every vehicle is the best at exactly one thing and the worst
at exactly one thing**, and scooter is best/worst at nothing — so there's no
dominant pick, only matchup- and map-dependent picks.

---

## 4. Implementation note (minimal, data-driven)

### Where the data lives
Add a `stats` object to each entry in `models/vehicles.js` `VEHICLES[]` (the file
already owns per-vehicle data like `seat`/`disp`, so stats belong here too).
Scooter's stats are all `1` and act as the documented baseline.

```js
// models/vehicles.js — append `stats` to each VEHICLES entry (multipliers vs scooter)
export const VEHICLES = [
  { key: 'scooter', name: '배달 스쿠터', build: buildScooter, seat: {…},
    stats: { speed: 1.00, turn: 1.00, maxPitch: 1.00, wheelie: 1.00, item: 1.00, trail: 1.00 } },
  { key: 'dirtbike', name: '더트바이크', build: buildDirtBike, seat: {…},
    stats: { speed: 0.97, turn: 1.10, maxPitch: 1.50, wheelie: 1.15, item: 1.00, trail: 0.95 } },
  { key: 'sportbike', name: '스포츠바이크', build: buildSportBike, seat: {…},
    stats: { speed: 1.12, turn: 0.82, maxPitch: 0.90, wheelie: 1.05, item: 0.90, trail: 1.15 } },
  { key: 'wheelbarrow', name: '손수레', build: buildWheelbarrow, disp: 1.0, seat: {…},
    stats: { speed: 0.85, turn: 1.05, maxPitch: 0.80, wheelie: 0.90, item: 1.50, trail: 0.80 } },
];
```

> Note: `speed` covers BOTH `DM.moveSpeed` and `CFG.baseSpeed`; `turn` covers BOTH
> `DM.turnRate` and `CFG.steerSpeed`; `wheelie` covers BOTH `DM.wheelieMul` and
> `CFG.wheelieSpeedMul`. One stat → one global per mode. Keeps the table tiny (6 keys).

Helper (e.g. in `bike.js`, next to `VMAP`) so callers don't repeat the lookup:
```js
const DEFAULT_STATS = { speed: 1, turn: 1, maxPitch: 1, wheelie: 1, item: 1, trail: 1 };
export function vehStats(key) { return (VMAP[key] && VMAP[key].stats) || DEFAULT_STATS; }
```

### Where each mode reads it

**Deathmatch — `src/deathmatch.js`:**
- In `makeRider(def, idx)` (~L65): resolve `const st = vehStats(def.vehicle)` and stash `r.st = st`. Also set `r.trailCap = Math.round(DM.trailMax * st.trail)`.
- `makeRider` init + `respawnRider` (L318): `r.speed = DM.moveSpeed * r.st.speed`.
- Speed formula (~L458): `r.speed = DM.moveSpeed * r.st.speed * (1 + (DM.wheelieMul * r.st.wheelie − 1) * Math.min(1, r.pitch / (CFG.maxPitch * r.st.maxPitch))) * (r.boost > 0 ? 1.6 : 1)`.
- Turn (~L459): `r.heading += steer * DM.turnRate * r.st.turn * dt`.
- Flip cap (~L456): `if (r.pitch > CFG.maxPitch * r.st.maxPitch && !airborne) …`. Mirror the same `* r.st.maxPitch` in the bot flip-guard (L184, L194) and the spark threshold (L500) so AI/VFX track the per-vehicle cap.
- Trail cap in `addSeg` (~L100): replace `DM.trailMax` with `r.trailCap`.
- **Item cadence (`item` stat)** in `applyDeath` (L353/L356): instead of fixed `% 2` / `% 3`, derive per-rivider thresholds once in `makeRider`:
  `r.killEvery = Math.max(1, Math.round(3 / st.item))` and `r.deathEvery = Math.max(1, Math.round(2 / st.item))`, then use `r.kills % r.killEvery === 0` / `r.deaths % r.deathEvery === 0`. (item 1.5 → kills every 2, deaths every 1; item 0.9 → kills every 3, deaths every 2.) Optionally scale the rank-item interval per rider, but keeping `grantItems`/`DM.itemInterval` global is simpler and lower-risk — start there.

**Racing — `src/main.js` `createWorld`:**
- The vehicle key already lives in `myChoice.vehicle` (set by `setVehicle`, L115). On vehicle swap, resolve `let st = vehStats(myChoice.vehicle)` into a `createWorld`-scope var (update it inside `setVehicle`).
- Steer (L292): `game.laneX += (input.steer || 0) * CFG.steerSpeed * st.turn * dt`.
- Wheelie cap / crash (L300): `if (game.pitch > CFG.maxPitch * st.maxPitch) triggerCrash()`. Mirror `* st.maxPitch` in the spark threshold (L324) and the wheelie-% HUD readout (L731, L737) so the gauge matches the real cap.
- Boost + base speed (L302–304):
  `const boost = 1 + (CFG.wheelieSpeedMul * st.wheelie − 1) * Math.min(1, game.pitch / (CFG.maxPitch * st.maxPitch))`,
  `const target = CFG.baseSpeed * st.speed * (game.pitch > 0.05 ? boost : 1)`.
- `reset`/`respawn` (L262/L283): `game.speed = CFG.baseSpeed * st.speed`.
- The `spF` speed-warp normalizer (L363) should divide by the per-vehicle range to keep the screen-warp consistent: `(game.speed − CFG.baseSpeed*st.speed) / (CFG.baseSpeed*st.speed * (CFG.wheelieSpeedMul*st.wheelie − 1))`.

**Total footprint:** ~6 lines of data + ~10 edited expressions, all multiplying an
existing global by one stat. No new systems, fully data-driven, trivially revertible
(set every stat to 1 → behavior is byte-for-byte the old game).

---

## 5. Balance risks + a tuning lever for each

| # | Risk | Why it could break | Tuning lever (the one knob to pull) |
|---|---|---|---|
| **R1** | **Wheelbarrow item-spam is OP** in score/DM — constant `super`/`shield` ram-kills snowball. | `item ×1.5` → `super` (shield+boost) every death; the ram-kill at L480 turns every item into a kill. | **Lower the `item` stat 1.5 → 1.25** first. If still strong, bias its rolls toward defensive items (`shield`/`boost`) over `super` in a wheelbarrow-aware `grantItem`. Its `speed ×0.85` is the built-in counter — don't buff that. |
| **R2** | **Sportbike is uncatchable** — `speed ×1.12` means nobody closes the gap to body-check it in DM. | Bots/players can't get in ram range; it kites forever. | **Trim `speed ×1.12 → 1.08`** and/or lean harder on its `turn ×0.82` so it *must* slow through arena turns. The long trail (`trail ×1.15`) is also a self-trap that punishes panic turns — keep that as the counterplay. |
| **R3** | **Dirtbike's maxPitch 1.5 becomes a pure upside** if players never actually flip. | If flips are rare, it's a free wheelie-speed + jump king with no downside. | **Couple the higher cap to a steeper failure:** keep `maxPitch ×1.50` but consider a faster `pitchRiseRate` *feel* via input, OR simply verify in playtest that the higher ceiling means players DO over-commit and flip. If it's too safe, drop the cap to ×1.35. |
| **R4** | **Wheelbarrow is strictly worse in RACING** (no items exist there) → never picked for races. | Its whole identity (items) is inert in `createWorld`. | Give it a **small race-only consolation**: e.g. a modest `steerSpeed`/`turn` edge already helps obstacle-dodging (it's at ×1.05). If still unpicked, nudge `turn → 1.10` *for racing only*, or surface "손수레 = DM 전용 추천" in kart-select copy. Cheapest fix: accept it as a DM specialist and label it. |
| **R5** | **Scooter feels pointless** (no strength) → nobody picks the baseline. | All-rounders die in rosters where specialists dominate. | Keep scooter as the **lowest-variance pick** and make sure no specialist's downside is trivial — i.e. tune R1/R2/R3 so each specialist has a *real* weakness, which is what makes scooter's no-weakness profile worth picking. If needed, give scooter a tiny `item ×1.1` nudge so it's "the safe item-getter." |
| **R6** | **Multiplier stacking** (e.g. dirtbike `speed×wheelie×maxPitch`) produces a runaway top speed. | The DM/race speed formula multiplies wheelie boost on top of base speed. | All deltas are intentionally small and **bounded by `Math.min(1, pitch/cap)`**, so peak speed can't exceed `base*speed*(wheelieMul*wheelie)`. Sanity-cap in playtest: dirtbike DM peak ≈ 91, sportbike ≈ 96 vs scooter 82 — within ~17%, acceptable. If a future stat pushes >1.25×, re-center toward 1.0. |

**General lever order when balancing:** (1) re-center the offending stat toward 1.0,
(2) lean on the vehicle's *existing* downside instead of adding a new penalty,
(3) only then touch a global in `config.js` (which affects everyone).

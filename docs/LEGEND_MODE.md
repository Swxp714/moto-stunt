# 레전드 정규전 (Legend Ranked) — Mode Design

> Party-play, augment-driven roguelite match for MOTO STUNT.
> **Status:** Design spec (synthesized from 8 subsystem designs). This is the SSOT for the mode.
> **Reuse-first principle:** every system below extends an existing primitive (`createArenaWorld`, `createWorld`, `openKartSelect`, the item/3D-icon pipeline, the PeerJS star net). Net-new engine code is small; the bulk is one orchestrator module + forked overlays.

---

## 1. Concept

레전드 정규전 is a single sealed "run": you pick a bike, draft **6 stacking augments (증강)** across **5 distinct-map deathmatch rounds**, then everything you accumulated decides a **flat-ground road race finale** with Mario-Kart rubber-band items. DM rounds earn points *and* the augments that carry into the race; the race is the decisive climax (1st = 500 pts vs a DM 1st = 100 pts).

It is built on the existing `lives` deathmatch (3 lives, shrinking arena, trail kills) for the rounds and the existing racing world for the finale — wrapped by a new state-machine orchestrator (`src/legend.js`, `gameMode = 'LEGEND'`).

---

## 2. The Full Loop

```
KART-SELECT (bike pick, reuse openKartSelect)
   ↓
AUGMENT #1  (3 cards, pick 1 — TFT style)
   ↓
┌─────────────────────────────────────────────────────┐
│  DM ROUND i  (lives DM, 3 lives, MAP i — 5 distinct) │
│     ↓                                                 │
│  INTERMISSION  (round standings + cumulative score)   │
│     ↓                                                 │
│  AUGMENT #(i+1)  (3 cards, pick 1 — augments STACK)   │   × 5 rounds
└─────────────────────────────────────────────────────┘
   ↓  (after AUGMENT #6, the final-prep pick)
FINAL RACE  (flat 1자로 straight, all augments active,
             3 item zones, rubber-band items + missile)
   ↓
RESULTS  (total points → final rank, podium + fireworks)
```

- **6 augment picks total:** 1 before round 1, then 1 after each of rounds 1–5 (picks 2–6 happen on the post-round intermission). The 6th pick feeds the final race.
- **5 DM rounds, each on a different map.** Difficulty escalates exactly as augment power ramps.
- **Augments STACK** for the whole match and carry into the race.

---

## 3. Match Timeline & Budget

| Phase | Screen | World | ~Time |
|---|---|---|---|
| KART_SELECT | `openKartSelect` overlay | none | ~60s |
| AUGMENT #1 | augment-select overlay | none | ~25s |
| DM_ROUND ×5 | DM render (reuse) | `createArenaWorld` per round, MAP i | ≤150s each (mean ~90s) |
| INTERMISSION ×5 | standings + map reveal | DM world frozen | ~6s + pick ~25s |
| FINAL_RACE | race render (reuse) | `createWorld`-based race arena | ~45–55s |
| RESULTS | podium + standings | last world frozen | until input |

**Budget:** worst case ~20 min; realistic mean **~15–16 min** (DM rounds usually end on last-stand around 90s). `LEGEND.dmRoundTime` (150s hard cap) is the lever to stay in budget.

---

## 4. Match State & gameMode Integration

A new mode token `gameMode = 'LEGEND'` (also referred to as `'LR'` in early drafts — **canonical token: `'LEGEND'`**). A single new module `src/legend.js` exports a controller (`createLegendMatch(opts)` / `LegendMatch`) that owns the macro sequence and never re-implements physics — it instantiates and tears down the existing world factories per phase.

### 4.1 State machine

```
KART_SELECT → AUGMENT(1) → DM_ROUND(1) → INTERMISSION → AUGMENT(2) → DM_ROUND(2)
            → … → AUGMENT(5) → DM_ROUND(5) → INTERMISSION → AUGMENT(6)
            → FINAL_RACE → RESULTS
```

| State | What runs | World | Exit |
|---|---|---|---|
| `KART_SELECT` | `openKartSelect({count})` (existing) | none | picks → `AUGMENT(1)` |
| `AUGMENT` | augment-select overlay | frozen behind | pick → `DM_ROUND` (or `FINAL_RACE` after #6) |
| `COUNTDOWN` | 3-2-1-GO (reuse `#ksCount`) | built & frozen | done → round |
| `DM_ROUND` | `arenaWorld.update(dt, inputs)` | fresh `createArenaWorld` per round, `mapDef`=MAP i | `S.over` or timer cap → `INTERMISSION` |
| `INTERMISSION` | round standings + cumulative score + map reveal; DM victory cam | DM world frozen | timer → next `AUGMENT` |
| `FINAL_RACE` | race-arena update + item zones | race world | finish-line / timer → `RESULTS` |
| `RESULTS` | total standings, podium, fireworks | last world frozen | "다시" → new match / "메뉴" → menu |

A single `advance()` transition function decides the next phase from `(phase, round)`; every screen's "done" callback calls it.

### 4.2 Loop integration (`main.js`)

Add one branch in `loop()` **before** the existing DM branch:

```js
if (gameMode === 'LEGEND' && legend) {
  legend.tick(dt);                              // advances overlays/timers/state machine
  if (legend.phase === 'DM_ROUND' || legend.phase === 'INTERMISSION')
     renderDmLike(legend.world, legend.localSlot);   // = existing DM render code, extracted
  else if (legend.phase === 'FINAL_RACE')
     renderRaceLike(legend.raceWorld);               // = existing race render code, extracted
  // KART_SELECT/AUGMENT/COUNTDOWN render the frozen world behind the overlay
  requestAnimationFrame(loop); return;
}
```

During `DM_ROUND`/`INTERMISSION` the render is **identical** to the existing DM branch (a Legend DM round *is* a deathmatch). During `FINAL_RACE` it routes to the racing render pipeline. `setGameMode('LEGEND')` flips the HUD between the `.dm` layout (DM rounds) and the race layout (final). The `R`-to-restart hotkey is disabled in `'LEGEND'` (a roguelite run shouldn't be single-key resettable mid-match).

### 4.3 Controller API

```js
new LegendMatch({ humans, bots, online, scorePop, net, isHost })
MATCH.start()        // async: kart-select → augment(1) → countdown; builds round-0 world
MATCH.tick(dt)       // every frame from loop(); advances timers + state machine
MATCH.advance()      // single transition fn; called by overlay "done" callbacks
MATCH.onRoundOver()  // compute placement, += totalScore, → INTERMISSION
MATCH.phase          // current state
MATCH.round          // 0..4 (DM), then 'final'
MATCH.world          // active arenaWorld (DM) — for the loop to render
MATCH.raceWorld      // active race arena (final)
MATCH.localSlot      // this client's rider index in the current world
MATCH.riders         // persistent roster (augments, totalScore)
MATCH.applyPhase(msg)// (online guest) apply host phase broadcast
```

Stored on `window.__moto.legend` (a.k.a. `window.__legend`) for live debugging + Playwright assertions.

---

## 5. Round-Flow: Persist vs Reset

The controller holds `MATCH.riders[]` — **persistent player records** keyed by a stable `pid` (NOT the per-world rider index, which is rebuilt each round). This is the single source of carried state.

```js
// MATCH.riders[pid] — PERSISTS for the entire match
{
  pid, name, isBot, isLocal, isOnline, netId,
  vehicle, color,     // chosen at KART_SELECT, never changes
  augments: [],       // accumulated picks — PERSISTS & STACKS
  totalScore: 0,      // cumulative points — ACCUMULATES
  roundPlaces: [],    // place per round (tiebreak + results)
}
```

| Thing | DM round → next | Into final race | Owner |
|---|---|---|---|
| vehicle / color | persist | persist | `MATCH.riders[pid]` |
| **augments[]** | **persist + STACK** | persist (all 6 active) | `MATCH.riders[pid]` |
| **totalScore** | **accumulate** | accumulate | `MATCH.riders[pid]` |
| lives | RESET to 3 | n/a (race) | `createArenaWorld reset()` |
| HP/kills/deaths | reset to 0 | reset | DM `reset()` |
| held item | cleared | fresh from zones | DM `reset()` / race itemless start |
| position/trail/pitch | reset | reset | both worlds' `reset()` |

**Key reuse:** the existing DM `reset()` (`deathmatch.js` L288–305) already resets lives, score, kills, deaths, item, trail, position. Round-to-round reset is "just call `reset()` on a freshly built `arenaWorld`." The only NEW persistence layer is `MATCH.riders[].{augments, totalScore}`, maintained *outside* the world.

Augments are passed into each round's world via the rider defs (`def.augments`); the augment subsystem reads them in `makeRider`. The controller only guarantees `augments[]` is carried and grows by one each AUGMENT phase.

### 5.1 How a DM round ends

A round ends when **either**:
1. **Last-standing** (primary): the `lives` mode already sets `S.over = true, S.winner = <idx>` when ≤1 rider remains (`deathmatch.js` L490–494). Controller polls `arenaWorld.S.over` each frame.
2. **Timer cap** (safety): `roundClock` reaches `dmRoundTime` (150s) → force-end, ranking survivors. At `dmSuddenDeathAt` (120s) the controller bumps `DM.shrinkRate` so the ring closes fast and forces contact.

The `lives` mode's shrink + maxLives=3 *is* the "3 lives DM that gets decisive" — reuse as-is; the controller only adds its own timer cap on top.

### 5.2 Bots / humans / online roster

Roster assembled once after KART_SELECT, top-padded with bots to `LEGEND.fieldSize` (8):
- **Local 1P/2P:** 1–2 `isLocal` records (inputs via `inputFor(0/1)`), rest bots.
- **Online party:** peers become `remote:true` records (DM supports `remote` via `applyRemote`). **The host is authoritative for round-flow:** host runs the state machine and broadcasts phase transitions; guests follow.
- **Augment auto-pick:** if a player doesn't pick within the augment timer, the controller auto-picks (bots: weighted/heuristic; AFK humans: random of 3). Prevents stalls — a hard requirement for party play.

### 5.3 Drop-in / drop-out
- **Drop-out (peer leaves mid-match):** their record is **converted to a bot in place** (`isBot=true`), preserving field size + augments + score (reuses `peerLeft` + `dmHostRemove`). If the host leaves, the match ends for guests (`endOnline`), same as today's DM.
- **Drop-in:** **disabled mid-match** (a sealed run; joining at round 3 with no augments is unfair). Late joiners queue for the next match; `net` rejects joins once `phase !== KART_SELECT`.

---

## 6. Augment System

The run's progression spine: 6 picks, each offering **3 weighted-random options, pick 1**; owned augments never re-roll; effects **stack** and carry into the final race.

### 6.1 Data model (data-driven)

Augments produce a **second multiplier/flag layer** (`r.aug`) applied **on top of** the vehicle stats (`r.st`) at the exact same formula sites. Same axes as vehicle stats → they compose cleanly.

```js
// models/augments.js — pure data + resolver, zero THREE imports
export const DEFAULT_MODS = {
  speedMul:1, turnMul:1, wheelieMul:1, maxPitchMul:1, trailMul:1,
  boostDurAdd:0, shieldDurAdd:0, invulnAdd:0, ramRange:0,
  jumpHeightMul:1, jumpTimeMul:1,
  killEveryDelta:0, deathEveryDelta:0, itemIntervalMul:1,
  startItem:null, superBias:0, rerolls:0,
  trailKillBoost:false, reviveOnce:false, phaseTrail:false, missileLock:false,
};
export function resolveMods(ownedIds, vehicle){ /* clone DEFAULT_MODS, run each aug.apply(m,ctx) */ }
```

**Sim read sites** (one extra factor per existing line — mirrors the `r.st` pattern):
- Speed (L458): `… * r.st.speed * r.aug.speedMul …`
- Turn (L459): `* r.st.turn * r.aug.turnMul`
- Flip cap (L456): `CFG.maxPitch * r.st.maxPitch * r.aug.maxPitchMul`
- Trail cap (`addSeg`): `round(DM.trailMax * r.st.trail * r.aug.trailMul)`
- `useItem`: `r.boost = 2.2 + m.boostDurAdd`, `r.shield = 3.0 + m.shieldDurAdd`
- `respawnRider`/round start: `r.invuln = DM.invulnTime + m.invulnAdd`; grant `m.startItem`
- Economy: `r.killEvery = max(1, round(3/r.st.item) + m.killEveryDelta)`
- Ram (L482): radius `2.0 + m.ramRange`

`r.aug` is set once per round in `makeRider`/round-reset from the cached `resolveMods`. Bots get a parallel (weaker/randomized) augment list so opponents scale too.

> **Integration rule:** `applyAugments` runs `world.reset()` → for each rider, for each owned augment `aug.apply(ctx)`. `ctx = { rider, world, mode:'dm'|'race', DM, CFG, st:rider.st }`. If `r.st` is missing it defaults to all-1.0, so augments work standalone. Prefer augments that scale numbers the engine *already reads*; new-mechanic augments cost a real `deathmatch.js` edit and are deferred.

### 6.2 Tiers & rarity weighting

| Tier | Korean | Power | Base weight | Round-scaled (pick #1→#6) |
|---|---|---|---|---|
| Silver | 은장 | small single-stat nudge | 70 | 70 → 30 |
| Gold | 금장 | meaningful / dual effect | 26 | 26 → 50 |
| Prismatic | 무지개 | build-defining / legendary | 4 | 4 → 20 |

Offer rolls 3 distinct (no owned dups); late-round bias raises high-tier odds. Prismatics are unique-per-run; contradictory legendaries never co-offered (`tags:['unique']`). A 🎲 reroll button shows if `mods.rerolls > 0`.

> **Cross-subsystem note (rarity by placement):** the scoring subsystem additionally biases the *rarity roll* by the player's current standing — trailing players see better tiers (rubber-band). See §8.4. The augment subsystem owns the tier content + 3-card UI; scoring hands it a weight table per player. **These two weighting mechanisms compose** (round-bias × placement-bias).

### 6.3 The pool (42 augments)

> Ⓢ Silver · Ⓖ Gold · Ⓟ Prismatic. Format: 이름 — effect — *touches*.

**Offense (트레일/킬)**

| # | Name | Tier | Effect | Touches |
|---|---|---|---|---|
| O1 | 칼날 트레일 | Ⓢ | 트레일 폭 +15% | `trailW` |
| O2 | 장벽 본능 | Ⓢ | 트레일 길이 +20% | `trailMul` |
| O3 | 돌진 | Ⓖ | 부스트 중 들이받기 사거리 +1.2m | `ramRange` (boost active) |
| O4 | 연쇄 처치 | Ⓖ | 트레일 킬 시 2초 부스트 | `trailKillBoost` |
| O5 | 사냥꾼 | Ⓖ | 1등 처치 시 +1점 & 실드 1.5s | killScore vs leader, `shield` |
| O6 | 그림자 벽 | Ⓟ | 자기 트레일 면역 + 길이 +30% | `phaseTrail`, `trailMul` |
| O7 | 참수 | Ⓟ | 들이받기 +1.5m, 부스트 중 +2.5m | `ramRange` |

**Defense (생존/실드)**

| # | Name | Tier | Effect | Touches |
|---|---|---|---|---|
| D1 | 두꺼운 가죽 | Ⓢ | 리스폰 무적 +0.8s | `invulnAdd` |
| D2 | 방어막 강화 | Ⓢ | 실드 지속 +1.5s | `shieldDurAdd` |
| D3 | 회피 본능 | Ⓢ | 트레일 grace 세그먼트 +3 | `DM.graceSegs` |
| D4 | 불사조 | Ⓖ | 라운드당 첫 죽음 목숨 0 소모 (1회) | `reviveOnce` |
| D5 | 수호 출발 | Ⓖ | 매 라운드/리스폰 실드 보유 시작 | `startItem:'shield'` |
| D6 | 철벽 | Ⓟ | 실드 중 무적 + 들이받기 무효 + 지속 +2s | `shieldDurAdd`, immune |
| D7 | 불굴 | Ⓟ | 목숨 +1 (4목숨 시작) | `maxLives` +1 |

**Mobility / Wheelie**

| # | Name | Tier | Effect | Touches |
|---|---|---|---|---|
| M1 | 민첩 | Ⓢ | 회전 +12% | `turnMul` |
| M2 | 윌리 감각 | Ⓢ | 윌리 전복 한계 +15% | `maxPitchMul` |
| M3 | 가속 본능 | Ⓢ | 속도 +6% | `speedMul` |
| M4 | 점프 마스터 | Ⓖ | 점프 높이 +30%, 체공 +20% | `jumpHeightMul/TimeMul` |
| M5 | 윌리 폭주 | Ⓖ | 윌리 속도 배수 +12% | `wheelieMul` |
| M6 | 드리프트 킹 | Ⓖ | 회전 +18% & 속도 +5% | `turnMul`, `speedMul` |
| M7 | 로켓 스타트 | Ⓟ | 속도 +15%, 윌리 +15%, 회전 −8% | `speedMul`, `wheelieMul`, `turnMul` |
| M8 | 공중 지배 | Ⓟ | 점프 +50%, 체공 +40%, 체공 중 트레일 면역 | `jumpHeightMul/TimeMul` |

**Trail-tech (조합 빌드)**

| # | Name | Tier | Effect | Touches |
|---|---|---|---|---|
| T1 | 긴 꼬리 | Ⓢ | 트레일 길이 +15% | `trailMul` |
| T2 | 저공 비행 | Ⓢ | 점프 중 트레일 벽이 더 낮음 | `trailH` y-offset |
| T3 | 올가미 | Ⓖ | 트레일 폭 +20% & 길이 +15% | `trailW`,`trailMul` |
| T4 | 미로 건축가 | Ⓟ | 트레일 길이 +50%, 본인 면역 | `trailMul`, `phaseTrail` |

**Items / Economy**

| # | Name | Tier | Effect | Touches |
|---|---|---|---|---|
| I1 | 손버릇 | Ⓢ | 킬 아이템 1킬 더 빨리 | `killEveryDelta:-1` |
| I2 | 근성 | Ⓢ | 죽음 아이템 1데스 더 빨리 | `deathEveryDelta:-1` |
| I3 | 빠른 보급 | Ⓢ | 순위 아이템 간격 −20% | `itemIntervalMul` |
| I4 | 고급 보급 | Ⓖ | 강한 아이템 확률 +35% | `superBias` |
| I5 | 창고 | Ⓖ | 라운드 시작 부스트 보유 | `startItem:'boost'` |
| I6 | 약탈자 | Ⓖ | 킬마다 25% 즉시 랜덤 아이템 | `grantItem` on kill |
| I7 | 무한 보급 | Ⓟ | 모든 cadence ½, super +50% | all economy |
| I8 | 한탕 | Ⓟ | 라운드 시작 super 보유 | `startItem:'super'` |

**Eco / Utility (메타)**

| # | Name | Tier | Effect | Touches |
|---|---|---|---|---|
| E1 | 재고르기 | Ⓢ | 리롤 +1 (영구) | `rerolls` |
| E2 | 눈썰미 | Ⓢ | 다음 픽 Gold 이상 보장 (1회) | offer weight |
| E3 | 복리 | Ⓖ | 이후 Silver 등장 −50% | offer weight |
| E4 | 수집가 | Ⓟ | 즉시 랜덤 Silver 1개 무료 | grants Ⓢ now |

**Legendary (Prismatic, run-defining)**

| # | Name | Tier | Effect | Touches |
|---|---|---|---|---|
| L1 | 미사일 조준경 | Ⓟ | 결승: 내 미사일이 2등도 동시 표적, '!' −30% 빠름 | `missileLock` (final-race item) |
| L2 | 고무줄 | Ⓟ | 꼴찌일수록 속도 +최대18%, 1등이면 0 | `speedMul` by live rank |
| L3 | 흡혈 | Ⓟ | 킬 시 0.5목숨 회복 (라운드당 +2) | round lives |
| L4 | 올인 | Ⓟ | 속도+윌리+회전 +10%, 목숨 −1 | all mul, `maxLives` −1 |
| L5 | 눈덩이 | Ⓟ | DM 1등마다 다음 라운드 영구 속도 +4% (누적) | persistent `speedMul` |

> 42 total. Trim to 36 by cutting low-impact Silvers (O1, T2, M3) or expand to 48 with mirror Silvers — the table is the SSOT.

### 6.4 Synergies (emergent build combos)

1. **윌리 폭주 빌드** — M2+M5+M8, best on dirtbike (high base maxPitch). Jump-heavy maps.
2. **벽 감옥** — O2+O6+T4 → +100% trail with self-immunity. Sportbike (trail base).
3. **들이받기 폭군** — O3+O7+D6+I8 → start with super, huge ram, shield-immune roaming killer.
4. **아이템 소방호스** — I1+I2+I4+I7 → constant super/shield; brutal on wheelbarrow (item base). Comeback engine.
5. **불멸자** — D4+D7+L3 → 4 lives, first death free, kills refund lives → near-uneliminable.
6. **직선의 악마** — M7+M3+L5 → max straight-line speed that compounds on DM wins; built for the final race.
7. **고무줄 역전** — L2+I7+D7 → intentionally place low in DM, enter the final as "last place" with rubber-band speed + best items.
8. **메타 스케일러** — E1+E3+E2+E4 → reroll + tier-inflation; out-values opponents by raw augment quality.

Synergy hook in `offer()`: `if (run.owned.has('M2')) weight['M5'] *= 1.4;` — a `SYNERGY_HINTS` map *biases* (never forces) partner pieces.

### 6.5 Interaction with the 4 bike profiles

Augments are **multipliers on the same axes** as `r.st` → they compound with the bike's identity:
- **Dirtbike** (maxPitch ×1.5): wheelie augments → strongest wheelie ceiling. Intended fantasy.
- **Sportbike** (speed ×1.12, trail ×1.15, turn ×0.82): speed/trail augments amplify its lane; turn augments patch its weakness — a real decision.
- **Wheelbarrow** (item ×1.5): economy augments hit its lowered thresholds first → item-firehose payoff.
- **Scooter** (all ×1.0): cleanest augment canvas, full predictable value, no runaway — the "why pick baseline" answer (most *flexible* draft).

**Runaway guard:** Silver/Gold muls 1.05–1.20, Prismatic ≤1.50 single-axis. Re-check dirtbike + M2+M5+M8 in playtest (must not exceed ~1.4× scooter peak; `Math.min(1, pitch/cap)` already bounds it). Drop M8's maxPitch component if it does.

### 6.6 Augment-select overlay (reuse kartselect)

New `src/augmentselect.js`, `openAugmentSelect({ options, pickIndex, rerolls, vehicle, players, autoMs })` → `Promise<augmentId>`. Forks the `kartselect.js` pattern (DOM overlay + low-res WebGL + `injectCSS` + keyboard nav + countdown):
- 3 `.aug-card`s instead of the vehicle strip; reuse `.ks-panel`/chip/lock CSS.
- Each card: tier-colored border, 3D icon (via `renderItemIcons`-style offscreen-RT → `AUG_IMG{}` cache; falls back to emoji), name, stat-hint chip, 2–3-line desc, LOCK affordance, optional synergy glow.
- Spinning current bike on a podium behind the cards (reuse `mountRider`).
- Keys: A/D or ←/→ move, SPACE/ENTER lock, 🎲/R reroll. `sfx.play('item_grant')` on lock.
- **Party:** each peer rolls independently (seeded by `run.seed + peerId + pickIndex` → deterministic/anti-cheat). Round starts when all locked **OR** `autoMs` (default 12s) elapses. Bots resolve instantly via `botPickAugment`.

---

## 7. Maps

5 deathmatch arenas (one per round) + the final flat-straight race track, all built from existing primitives. Rather than fork `createArenaWorld` five times, drive all 5 from one `ARENA_MAPS[]`/`LEGEND_MAPS` data table; `createArenaWorld` reads a `mapDef` instead of hard-coded `DM.*` values.

### 7.1 mapDef contract (engine seam)

Add a `mapDef` param to `createArenaWorld(riderDefs, modeKey, scorePop, mapDef)`. All 5 rounds use `modeKey='lives'`; `mapDef` overrides the *spatial* numbers (with `DM`/`mode` fallbacks so non-Legend modes are unaffected).

| mapDef field | Overrides | Used at |
|---|---|---|
| `radius` (`startR`) | `mode.startR` / `DM.arenaR` | `arena.radius` (L289), pad placement (L37) |
| `shrink`, `shrinkRate`, `minR` | `mode.shrink`, `DM.shrinkRate`, `DM.minR` | shrink block (L408–411) |
| `jumpPads` | `DM.jumpPads` | `placePads()` (L38) |
| `bg`, `fog*`, `ring/line/major Color` | scene/grid theme | setup (L14–20) |
| `hazards[]` | NEW — static/moving walls | new `buildHazards()` |
| `mask` | NEW — non-circular bounds | boundary check (L463) + bot `blockedAt` (L127) |

**Hazards reuse the trail-collision system.** A static wall = a permanent trail segment owned by a synthetic non-moving "world rider" (or `S.hazardSegs` checked in the same loop). Lava gaps / moving walls / bridges all collide through one code path bots already avoid (append to the `trailSegs` scan). Airborne riders pass over `y0:0` hazards (the `|r.y - sg.y0| < DM.trailH` check), so jump pads become load-bearing for traversal.

**Non-circular shapes:** generalize the `Math.hypot(r.x,r.z) > radius` test to `mapDef.mask(x,z,radius)`; bot avoidance uses the same call.

### 7.2 The 5 DM maps (fixed order — escalating chaos)

1. **그리드 (Grid)** — neutral wide arena. Default cyan palette, circle radius 90, **shrink off**, 6 pads, no hazards. The proven baseline; zero new risk. (Round 1: learn your first augment.)
2. **협곡 (Canyon)** — volcanic theme, circle radius 78, shrink off, 5 pads. **3 lava-gap strips** (ground-level hazard segments, ~10u wide) + 2 narrow bridge lanes. A pad on each side lets you leap a gap; lava kills on contact but is passable airborne. Rewards jump/flip augments.
3. **저중력 (Low-G)** — deep-space violet, circle radius 84, shrink off, 8 pads. Per-map `jumpHeightMul 1.8` / `jumpTimeMul 1.6` (no physics change — scales the existing arc). Riders fly higher/hang longer; mid-air trails form floating walls (`y0>0`, already supported). Rewards air-control augments.
4. **투기장 (Colosseum)** — arena-gold, **square** mask half-extent 70, **fast shrink** (`shrinkRate 3.4`, `minR 18`), 4 pads. **2 sweeping moving walls** (ping-pong ~14 u/s, `y0:0`, jump-over-able). First combined non-circular + dynamic hazard + shrink → difficulty spike.
5. **붕괴 (Collapse)** — danger-red, **plus/cross** mask (arms `armW~24`), **fastest shrink** (`shrinkRate 4.0`, `minR 14`), 9 pads. 1 slow moving wall in the central hub + narrow corridor arms. Maximum density + most augments stacked = a spectacular final brawl.

**Difficulty curve:** wide/calm → traversal → aerial → square+moving+shrink → cross+collapse.

> **MVP shortcut:** vary only `startR`, `shrink`, `jumpPads`, and bg/fog color per map — pure data, zero new geometry, already 5 visibly different rounds. Hazards/masks are a Phase-5 enrichment.

### 7.3 Final race track — 결승 직선 (Final Straight)

A single-lane flat straight built by **extending `buildRoad()`**, reusing the entire `createWorld` racing loop (lane-clamp L293, obstacle hit L312, finish L319):
- **Length:** `trackLength 3600` (~45–55s at boosted speed).
- **Lane:** keep `CFG.roadWidth 12` (1자로 = straight, geometry unchanged, just longer).
- **Edges/finish:** reuse cyan edge bars + gold finish gate, themed gold/championship; `buildGridFloor` underneath.
- **Light obstacles:** reuse `buildObstacles` slalom cones, **sparse + skipped within ±15u of each item zone** so pickups aren't blocked. Cones stay crash-on-hit to keep racing skillful.

> **Multi-rider note:** `createWorld` is currently single-rider per world. The final needs N bikes in one race scene (see §10 / open question). Cheapest path: a `createRaceArena(defs, mapDef)` factory modeled on `createArenaWorld` (shared scene, N bikes, per-rider cameras) using the straight track + wheelie-race physics; bots use simplified lane-keeping AI. **[DEP: race-arena subsystem]** — alternatively, bots are ghost `opp`-style entities advancing on `distance` (the MVP path in the roadmap).

---

## 8. Scoring, Ranking & Progression

A match-level layer **above** `riders[]`: a `legend.players[]` array holding cumulative points across the 6 sub-games. Assumes a 6-player lobby as the tuning target (generalizes via §8.6). Players never get eliminated from the *match* — DM lives run out per round, but you always advance.

```js
const legend = {
  round: 0,                 // 0..4 = DM rounds, 5 = final race
  players: riders.map(r => ({ idx:r.idx, pts:0, placeHist:[], dmFirsts:0, augments:[], raceFinishT:0 })),
};
```

### 8.1 Point curves (6p shipping defaults)

**DM round curve** (anchor 1st=100, roughly linear with a fat top — DM rewards consistency, last place still banks something):

| DM place | 1st | 2nd | 3rd | 4th | 5th | 6th |
|---|---|---|---|---|---|---|
| **Points** | **100** | 72 | 50 | 33 | 20 | 10 |

`DM_PTS = [100, 72, 50, 33, 20, 10]`. DM god (avg 1st ×5) = **500**. Average (~3rd–4th) ≈ 210. Loser (~5th–6th) ≈ 75.

**Final race curve** (anchor 1st=500, steep but graded so 2nd–3rd stay large):

| Race place | 1st | 2nd | 3rd | 4th | 5th | 6th |
|---|---|---|---|---|---|---|
| **Points** | **500** | 330 | 220 | 140 | 80 | 30 |

`RACE_PTS = [500, 330, 220, 140, 80, 30]`. 1st→2nd gap = 170 (the race win is the single most valuable thing). 3rd (220) ≈ 2.2 DM wins.

> **Resolved design intent — the dominance check:** max DM total (5×100=500) = max race 1st (500). **Symmetric ceilings** are deliberate: neither path mathematically runs away from the other. The race's *single-round* swing is bigger (it's the climax) but the DM *aggregate* matches it.

**Scenario validation:**
- **DM god (500 pts going in) vs Race winner (avg 4th DM = 165):** race winner → 665. DM god, with stacked augments, realistically races 2nd–3rd: 2nd → 830 (wins), 3rd → 720 (wins). Only if the DM god craters to 5th (580) does the race winner (665) win. ✅ DM dominance favored but *must still race competently* (top-3).
- **The blowout guard:** a DM bomber (50 pts) who wins the race = 550; a median player (250) racing 2nd = 580. ✅ No single round fully decides the match.

**Tuning levers (data-only, two arrays):** race not decisive enough → raise `RACE_PTS[0]` to 600. DM god too dominant → flatten DM toward `[100,78,60,44,30,18]`.

### 8.2 Cumulative leaderboard

After each sub-game, run one resolve step:

```js
function legendResolveRound(placeArray) {            // rider idx in finishing order
  const TABLE = legend.round < 5 ? DM_PTS : RACE_PTS;
  placeArray.forEach((ridx, place) => {
    const p = legend.players.find(pp => pp.idx === ridx);
    p.pts += TABLE[place] ?? TABLE[TABLE.length - 1];
    p.placeHist.push(place);
    if (legend.round < 5 && place === 0) p.dmFirsts++;
  });
  legend.round++;
}
```

- **DM placement** = the exact sort `showDmStandings`/`topScorer` already use: `riders.filter(r=>!r.startDead).sort((a,b)=>b.score-a.score).map(r=>r.idx)`. 1st = `S.winner`. (Extract to a shared `dmPlacement(aw)` helper.) The controller records `eliminatedAt` by watching `r.lives` hit 0 to break ties among the eliminated.
- **Race placement** = finish order. **[DEP: race-arena]** must emit a `finishOrder[]` for all racers (bots+peers), not just the local `game.finishTime`.

### 8.3 Tiebreaks

When `pts` are equal: (1) most match wins (`dmFirsts` + race 1st) → (2) better final-race placement → (3) best average DM placement → (4) stable `idx` order.

### 8.4 Augment quality by placement (rubber-band)

Two independent levers (do both), extending the existing in-DM rank-based item grant (`grantItems` — leader gets weak `jump`, last gets `super`):

**(1) Rarity roll weighted by standing.** Trailing players see better-rarity options (the augment analog of `grantItems`' `f = rank/(n-1)`):

```js
function augmentRarityWeights(playerIdx) {
  const rank = legendRank().findIndex(p => p.idx === playerIdx);
  const f = ranked.length > 1 ? rank / (ranked.length - 1) : 0;   // 0 leader … 1 last
  return { silver: 0.65-0.35*f, gold: 0.30+0.10*f, prismatic: 0.05+0.25*f };
}
```
Leader: mostly silver, 5% prismatic. Last: up to 30% prismatic (a real comeback shot — mirrors last-place getting the missile in the race).

**(2) Round-winner bonus pick (recommend ON):** the DM round winner picks from **gold-tier-guaranteed** options that round, so winning earns immediate quality (not just 100 pts). Lever (1) helps losers always; lever (2) rewards the winner *right now* — a dampened snowball.

> **Cross-subsystem resolution:** the augment subsystem owns the tier content + 3-card UI + round-bias (§6.2). The scoring subsystem owns `augmentRarityWeights()` (placement-bias) + the round-winner gold-guarantee flag. The augment `offer()` multiplies both biases. This is the **only** coupling between scoring and augments.

### 8.5 Final match rank

`legendRank()` sorts `players` by `pts` desc with the §8.3 tiebreaks. The between-rounds standings reuse `showDmStandings` markup but read `legend.players` sorted by `pts` (+ a "ROUND n/6" header and a running-total column).

### 8.6 N-player generalization

For lobby ≠ 6, generate tables from a shape function, keeping the invariant **`sum of 5 DM 1sts ≈ race 1st` (both ≈500)**:
```js
function dmTable(n){ return Array.from({length:n}, (_,i)=>Math.round(100*Math.pow(0.62,i))); }
function raceTable(n){ return Array.from({length:n}, (_,i)=>Math.round(500*Math.pow(0.66,i))); }
```
The 6p hand-tuned arrays are the shipping defaults; generators are the 2–5p/7p+ fallback.

---

## 9. Final-Race Items (Rubber-Band) + Missile Combat

Governs the final flat-ground race only. **Extends** the existing DM item primitives (`buildItemModel`/`ITEM_KEYS`, `grantItems` rank-weighting, `useItem` switch, `startItemRoll` slot reel, `ITEM_IMG` data-URLs) — does not invent a new engine. **Key difference from DM:** the race hands items on **spatial pickup zones** (drive over → roll), weighted by **live race placement**, not a timer.

### 9.1 Item zones & pickup

3 zones along the track at `game.distance ≈ 25% / 50% / 75%`. Config `RACE_ITEMS.zones`. Two designers proposed slightly different absolute positions:
- For `trackLength 3000`: **`[750, 1500, 2250]`**.
- For `trackLength 3600` (this spec's final-track length, §7.3): **`[900, 1800, 2700]`**.

> **Resolved:** use `zones = [trackLength*0.25, trackLength*0.50, trackLength*0.75]` computed from the actual `trackLength` so the two never disagree. With `trackLength 3600` that's `[900, 1800, 2700]`.

Each zone = a full-width band of **3 floating pickup pylons** (one per lane third). Pickup trigger mirrors the DM proximity test; `z.taken` is per-racer per-zone (max 3 grabs/race). A held item blocks pickup until used (DM's `if (r.item) return`). On pickup, the local player sees the existing `startItemRoll(key)` slot reel (verbatim).

### 9.2 Rubber-band weight table

`f = place / (racerCount - 1)` → 0 = 1st, 1 = last (same normalization as `deathmatch.js` L329). Mario-Kart: leaders get utility, trailers get firepower.

| Bracket | `f` | Pool (weights) |
|---|---|---|
| Leader (1st) | `f ≤ 0.05` | banana 45, boost 30, shield 25 |
| Front | `0.05 < f ≤ 0.40` | boost 35, shield 25, banana 20, oil 20 |
| Mid | `0.40 < f ≤ 0.70` | oil 30, boost 25, mushroom 25, lightning 20 |
| Back | `0.70 < f < 0.999` | mushroom 30, lightning 25, missile 25, boost 20 |
| Last | `f ≥ 0.999` | **missile 40**, mushroom 35, lightning 25 |

The 1st-place bracket never rolls missile/lightning (satisfies "1st gets the weakest"). Solo/bot fallback: `racerCount===1` → treat as `f=1` (last) so a solo player still gets the toys.

### 9.3 Item roster (8 items)

**Reused from DM (as-is):**
1. **부스트 (boost)** — self speed surge, `racer.boost = 2.2s` → `speed = baseSpeed * wheelieSpeedMul`. Reuses DM boost flame.
2. **보호막 (shield)** — `racer.shield = 3.5s`; blocks the next hostile effect and consumes on block. Reuses DM bubble. **Hard counter to missile/lightning/oil.**

**New (new `buildItemModel` builders + `ITEM_KEYS`):**
3. **버섯 대시 (mushroom)** — self, stronger one-shot boost tuned for catch-up: `speed = baseSpeed * 2.6` for 1.4s + brief grip.
4. **바나나 (banana)** — drop-trap behind. Any racer within `trapR≈1.6` spins out (`speed *= 0.35`, wobble, no rewind). Despawns after 18s or one trigger. Shield blocks. Best for leaders zoning chasers.
5. **기름 (oil)** — wide drop-behind slick: sustained skid (`speed *= 0.5` + lateral slide 0.8s). Distinct from banana: oil = sustained slip (harder to escape), banana = instant spin (harder hit, pinpoint). Shield blocks.
6. **번개 (lightning)** — all racers AHEAD: `speed *= 0.45` for 1.4–1.5s + brief shrink. No projectile (instant, cheap to net-sync). Shield blocks per-target. The "fair tax" — not dodgeable.
7. **유도 미사일 (missile)** — homing to 1st place (see §9.4 — the signature item).
8. *(Leader utility covered by banana+boost+shield.)*

HUD: reuse `els.dmItem` / `setItemIcon` / `lastLocalItem` reel driver unchanged. New icons auto-bake via `renderItemIcons()` looping `ITEM_KEYS`. Add emoji fallbacks to `ITEM_ICON` (`banana:'🍌', oil:'🛢️', lightning:'⚡', mushroom:'🍄', missile:'🚀'`). Fire with the existing **F key** (`useItem`/`useRaceItem`).

### 9.4 Missile combat (resolved unified spec)

Two designers specced the missile (race-items as a granter; missile-combat as the projectile owner). **Resolved single source of truth:**

| Property | Value |
|---|---|
| **Target** | The race **leader** (`place === 0`). If the firer *is* the leader → re-target nearest-ahead (never self-target, never wasted). Locked at fire time (snapshot of `target.idx`); still homes to the live position. |
| **Warning** | A single large centered **`!`** flashes over the target for **0.6s** (blinking via the existing invuln-blink cadence), **before any collision is possible** (`armT` window). Plays SFX `warn`/`missile_lock`. With augment L1 미사일 조준경, warning is −30% faster and also locks 2nd. |
| **Flight** | Homing projectile, `speed 64` (~1.7× rider top speed → catches but not instant), `turn 3.4 rad/s` (tracks a leader, but a hard steer / jump-pad launch breaks lock), `life 4.0s`, `hitR 2.2`. Pool of 8 (mirrors the explosion/debris particle-pool pattern). |
| **Dodge windows** | (1) warning window (no collision yet); (2) turn-rate cap (weaving sheds it on curves); (3) **vertical dodge** — a jump pad raises `r.y` above the missile's height-lerp (`dy > 2.4` = dodged) → "jumped over the missile"; (4) shield/invuln block one hit. |
| **Hit reaction** | **Spin-out**: `spinT 1.1s` (uncontrolled yaw `heading += 8/s`) + `slowMul 0.35`. **Costs position, not lives** — no eliminations in the race. Reuses `spawnExplosion` + `spawnDebris`. |
| **Net** | Owner authoritatively spawns + resolves; remotes spawn a cosmetic projectile from the `fire` event and apply reactions from the `hit` event. |

**Sibling combat items** (missile-combat subsystem, optional beyond MVP): **lightning** (=§9.3 item 6, the group tax — owned here mechanically), **emp** (전자교란 — nearest-ahead straight skill-shot, brief dead-stop `stunT 0.45s` + HUD scramble, very dodgeable), **trap** (지뢰 — stationary spin-out hazard placed behind, reuses the jump-pad proximity test).

> **Conflict resolved (banana vs trap):** both are "drop a spin-out behind you." Ship **banana** as the race-item roster name (it's in the rubber-band table); **trap/지뢰** from the combat subsystem is the *same mechanic* — treat them as one item (`banana`) for v1, reserve `trap`/`emp` as later combat-flavor variants.

**New rider fields** (decay like `boost`/`shield`): `spinT, stunT, slowT, slowMul, warned, trapHitCD`. The race movement reads them before steering:
```js
if (r.stunT > 0) { r.stunT -= dt; r.speed = 0; }
else { if (r.spinT > 0) { r.spinT -= dt; r.heading += 8*dt; steer = 0; }
       let sp = r.baseSpeed; if (r.slowT > 0) { r.slowT -= dt; sp *= r.slowMul; }
       r.speed = sp * (r.boost > 0 ? 1.6 : 1); }
```

**New SFX** (ZzFX, add to `sfx.js`): `missile_lock`, `missile_launch`, `missile_impact` (= `dm_death`), `thunder`, `emp_zap`. The "!" reuses the existing `warn` alarm.

### 9.5 Config block

```js
export const RACE_ITEMS = {
  zones: [0.25, 0.50, 0.75],          // fractions of trackLength → [900,1800,2700] at 3600
  zoneR: 14,
  boostT: 2.2, shieldT: 3.5, mushroomT: 1.4, mushroomMul: 2.6,
  trapR: 1.6, trapLife: 18, oilSlipT: 0.8, oilMul: 0.5, bananaSpinMul: 0.35,
  lightningT: 1.5, lightningMul: 0.45,
};
export const PROJ = {
  missile: { speed: 64, turn: 3.4, life: 4.0, warn: 0.6, hitR: 2.2, react: 'spin' },
  emp:     { speed: 90, turn: 0.0, life: 1.1, warn: 0.45, hitR: 2.0, react: 'stun' },
};
```

---

## 10. UI / UX & Screens

Every screen reuses the existing pixel aesthetic (Galmuri font, `:root` CSS vars, chunky box-shadow panels) and code patterns. All new overlays inject CSS once (the `injected` flag pattern), live at `z-index:60+`, and use one low-res WebGL canvas + CSS `pixelated` upscale.

| New thing | Reuses | File:func |
|---|---|---|
| Augment-select screen | `openKartSelect` overlay shell | `kartselect.js` |
| Augment card 3D icons | offscreen-RT→dataURL | `main.js renderItemIcons` |
| Build sidebar chips | `dmItem` slot + `setItemIcon` | `main.js` |
| Round scoreboard / intermission | `#dmStandings` (`showDmStandings`) | `main.js` |
| DM-round HUD | `updateDmHud` | `main.js` |
| Final-race HUD | `updateHud` + `.side`/`.prog` | `main.js` |
| Map-reveal / GO! | `#ksCount` countdown | `kartselect.js` |
| Podium / results | `#dmStandings` + podium scene + `launchFw` fireworks | `main.js` / `deathmatch.js` |

**Shared utils to extract:** `bigCountdown()` and `flashWipe()` (lift from kartselect), `renderBuild()` (build-shelf component), `AUG_IMG` icon cache (mirrors `ITEM_IMG`).

### 10.1 Augment-select screen (centerpiece)

Layout: title (라운드 N 증강 선택 · RANK #3/8) + auto-pick countdown ring (top-right) + left BUILD sidebar (owned augments stacked, future slots as `▢`, current points + rank in footer) + 3 tier-colored cards + party pick-state row (`P2 ✔ P4 ✔ … P1 고르는 중`) + hint bar.

**Tier coloring** (drives card border, header strip, icon rim glow): Silver `#9fb2c8` flat · Gold `--yellow #ffd54a` · Prismatic animated cyan→magenta sweep (`@keyframes prismShift`) · (optional Cursed/Risk `--red`). Tier is readable at a glance without text.

**Interaction:** A/D or ←/→ move, SPACE/ENTER lock, mouse hover+click. Lock → corner OK badge + `item_grant` sfx + resolves immediately for that player. **Party:** never blocks on others — once *you* lock you see `상대 대기중…`; the controller proceeds when all-locked OR `autoMs` (12s) elapses. The BUILD sidebar component (`renderBuild`) is **reused** as the in-round HUD build tracker.

### 10.2 Intermission (between rounds)

Three skippable sub-beats (≤2.5s each): **A —** Round scoreboard (reuse `#dmStandings`, retitled `라운드 N 결과`, +pts earned + running total column). **B —** Augment teaser banner → routes into `openAugmentSelect`. **C —** Map reveal (next map name + preview thumbnail [DEP: map subsystem `getMapPreviewImage`] + hazard tagline) → `#ksCount` 3→2→1→GO! For the **final round**, Beat C uses a distinct treatment: straight-road silhouette, `🏁 결승 레이스`, `500 PTS` callout, `아이템 3구간 · 꼴찌에게 최고의 무기` subtext.

### 10.3 In-round HUD (DM rounds)

Extends `updateDmHud` (does not replace). Existing `#dmScore` (top-left) + `#dmItem` (bottom-center) stay. **Adds:** `#lrBuildHud` (top-right, horizontal owned-augment trophy shelf, hover→tooltip; hidden in 2P split) + `#lrMatchBar` (top-center thin pill: `라운드 N/6 · 내 점수 240 · 순위 #2` + round pips ●●●○○○). Augment-driven cues surface through the existing `#dmItem` slot + `scorePop('증강 발동!','plus')` — no new widget.

### 10.4 Final-race HUD

Extends `updateHud`. **`#lrRacePos`** (top-right live ranked list by track progress, local row highlighted). **Race item slot** reuses `#dmItem` + `setItemIcon` + `startItemRoll` verbatim. **`#lrMissileWarn`** — the marquee moment: target's client flashes a large centered red `!` (Galmuri 200px, `steps()` blink) for ~0.6s, then the homing missile flies in; the firer sees a `🚀 미사일 발사 → 1등` toast; the leader gets a small pulsing `🔒` lock indicator. **Rubber-band telegraph:** when the local player is last and enters a zone, the item slot does an extra-long, extra-shiny roll so the comeback drop *feels* generous.

### 10.5 Results / podium

New `src/results.js`: podium scene (reuse hero/kartselect podium-cylinders + `mountRider`, top 3 on gold/silver/bronze, `winCam` orbit) + fireworks (`launchFw`/`updateFw`) + final standings (`#dmStandings` retitled `최종 결과`, total points, a `RACE` badge weighting the 500-pt column, 👑 on champion) + per-player build recap (`renderBuild` shelf) + footer `SPACE 다시하기 · ESC 메뉴`.

### 10.6 2P / online

Local 2P split → two side panels (reuse the `count===2 ['l','r']` kartselect layout), both pick simultaneously, build HUD shrinks to icon-only. Online → single-panel pick + the party pick-state row.

---

## 11. Net / Party (PeerJS star, host-authoritative)

Reuse `net.js` star relay + `applyRemote`. **The host is the single source of truth** for `M.points`, `M.augments`, the map index, and phase transitions; guests are display-only for orchestration state.

New message types over the existing star relay:
- `{t:'lrPhase', phase, round, mapIndex, seed}` (host→all, drives guest state machine; `seed` is a host PRNG for reproducible/anti-cheat augment offers).
- `{t:'lrAugmentOffer', pid, cards}` + `{t:'lrAugmentPick', pid, idx}` (augment sync).
- `{t:'raceItem', op:'pickup'|'fire', kind, from, x, z}` + `{type:'hit', victim, kind, by}` (race items / missile).
- Reuse existing `{t:'st', slot, ...}` for in-round rider sync (DM `'st'`/`'dead'` relay already exists).

Local/bot play must work with all of these stubbed (it always did — `useItem → fireProjectile` is fully local).

---

## 12. Cross-Subsystem Conflicts — Resolutions

| Conflict | Designers' positions | Resolution |
|---|---|---|
| **Mode token** | round-flow `'LR'` vs roadmap `'LEGEND'` | **`'LEGEND'`** canonical. |
| **# augment picks** | "6 picks (1 + 5 between)" everywhere; one diagram showed augment-per-round | **6 picks**: 1 opening + 5 between rounds; the 6th feeds the final race. |
| **Item-zone positions** | `[750,1500,2250]` (track 3000) vs `[900,1800,2700]` (track 3600) | Compute as **fractions `[0.25,0.5,0.75] × trackLength`**; with the spec's `trackLength 3600` → `[900,1800,2700]`. |
| **Missile spec** | race-items granted it & delegated flight; missile-combat owned flight | **Unified in §9.4** (one table: target=leader, 0.6s warn, speed 64 / turn 3.4, spin-out). |
| **Banana vs trap** | race-items `banana` vs combat `trap` (same mechanic) | **One item (`banana`)** for v1; `trap`/`emp` reserved as later combat variants. |
| **Augment rarity weighting** | augment subsystem (round-bias) vs scoring subsystem (placement-bias) | **Both compose** in `offer()` (round-bias × placement-bias). Augment owns content+UI; scoring hands the weight table. |
| **Scoring dominance (race 500 vs DM 5×100)** | flat 500 "too swingy" concern | **Symmetric ceilings by design** (both ≈500); validated by scenarios (§8.1). Levers are two data arrays. |
| **Final-race multi-rider** | `createRaceArena` factory vs ghost `opp` entities | **MVP = ghost `opp` entities** on `distance`; **richer = `createRaceArena`** N-bike factory later. Either must emit `finishOrder[]`. |
| **mapDef param position** | round-flow "5th param" vs maps "4th param" | **4th param** `createArenaWorld(riderDefs, modeKey, scorePop, mapDef)`. |

---

## 13. Open Questions / Decisions for the User

1. **Field size:** spec assumes **8 riders** (round-flow) but scoring is tuned for **6**. Pick the canonical lobby size, or accept the N-player generators (§8.6) as the source and hand-tune only that size. *(Recommend: lock 6 for tuning, generate for others.)*
2. **Round-winner bonus pick (§8.4 lever 2):** ship the gold-guaranteed pick for DM winners, or rely only on placement-based rarity? *(Recommend: ON — keeps winning meaningful.)*
3. **Final-race rider count / AI:** MVP ghost-racers vs full `createRaceArena` multi-bike scene? Affects how "real" the finale feels vs build cost. *(Recommend: ghosts for Phase 3, upgrade later.)*
4. **Missile target when firer is leader:** re-target nearest-ahead (chosen) vs fizzle? Confirm the re-target feels fair.
5. **Item count in the final:** 3 zones × once = max 3 items/race. If item-starved vs carried augments, add a 4th zone or re-enable zones. *(Playtest.)*
6. **Pool size:** ship 42 augments, trim to 36, or expand to 48? Affects draft variety vs balance surface.
7. **Match length target:** ~15–16 min mean acceptable for "the main mode"? `dmRoundTime` is the lever.
8. **Augment vs vehicle-stat stacking:** depends on whether `r.st` (VEHICLE_DESIGN proposal) is merged. Confirm merge order; augments default `r.st` to 1.0 if absent.

---

## 14. Config Additions (`src/config.js`)

```js
export const LEGEND = {
  dmRounds: 5, dmModeKey: 'lives', dmRoundTime: 150, dmSuddenDeathAt: 120,
  augmentsPerOffer: 3, intermissionTime: 6, countdownTime: 3, fieldSize: 8,  // see OQ #1
};
export const DM_PTS   = [100, 72, 50, 33, 20, 10];
export const RACE_PTS = [500, 330, 220, 140, 80, 30];
export const LEGEND_MAPS = [ /* 5 mapDef objects — §7.2 */ ];
export const FINAL_TRACK = { length: 3600, itemZoneFracs: [0.25,0.5,0.75], coneSkip: 15 };
// + RACE_ITEMS, PROJ (§9.5), ITEM_ICON additions
```

---

## 15. Implementation Roadmap (FINAL — actionable, MVP-first)

Each phase ends in a bootable state with a `window.__legend` hook for Playwright assertions. New files: `src/legend.js` (FSM), `src/augmentselect.js`, `src/augments.js`, `models/augments.js`, `src/maps.js`/`LEGEND_MAPS`, `src/intermission.js`, `src/results.js`. Edits: `src/config.js`, `src/deathmatch.js` (6 augment seams + `mapDef` param), `src/main.js` (`gameMode='LEGEND'`, `startLegend`, one `loop()` branch), `models/items.js` (race-item builders).

**Strategy:** stub the augment overlay (auto-pick) and final race (a DM round as placeholder) to get the whole 5-round loop running end-to-end first, then swap in real subsystems.

### Phase 1 — 5-round lives-DM loop + scoring (no augments) ⭐ MVP
**Build:** `src/legend.js` FSM; `startLegend`; the `loop()` LEGEND branch; reuse `createArenaWorld(defs,'lives',scorePop)` for all 5 rounds (same map for now); points between rounds (`DM_PTS`); a minimal "round N / standings" banner (fork `showDmStandings`); skip augment screen (auto-advance); final round = a 6th DM round (race in P3).
**Playable:** full 5-round vs-bots match with a cumulative scoreboard and a winner.
**Verify (Playwright):** `__legend.phase` cycles `dm`→`dm` 5×, `__legend.round` reaches 4, `__legend.points` non-zero → final rank.
**Risk:** world teardown leaks → explicit `world.dispose()` (traverse-dispose, like `setVehicle`).

### Phase 2 — Augment select + ~12 augments
**Build:** `models/augments.js` (12 stat/economy augments via existing seams only), `src/augmentselect.js` (fork kartselect), `applyAugments` integration, the 6 `rider.aug` consumption seams in `deathmatch.js`, 6 picks woven into the FSM.
**Playable:** picks visibly stack — by round 5 your bike is measurably faster/item-rich.
**Verify:** `__legend.augments[mySlot].length` increments each round; a stat augment changed `riders[0].aug.speed`; screenshot the overlay.
**Risk (biggest): augment ↔ vehicle-stat stacking.** Default `r.st` to 1.0; small bounded multipliers; peak clamped by `Math.min(1, pitch/cap)`.

### Phase 3 — Final race + rubber-band items
**Build:** swap round 6 for a `createWorld`-based race (ghost `opp` bot racers on `distance`); 3 item zones + rank-based grant (reuse `grantItems` rank logic); `RACE_PTS` 500-pt scoring; apply race-applicable augments; emit `finishOrder[]`.
**Playable:** 5 DM rounds → a real race finale with items; final rank reflects 500-pt weighting.
**Verify:** `__legend.phase==='race'` after round 5; `world.game.state` reaches FINISHED; last place got the stronger item.
**Risk:** `createWorld` is single-track → ghost racers, not new physics.

### Phase 4 — Missile + combat
**Build:** `'missile'` item (the §9.4 spec: `!` warning + homing projectile pool → spin-out), register in item pipeline, targets race 1st place; new SFX.
**Playable:** last place can missile the leader; Mario-Kart catch-up.
**Verify:** grant missile to a trailing entity → fire → leader's `game.state` → CRASHED/spin after flight delay; screenshot the `!`.
**Risk:** MP missile authority → keep local/bots only until P6.

### Phase 5 — 5 distinct maps
**Build:** `LEGEND_MAPS` data + `mapDef` param on `createArenaWorld` (bg/fog/startR/pads minimum; hazards/masks for maps 2–5); round i → map i.
**Playable:** every round looks/plays differently.
**Verify:** each round's scene background differs per index; screenshot all 5.
**Risk:** static/moving collision reuses `addSeg`/`distToSeg` (`y0` logic) — keep most maps data-only to limit blast radius.

### Phase 6 — Online / party
**Build:** drive the FSM over `net` (host-authoritative): host broadcasts phase transitions + augment choices + map index + scores (§11); guests render. Reuse `DMO` streaming for DM rounds + the racing `'state'` stream for the finale.
**Playable:** 2–4 humans run the full ranked match together (local/bots still work from P1).
**Verify:** two-tab Playwright: host starts, both advance phases in lockstep; `__legend.phase` matches across tabs.
**Risk (biggest overall): orchestration desync.** Host is the single source of truth for points/augments/map; guests are display-only.

### Top technical risks (ranked)
1. Online orchestration desync (P6) → host-authoritative `M`, broadcast every transition.
2. Augment × vehicle-stat runaway (P2) → bounded muls, `r.st` defaults 1.0, peak clamp.
3. Bots in the final race (P3) → ghost-entity racers on `distance`.
4. GPU/world lifecycle leaks across 6 sequential worlds (P1) → explicit `dispose()`.
5. Missile targeting authority in MP (P4/P6) → local-only until P6, then host-resolves.
6. The only engine-internal edits are the 6 augment seams + `mapDef` param + race-item zones; everything else is orchestration + data.

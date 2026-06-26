// MOTO STUNT — 레전드 정규전 (Legend Ranked) match controller. See docs/LEGEND_MODE.md.
// Phase 1: N rounds of lives-deathmatch (reusing createArenaWorld) + cumulative scoring + winner.
// Phase 2: an AUGMENT pick before each round — 3 options, pick 1, effects STACK across rounds.
//   The human picks via the injected `openAugment` callback (UI); bots auto-pick. Resolved mods
//   are injected into each round's rider defs (def.aug) — deathmatch.js stays decoupled.
// Exposed at window.__legend.
import { createArenaWorld } from './deathmatch.js';
import { LEGEND, DM_COLORS, legendTable } from './config.js';
import { resolveMods, offerAugments, botPickAugment } from '../models/augments.js';
import { VEHICLES } from '../models/vehicles.js';

// free a finished round's GPU resources before building the next (6 worlds in a row otherwise leak)
function disposeWorld(w) {
  if (!w || !w.scene) return;
  w.scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => x && x.dispose && x.dispose());
  });
}

export function createLegendMatch({ humanVehicle = 'dirtbike', humanColor = 0xff5a3c, fieldSize = LEGEND.fieldSize, scorePop = () => {}, openAugment = null } = {}) {
  const n = Math.max(2, Math.min(8, fieldSize | 0));
  const VK = VEHICLES.map(v => v.key);
  const defs = [{ color: humanColor, isBot: false, name: '나', vehicle: humanVehicle }];
  for (let i = 1; i < n; i++) defs.push({ color: DM_COLORS[i % DM_COLORS.length], isBot: true, name: 'P' + (i + 1), vehicle: VK[(i * 3) % VK.length] });
  const players = defs.map((d, i) => ({ idx: i, name: d.name, pts: 0, placeHist: [], dmFirsts: 0, augments: [] }));

  const M = {
    phase: 'augment', round: 0, totalRounds: LEGEND.dmRounds + 1,   // 5 DM + 1 placeholder final = 6
    world: null, localSlot: 0, players, defs, active: true,
    roundClock: 0, interClock: 0, ending: null, banner: '', lastOffer: [],
  };

  function placement(w) {   // finishing order by score (same sort as showDmStandings)
    return w.riders.filter(r => !r.startDead).sort((a, b) => b.score - a.score).map(r => r.idx);
  }
  function buildRound() {
    disposeWorld(M.world);
    M.world = createArenaWorld(M.defs, LEGEND.dmModeKey, scorePop);
    M.roundClock = 0; M.ending = null; M.phase = 'dm';
  }
  // resolve every rider's owned augments into def.aug, then build the round
  function applyPicks(humanPickedId) {
    const me = players[M.localSlot];
    if (humanPickedId) me.augments.push(humanPickedId);
    for (const p of players) if (p.idx !== M.localSlot) { const id = botPickAugment(p.augments); if (id) p.augments.push(id); }
    M.defs.forEach((d, i) => { d.aug = resolveMods(players[i].augments, d.vehicle, 'dm'); });
    buildRound();
  }
  // AUGMENT phase: offer 3, human picks via UI callback (bots auto), then build the round.
  async function runAugmentPhase() {
    M.phase = 'augment';
    const me = players[M.localSlot];
    const opts = offerAugments(me.augments, 3);
    M.lastOffer = opts;
    let picked = opts.length ? opts[0].id : null;   // headless / fallback default
    if (openAugment) { try { picked = await openAugment(M.round + 1, opts, M.defs[M.localSlot].vehicle); } catch (e) { /* keep default */ } }
    applyPicks(picked);
  }
  function resolveRound() {
    const isFinal = M.round >= M.totalRounds - 1;
    const table = legendTable(M.defs.length, isFinal ? 'race' : 'dm');
    placement(M.world).forEach((ridx, place) => {
      const p = players.find(pp => pp.idx === ridx);
      p.pts += table[place] != null ? table[place] : table[table.length - 1];
      p.placeHist.push(place);
      if (!isFinal && place === 0) p.dmFirsts++;
    });
    if (isFinal) { M.phase = 'results'; M.active = false; M.banner = '최종 결과'; }
    else { M.phase = 'intermission'; M.interClock = LEGEND.intermissionTime; M.banner = `라운드 ${M.round + 1}/${M.totalRounds} 결과`; }
  }
  // sorted cumulative standings (for HUD)
  M.standings = () => [...players].sort((a, b) => b.pts - a.pts || (b.dmFirsts - a.dmFirsts));
  M.myRank = () => M.standings().findIndex(p => p.idx === M.localSlot) + 1;
  M.myAugments = () => players[M.localSlot].augments.slice();

  M.start = () => runAugmentPhase();   // round 0: opening augment pick -> builds round 0

  M.tick = function (dt, inputs) {
    if (M.phase === 'dm' && M.world) {
      M.world.update(dt, inputs);
      M.roundClock += dt;
      if (M.ending == null && (M.world.S.over || M.roundClock > LEGEND.dmRoundTime)) M.ending = 1.6;  // let the round-over banner breathe
      if (M.ending != null) { M.ending -= dt; if (M.ending <= 0) resolveRound(); }
    } else if (M.phase === 'intermission') {
      if (M.world) M.world.update(dt, inputs);   // victory cam keeps orbiting
      M.interClock -= dt;
      if (M.interClock <= 0) { M.round++; runAugmentPhase(); }   // -> AUGMENT phase -> next round
    }
    // 'augment' / 'results' phases: idle (UI overlay drives the augment pick)
  };
  M.dispose = () => { disposeWorld(M.world); M.world = null; M.active = false; };

  return M;
}

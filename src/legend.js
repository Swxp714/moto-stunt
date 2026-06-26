// MOTO STUNT — 레전드 정규전 (Legend Ranked) match controller. See docs/LEGEND_MODE.md.
// Phase 1 (MVP): orchestrates N rounds of lives-deathmatch (reusing createArenaWorld),
// accumulates points (DM_PTS / RACE_PTS), declares a winner. No augments / no race yet
// (the final round is a placeholder extra DM round). Exposed at window.__legend.
import { createArenaWorld } from './deathmatch.js';
import { LEGEND, DM_COLORS, legendTable } from './config.js';
import { VEHICLES } from '../models/vehicles.js';

// free a finished round's GPU resources before building the next (6 worlds in a row otherwise leak)
function disposeWorld(w) {
  if (!w || !w.scene) return;
  w.scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => x && x.dispose && x.dispose());
  });
}

export function createLegendMatch({ humanVehicle = 'dirtbike', humanColor = 0xff5a3c, fieldSize = LEGEND.fieldSize, scorePop = () => {} } = {}) {
  const n = Math.max(2, Math.min(8, fieldSize | 0));
  const VK = VEHICLES.map(v => v.key);
  const defs = [{ color: humanColor, isBot: false, name: '나', vehicle: humanVehicle }];
  for (let i = 1; i < n; i++) defs.push({ color: DM_COLORS[i % DM_COLORS.length], isBot: true, name: 'P' + (i + 1), vehicle: VK[(i * 3) % VK.length] });
  const players = defs.map((d, i) => ({ idx: i, name: d.name, pts: 0, placeHist: [], dmFirsts: 0 }));

  const M = {
    phase: 'dm', round: 0, totalRounds: LEGEND.dmRounds + 1,   // 5 DM + 1 placeholder final = 6
    world: null, localSlot: 0, players, defs, active: true,
    roundClock: 0, interClock: 0, ending: null, banner: '',
  };

  function placement(w) {   // finishing order by score (same sort as showDmStandings)
    return w.riders.filter(r => !r.startDead).sort((a, b) => b.score - a.score).map(r => r.idx);
  }
  function buildRound() {
    disposeWorld(M.world);
    M.world = createArenaWorld(M.defs, LEGEND.dmModeKey, scorePop);
    M.roundClock = 0; M.ending = null; M.phase = 'dm';
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

  M.tick = function (dt, inputs) {
    if (M.phase === 'dm' && M.world) {
      M.world.update(dt, inputs);
      M.roundClock += dt;
      if (M.ending == null && (M.world.S.over || M.roundClock > LEGEND.dmRoundTime)) M.ending = 1.6;  // let the round-over banner breathe
      if (M.ending != null) { M.ending -= dt; if (M.ending <= 0) resolveRound(); }
    } else if (M.phase === 'intermission') {
      if (M.world) M.world.update(dt, inputs);   // victory cam keeps orbiting
      M.interClock -= dt;
      if (M.interClock <= 0) { M.round++; buildRound(); }
    }
  };
  M.dispose = () => { disposeWorld(M.world); M.world = null; M.active = false; };

  buildRound();
  return M;
}

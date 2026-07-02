// MOTO STUNT — 레전드 정규전 (Legend Ranked) match controller. See docs/LEGEND_MODE.md.
// Phase 1: N rounds of lives-deathmatch (reusing createArenaWorld) + cumulative scoring + winner.
// Phase 2: an AUGMENT pick before each round — 3 options, pick 1, effects STACK across rounds.
//   The human picks via the injected `openAugment` callback (UI); bots auto-pick. Resolved mods
//   are injected into each round's rider defs (def.aug) — deathmatch.js stays decoupled.
// Exposed at window.__legend.
import { createArenaWorld } from './deathmatch.js';
import { createRaceArena } from './race.js';
import { LEGEND, DM_COLORS, legendTable, FINAL_TRACK } from './config.js';
import { resolveMods, offerAugments, botPickAugment, AUG_MAP } from '../models/augments.js';
import { VEHICLES } from '../models/vehicles.js';

// free a finished round's GPU resources before building the next (6 worlds in a row otherwise leak)
function disposeWorld(w) {
  if (!w || !w.scene) return;
  w.scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => x && x.dispose && x.dispose());
  });
}

export function createLegendMatch({ humanVehicle = 'dirtbike', humanColor = 0xff5a3c, fieldSize = LEGEND.fieldSize, scorePop = () => {}, openAugment = null, netRole = 'local', netSend = () => {}, roster = null, localSlot = 0 } = {}) {
  const VK = VEHICLES.map(v => v.key);
  let defs, mySlot;
  if (roster) {   // online: roster assembled by the host (humans + bots), with remote flags + my slot
    defs = roster.map(r => ({ color: r.color, name: r.name, isBot: !!r.isBot, remote: !!r.remote, vehicle: r.vehicle }));
    mySlot = localSlot;
  } else {        // local: 1 human + bots
    const n = Math.max(2, Math.min(8, fieldSize | 0));
    defs = [{ color: humanColor, isBot: false, name: '나', vehicle: humanVehicle }];
    for (let i = 1; i < n; i++) defs.push({ color: DM_COLORS[i % DM_COLORS.length], isBot: true, name: 'P' + (i + 1), vehicle: VK[(i * 3) % VK.length] });
    mySlot = 0;
  }
  const players = defs.map((d, i) => ({ idx: i, name: d.name, pts: 0, placeHist: [], dmFirsts: 0, augments: [] }));

  const M = {
    phase: 'augment', round: 0, totalRounds: LEGEND.dmRounds + 1,   // 5 DM rounds + 1 final RACE = 6
    world: null, race: null, localSlot: mySlot, players, defs, active: true, netRole,
    roundClock: 0, interClock: 0, ending: null, banner: '', lastOffer: [], _picks: {}, _pickResolve: null,
  };

  // finishing RANK (등수): survivors first, then by elimination order (last eliminated ranks higher).
  // 1등 = 최후 생존자 → DM_PTS[0] (최다 점수). kills still drive survival + the survivor tiebreak.
  function placement(w) {
    return w.riders.filter(r => !r.startDead).sort((a, b) => {
      const aAlive = a.lives > 0, bAlive = b.lives > 0;
      if (aAlive !== bAlive) return aAlive ? -1 : 1;        // survivor outranks eliminated
      if (aAlive && bAlive) return b.score - a.score;       // tied survivors (timer cap) -> by score
      return (b.elimAt || 0) - (a.elimAt || 0);             // eliminated -> later elimination ranks higher
    }).map(r => r.idx);
  }
  function buildRound() {
    disposeWorld(M.world); disposeWorld(M.race); M.world = null; M.race = null;
    if (M.round >= M.totalRounds - 1) {   // final round = the RACE (결승 직선)
      M.race = createRaceArena(M.defs, { trackLength: FINAL_TRACK.length, timeCap: FINAL_TRACK.timeCap, scorePop });
      M.phase = 'race';
    } else {
      M.world = createArenaWorld(M.defs, LEGEND.dmModeKey, scorePop);
      M.phase = 'dm';
    }
    M.roundClock = 0; M.ending = null;
  }
  // resolve all collected picks (M._picks) into def.aug, then build the round. host also broadcasts.
  function commitPicks() {
    for (const p of players) { const id = M._picks[p.idx]; if (id) p.augments.push(id); }
    M.defs.forEach((d, i) => { d.aug = resolveMods(players[i].augments, d.vehicle, 'dm'); });
    if (M.netRole === 'host') {
      const kind = M.round >= M.totalRounds - 1 ? 'race' : 'dm';
      netSend({ t: 'lrRoundStart', round: M.round, kind, augById: players.map(p => p.augments.slice()) });
    }
    buildRound();
  }
  function waitPicks(slots) {   // host: resolve once every listed slot has picked (or 12s AFK timeout)
    return new Promise((res) => {
      const done = () => slots.every(s => M._picks[s] != null);
      if (done()) return res();
      M._pickResolve = () => { if (done()) { M._pickResolve = null; res(); } };
      setTimeout(() => { M._pickResolve = null; res(); }, 12000);
    });
  }
  // AUGMENT phase. local/host: make offers, collect picks (local UI + remote), resolve, build.
  // guest: no-op here — driven by applyNet(lrAugOffer/lrRoundStart).
  async function runAugmentPhase() {
    M.phase = 'augment';
    if (M.netRole === 'guest') return;
    M._picks = {};
    const humanIdx = players.filter(p => !M.defs[p.idx].isBot).map(p => p.idx);
    const offers = {};
    for (const i of humanIdx) offers[i] = offerAugments(players[i].augments, 3, Math.random, M.defs[i].vehicle);
    if (M.netRole === 'host') for (const i of humanIdx) if (M.defs[i].remote) netSend({ t: 'lrAugOffer', slot: i, round: M.round, options: offers[i].map(o => o.id) });
    M.lastOffer = offers[M.localSlot] || [];
    let myPick = M.lastOffer.length ? M.lastOffer[0].id : null;
    if (openAugment && M.lastOffer.length) { try { myPick = await openAugment(M.round + 1, M.lastOffer, M.defs[M.localSlot].vehicle); } catch (e) { /* keep default */ } }
    M._picks[M.localSlot] = myPick;
    if (M.netRole === 'host') await waitPicks(humanIdx.filter(i => M.defs[i].remote));
    for (const p of players) if (M.defs[p.idx].isBot) M._picks[p.idx] = botPickAugment(players[p.idx].augments, Math.random, M.defs[p.idx].vehicle);
    for (const i of humanIdx) if (M._picks[i] == null) M._picks[i] = offers[i][0] && offers[i][0].id;   // AFK fallback
    commitPicks();
  }
  function applyOrder(order, isFinal) {
    const table = legendTable(M.defs.length, isFinal ? 'race' : 'dm');
    order.forEach((ridx, place) => {
      const p = players.find(pp => pp.idx === ridx); if (!p) return;
      p.pts += table[place] != null ? table[place] : table[table.length - 1];
      p.placeHist.push(place);
      if (!isFinal && place === 0) p.dmFirsts++;
    });
  }
  function resolveRound() {   // host/local: judge order, score, broadcast, transition
    const isFinal = M.round >= M.totalRounds - 1;
    const order = isFinal ? M.race.S.finishOrder.slice() : placement(M.world);
    applyOrder(order, isFinal);
    if (M.netRole === 'host') netSend({ t: 'lrScore', round: M.round, order });
    if (isFinal) { M.phase = 'results'; M.active = false; M.banner = '최종 결과'; if (M.netRole === 'host') netSend({ t: 'lrResults' }); }
    else { M.phase = 'intermission'; M.interClock = LEGEND.intermissionTime; M.banner = `라운드 ${M.round + 1}/${M.totalRounds} 결과`; }
  }
  // guest: apply host orchestration messages. host: also record remote picks (lrAugPick).
  M.applyNet = function (msg) {
    if (msg.t === 'lrAugPick') { M._picks[msg.slot] = msg.augId; if (M._pickResolve) M._pickResolve(); }
    else if (msg.t === 'lrAugOffer') {
      M.phase = 'augment';
      const opts = (msg.options || []).map(id => AUG_MAP[id]).filter(Boolean);
      M.lastOffer = opts;
      (async () => {
        let pick = opts.length ? opts[0].id : null;
        if (openAugment && opts.length) { try { pick = await openAugment(msg.round + 1, opts, M.defs[M.localSlot].vehicle); } catch (e) {} }
        netSend({ t: 'lrAugPick', slot: M.localSlot, round: msg.round, augId: pick });
      })();
    } else if (msg.t === 'lrRoundStart') {
      players.forEach((p, i) => { p.augments = (msg.augById[i] || []).slice(); });
      M.defs.forEach((d, i) => { d.aug = resolveMods(players[i].augments, d.vehicle, msg.kind === 'race' ? 'race' : 'dm'); });
      M.round = msg.round; buildRound();
    } else if (msg.t === 'lrScore') {
      const isFinal = M.round >= M.totalRounds - 1;
      applyOrder(msg.order, isFinal);
      if (isFinal) { M.phase = 'results'; M.active = false; M.banner = '최종 결과'; }
      else { M.phase = 'intermission'; M.interClock = LEGEND.intermissionTime; M.banner = `라운드 ${M.round + 1}/${M.totalRounds} 결과`; }
    } else if (msg.t === 'lrResults') { M.phase = 'results'; M.active = false; M.banner = '최종 결과'; }
  };
  // sorted cumulative standings (for HUD)
  M.standings = () => [...players].sort((a, b) => b.pts - a.pts || (b.dmFirsts - a.dmFirsts));
  M.myRank = () => M.standings().findIndex(p => p.idx === M.localSlot) + 1;
  M.myAugments = () => players[M.localSlot].augments.slice();

  M.start = () => runAugmentPhase();   // round 0: opening augment pick -> builds round 0

  const solo = () => M.netRole !== 'guest';   // guest never self-advances the FSM (host-authoritative)
  M.tick = function (dt, inputs) {
    if (M.phase === 'dm' && M.world) {
      M.world.update(dt, inputs);
      if (solo()) {
        M.roundClock += dt;
        if (M.ending == null && (M.world.S.over || M.roundClock > LEGEND.dmRoundTime)) M.ending = 1.6;  // let the round-over banner breathe
        if (M.ending != null) { M.ending -= dt; if (M.ending <= 0) resolveRound(); }
      }
    } else if (M.phase === 'race' && M.race) {
      M.race.update(dt, inputs && inputs[0]);   // 결승 레이스: local racer driven by input[0]
      if (solo()) {
        if (M.ending == null && M.race.S.over) M.ending = 2.4;   // let the finish + winCam breathe
        if (M.ending != null) { M.ending -= dt; if (M.ending <= 0) resolveRound(); }
      }
    } else if (M.phase === 'intermission') {
      if (M.world) M.world.update(dt, inputs);   // victory cam keeps orbiting
      if (solo()) { M.interClock -= dt; if (M.interClock <= 0) { M.round++; runAugmentPhase(); } }   // -> AUGMENT phase -> next round
    }
    // 'augment' / 'results' phases: idle (UI overlay drives the augment pick); guest waits for host msgs
  };
  M.dispose = () => { disposeWorld(M.world); disposeWorld(M.race); M.world = null; M.race = null; M.active = false; };

  return M;
}

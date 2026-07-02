// MOTO STUNT — tuning & constants (single source for gameplay numbers + palettes).
// Pure data, zero dependencies. Mirror of GAMEPLAN §10. See docs/ARCHITECTURE.md.

// --- racing (createWorld) tuning ---
export const CFG = {
  baseSpeed: 60, wheelieSpeedMul: 2.3, steerSpeed: 22, roadWidth: 12,
  wheelieAccel: 7,   // how fast speed ramps toward the wheelie boost (higher = snappier)
  rewindSeconds: 2,  // on death, respawn at the position from this many seconds ago
  kbWheelie: 0.5,    // keyboard wheelie-up strength (1 = full rate; lower = raises slower)
  speedWarp: 0.55,   // barrel screen-warp strength at top speed
  maxPitch: 1.0, pitchRiseRate: 2.2, pitchFallRate: 2.5, trackLength: 3000,
  respawnFreeze: 1.0, invincibleTime: 1.5,
  pixelSize: 4,            // (legacy fallback) low-res RT downscale factor
  // responsive pixel grid: target a FIXED dot-row count so the dot look stays consistent
  // across window sizes (small windows get smaller dots, not fewer dots). ps derived per-resize.
  targetH: 270,            // target dot-rows for the scene (1080p → ps 4, matches the old look)
  dotMin: 2, dotMax: 5,    // clamp screen-px per dot (min readable .. max chunky)
  aspectRef: 1.7778,       // 16:9 — below this, hold horizontal FOV constant (no UI clipping)
  maxVFov: 75,             // cap GAME-camera vertical FOV so narrow/split aspects don't fisheye
  // webcam (motion) control feel — gentler + finer near center so small hand moves = small input
  motionSteer: 0.82, motionSteerCurve: 1.5,
  motionWheelie: 0.85, motionWheelieCurve: 1.3,
  colorSteps: 6, dither: 0.65,  // pixel-art grade — softened so bike shapes read clearly
};

export const STATE = { RIDING: 'riding', CRASHED: 'crashed', FINISHED: 'finished' };

// --- deathmatch (createArenaWorld) tuning ---
export const DM = { moveSpeed: 34, turnRate: 2.6, arenaR: 135, startR: 58,
  trailGap: 1.6, trailW: 1.2, trailH: 2.4, graceSegs: 6, trailMax: 68, // tail length cap
  shrinkRate: 2.4, minR: 32, wheelieMul: 2.4,      // shrink rate; wheelie speed boost (stronger)
  jumpPadR: 3.8, jumpTime: 0.85, jumpHeight: 7, jumpPads: 9,  // jump ramps
  // --- shared score/respawn tuning ---
  matchTime: 300, respawnDelay: 2, invulnTime: 2.2, killScore: 2, minR: 32,
  itemInterval: 20,     // rank-based item handed out every N seconds
  outLimit: 3 };        // 경계 밖 누적 허용 시간(초) — 넘기면 사망 (재입장해도 리셋 안 됨)

// three deathmatch sub-modes  (arenas enlarged — big open maps)
export const DM_MODES = {
  score:    { name: '점수전 (5분)',   startR: 128, shrink: false, timer: 300, maxLives: 0, // 0 = infinite respawn
    desc: '5분간 점수 경쟁 · 죽으면 −1 · 킬 +2 · 무한 리스폰 · 넓은 맵' },
  survival: { name: '서바이벌 (즉사)', startR: 118, shrink: true,  timer: 0,   maxLives: 1,
    desc: '한 번 죽으면 끝 · 맵이 점점 좁아짐 · 최후의 1인 승리' },
  lives:    { name: '목숨 3개',        startR: 124, shrink: true,  timer: 0,   maxLives: 3,
    desc: '목숨 3개 · 맵이 좁아짐 · 다 잃으면 탈락 · 최후의 1인' },
};

// --- palettes / icons ---
export const ITEM_ICON = { jump: '⤴️', boost: '💨', shield: '🛡️', super: '🔥' };
export const HERO_COLORS = [0xe8842a, 0xe14b4b, 0x4b86e1, 0x49b96a, 0x9b59d0, 0xf2c53d];
export const DM_COLORS = [0xff5a3c, 0x3a8bff, 0x49d17a, 0xffd54a, 0xff5ad1, 0x5ad1ff, 0xff9a3a, 0xb06aff];

// --- 레전드 정규전 (Legend Ranked) — see docs/LEGEND_MODE.md ---
export const LEGEND = {
  dmRounds: 5, dmModeKey: 'lives', dmRoundTime: 150, dmSuddenDeathAt: 120,
  intermissionTime: 4.5, fieldSize: 6,   // supports 2..8 (roster padded with bots)
};
// shipping 6p point curves; legendTable() generates for any N (sum of 5 DM-1sts ≈ race-1st ≈ 500)
export const DM_PTS   = [100, 72, 50, 33, 20, 10];
export const RACE_PTS = [500, 330, 220, 140, 80, 30];
// final race (결승 직선) — length, item-zone positions (fractions of length), force-finish cap
export const FINAL_TRACK = { length: 3600, itemZoneFracs: [0.25, 0.5, 0.75], timeCap: 90 };
export function legendTable(n, kind) {
  const fixed = kind === 'race' ? RACE_PTS : DM_PTS;
  if (n <= fixed.length) return fixed.slice(0, n);
  const top = kind === 'race' ? 500 : 100, decay = kind === 'race' ? 0.66 : 0.62;
  return Array.from({ length: n }, (_, i) => Math.round(top * Math.pow(decay, i)));
}

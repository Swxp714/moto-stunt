// sfx.js — Tiny procedural 16-bit retro SFX for MOTO STUNT.
// Self-contained: embeds the canonical ZzFX micro synth (v1.3.2 by Frank Force,
// MIT) so this module has zero external imports. All playback is wrapped in
// try/catch and respects window.__muted, so audio can NEVER crash the game.

'use strict';

/* ------------------------------------------------------------------ *
 * ZzFXMicro - Zuper Zmall Zound Zynth - v1.3.2 by Frank Force (MIT)
 * Source: https://github.com/KilledByAPixel/ZzFX (ZzFXMicro.min.js)
 * Synthesizes real audio through the Web Audio API. Unmodified core.
 * ------------------------------------------------------------------ */
let // ZzFXMicro - Zuper Zmall Zound Zynth - v1.3.2 by Frank Force
zzfxV = .35,                // master volume
zzfxX = new AudioContext(), // shared audio context
zzfx =                      // play sound (returns nothing)
(p=1,k=.05,b=220,e=0,r=0,t=.1,q=0,D=1,u=0,y=0,v=0,z=0,l=0,E=0,A=0,F=0,c=0,w=1,m=0,B=0
,N=0)=>{let M=Math,d=2*M.PI,R=44100,G=u*=500*d/R/R,C=b*=(1-k+2*k*M.random(k=[]))*d/R,
g=0,H=0,a=0,n=1,I=0,J=0,f=0,h=N<0?-1:1,x=d*h*N*2/R,L=M.cos(x),Z=M.sin,K=Z(x)/4,O=1+K,
X=-2*L/O,Y=(1-K)/O,P=(1+h*L)/2/O,Q=-(h+L)/O,S=P,T=0,U=0,V=0,W=0;e=R*e+9;m*=R;r*=R;t*=
R;c*=R;y*=500*d/R**3;A*=d/R;v*=d/R;z*=R;l=R*l|0;p*=zzfxV;for(h=e+m+r+t+c|0;a<h;k[a++]
=f*p)++J%(100*F|0)||(f=q?1<q?2<q?3<q?4<q?(g/d%1<D/2)*2-1:Z(g**3):M.max(M.min(M.tan(g)
,1),-1):1-(2*g/d%2+2)%2:1-4*M.abs(M.round(g/d)-g/d):Z(g),f=(l?1-B+B*Z(d*a/l):1)*(4<q?
f:(f<0?-1:1)*M.abs(f)**D)*(a<e?a/e:a<e+m?1-(a-e)/m*(1-w):a<e+m+r?w:a<h-c?(h-a-c)/t*w:
0),f=c?f/2+(c>a?0:(a<h-c?1:(h-a)/c)*k[a-c|0]/2/p):f,N?f=W=S*T+Q*(T=U)+P*(U=f)-Y*V-X*(
V=W):0),x=(b+=u+=y)*M.cos(A*H++),g+=x+x*E*Z(a**5),n&&++n>z&&(b+=v,C+=v,n=0),!l||++I%l
||(b=C,u=G,n=n||1);X=zzfxX,p=X.createBuffer(1,h,R);p.getChannelData(0).set(k);b=X.
createBufferSource();b.buffer=p;b.connect(X.destination);b.start()};

/* ------------------------------------------------------------------ *
 * SOUND SET — ZzFX parameter arrays.
 * Param order: [volume, randomness, frequency, attack, sustain, release,
 *   shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime,
 *   repeatTime, noise, modulation, bitCrush, delay, sustainVolume,
 *   decay, tremolo]
 * shape: 0=sin 1=triangle 2=sawtooth 3=tan 4=noise
 * ------------------------------------------------------------------ */
const SOUNDS = {
  // --- UI ---
  // Crisp, clean triangle blips — short attack/release so they read as taps, not
  // tones. Triangle (shape 1) is softer than square, avoiding harsh edges.
  ui_click:     [.5, .02, 1400, 0, .008, .04, 1, 3, 0, 0, 0, 0, 0, 0, 0, .12, 0, .5],   // tight bright tap
  ui_move:      [.3, .03, 560, 0, .005, .035, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, .4],     // soft cursor tick
  ui_lock:      [.55, 0, 700, .005, .04, .12, 1, 1, 0, 0, 380, .03, 0, 0, 0, 0, 0, .7, .1], // two-tone confirm ding

  // --- Countdown ---
  // Clean sine beeps with a touch of decay so they don't drone. count_go jumps
  // up an octave-ish for a bright, celebratory release.
  count_beep:   [.55, 0, 480, 0, .07, .09, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, .8, .05],   // mellow countdown beep
  count_go:     [.6, 0, 720, .005, .1, .2, 0, 1, 0, 0, 480, .06, 0, 0, 0, 0, 0, .9, .08, .04], // bright rising GO

  // --- Riding / stunts ---
  // wheelie_boost: rising sawtooth whoosh with vibrato for an engine-lift feel
  // (racing engine = low saw with pitch slide, per arcade-racer convention).
  wheelie_boost:[.45, .08, 150, .06, .14, .26, 2, 1, 9, 0, 0, 0, 0, .06, 0, 0, 0, .7, 0, .2], // engine-lift whoosh
  // crash: punchy noise burst with fast decay (ZzFX explosion recipe — noise +
  // negative slide + short release). Bit-crush adds grit without being painful.
  crash:        [.85, .3, 460, 0, .03, .22, 4, 1.4, -4, -.2, 0, 0, 0, 1.2, 0, .15, 0, .2, .1], // gritty impact burst
  // respawn: ascending sparkle (pickup/powerup family — rising slide + pitch jump).
  respawn:      [.45, 0, 420, .03, .1, .28, 1, 1, 10, 0, 280, .07, .05, 0, 0, 0, 0, .8, .1], // rising sparkle
  finish:       [.55, 0, 523, .02, .12, .5, 1, .6, 0, 0, 262, .09, .14, 0, 0, 0, 0, .9, 0, .1], // triumphant arpeggio jingle

  // --- Deathmatch / combat ---
  // dm_death: big explosion — strong noise, downward slide, longer tail.
  dm_death:     [.95, .35, 280, 0, .05, .5, 4, 1.6, -3, -.1, 0, 0, 0, 1.4, 0, .2, 0, .15, .2], // explosion boom
  kill:         [.55, 0, 900, 0, .015, .07, 2, 1, -6, 0, 0, 0, 0, .04, 0, .1, 0, .4],   // sharp hit confirm
  warn:         [.5, 0, 540, 0, .09, .11, 1, 1, 0, 0, -180, .05, .07, 0, 0, 0, 0, .85], // two-tone alarm

  // --- Item pickups & powerups ---
  item_grant:   [.5, 0, 540, .01, .07, .2, 1, 1, 0, 0, 380, .05, .06, 0, 0, 0, 0, .8],  // bright pickup jingle
  item_jump:    [.45, .02, 300, .01, .06, .16, 1, 1, 14, 0, 220, .04, 0, 0, 0, 0, 0, .6], // springy boing
  item_boost:   [.5, .06, 200, .04, .12, .24, 2, 1, 12, 0, 0, 0, 0, .05, 0, 0, 0, .7, 0, .15], // rising boost whoosh
  item_shield:  [.4, 0, 640, .05, .18, .34, 0, 1, 3, 0, 160, .12, .04, 0, 5, 0, 0, .85, .1], // shimmering hum
  item_super:   [.55, 0, 320, .04, .18, .42, 1, 1, 16, 0, 320, .08, .05, 0, 0, 0, 0, .9, .1], // ascending power-up sweep

  // --- Score ---
  // score_up: classic two-step coin (ZzFX coin = pitch jump up after a short
  // first note). score_down: quick descending blip.
  score_up:     [.5, 0, 988, 0, .04, .14, 1, 1, 0, 0, 640, .06, 0, 0, 0, 0, 0, .7, .05], // satisfying coin
  score_down:   [.4, 0, 380, 0, .04, .12, 1, 1, -5, 0, 0, 0, 0, 0, 0, 0, 0, .5],         // descending blip

  // --- Jump physics ---
  jump_launch:  [.45, 0, 260, .01, .05, .15, 1, 1, 14, 0, 180, .03, 0, 0, 0, 0, 0, .6],  // springy launch
  jump_land:    [.5, .12, 140, 0, .02, .1, 4, 1, -1, 0, 0, 0, 0, .5, 0, .1, 0, .25],     // soft thud
};

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

let unlocked = false;

/** Resume/unlock the AudioContext (browsers gate audio behind a gesture). */
function init() {
  try {
    if (zzfxX && zzfxX.state === 'suspended') zzfxX.resume();
    unlocked = true;
  } catch (e) { /* never throw */ }
}

/** Play a named sound. No-op when muted; never throws. */
function play(name) {
  try {
    if (typeof window !== 'undefined' && window.__muted === true) return;
    const params = SOUNDS[name];
    if (!params) return;
    if (!unlocked) init();
    zzfx(...params);
  } catch (e) { /* audio must never crash the game */ }
}

// Auto-unlock on first user interaction (one-time listeners).
try {
  if (typeof window !== 'undefined') {
    const unlock = () => {
      init();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }
} catch (e) { /* ignore */ }

/** Set master volume 0..1 (scales every sound via ZzFX zzfxV). */
function setVolume(v) { zzfxV = Math.max(0, Math.min(1, v)); }
function getVolume() { return zzfxV; }

/* ------------------------------------------------------------------ *
 * Continuous engine drone (부릉부릉) — a real Web-Audio loop, not a
 * one-shot. Sawtooth + sub square + vibrato LFO; pitch & gain follow
 * speed. Respects window.__muted and the master volume.
 * ------------------------------------------------------------------ */
let eng = null;
function engineStart() {
  try {
    if (eng || !zzfxX) return;
    const ctx = zzfxX; if (ctx.state === 'suspended') ctx.resume();
    const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ctx.destination);
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 64;
    const sub = ctx.createOscillator(); sub.type = 'square'; sub.frequency.value = 32;
    const subG = ctx.createGain(); subG.gain.value = 0.45; sub.connect(subG); subG.connect(gain);
    osc.connect(gain);
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 10;   // 부릉부릉 throb
    const lfoG = ctx.createGain(); lfoG.gain.value = 7; lfo.connect(lfoG); lfoG.connect(osc.frequency);
    osc.start(); sub.start(); lfo.start();
    eng = { osc, sub, gain, lfo };
  } catch (e) { /* never throw */ }
}
function engineSet(speed01) {   // speed01 ~ 0..1 (idle..top)
  try {
    if (!eng) return; const t = zzfxX.currentTime;
    const s = Math.max(0, Math.min(1.3, speed01 || 0));
    const base = 58 + s * 120;
    eng.osc.frequency.setTargetAtTime(base, t, 0.05);
    eng.sub.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    eng.lfo.frequency.setTargetAtTime(8 + s * 10, t, 0.1);
    const muted = (typeof window !== 'undefined' && window.__muted === true);
    eng.gain.gain.setTargetAtTime(muted ? 0 : zzfxV * (0.09 + s * 0.14), t, 0.07);
  } catch (e) { /* ignore */ }
}
function engineStop() {
  try {
    if (!eng) return; const e = eng; eng = null;
    e.gain.gain.setTargetAtTime(0, zzfxX.currentTime, 0.12);
    setTimeout(() => { try { e.osc.stop(); e.sub.stop(); e.lfo.stop(); e.gain.disconnect(); } catch (_) {} }, 400);
  } catch (e) { /* ignore */ }
}

export { play, init, setVolume, getVolume, engineStart, engineSet, engineStop };
export default { play, init, setVolume, getVolume, engineStart, engineSet, engineStop };

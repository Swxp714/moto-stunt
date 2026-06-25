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
zzfxV = .3,                 // master volume
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
  ui_click:     [.4, 0, 1200, 0, .01, .05, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, .6],   // short bright blip
  ui_move:      [.25, 0, 480, 0, 0, .04, 0, 1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, .4],   // soft tick
  ui_lock:      [.45, 0, 660, .01, .06, .14, 1, 1, 0, 0, 280, .04, 0, 0, 0, 0, 0, .6], // confirm ding

  // --- Countdown ---
  count_beep:   [.5, 0, 520, 0, .08, .1, 1, 1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, .7],   // short countdown beep
  count_go:     [.55, 0, 880, .01, .12, .18, 1, 1, 0, 0, 200, .05, 0, 0, 0, 0, 0, .8], // bright GO tone

  // --- Riding / stunts ---
  wheelie_boost:[.4, .05, 180, .05, .15, .25, 0, 1, 8, 0, 0, 0, 0, .1, 0, 0, 0, .6], // rising whoosh
  crash:        [.6, .2, 90, 0, .04, .3, 4, 1, -2, 0, 0, 0, 0, 1, 0, 0, 0, .3],      // harsh noise burst
  respawn:      [.4, 0, 440, .02, .1, .3, 0, 1, 12, 0, 220, .08, .04, 0, 0, 0, 0, .7], // rising sparkle
  finish:       [.5, 0, 523, .02, .1, .4, 1, 1, 0, 0, 392, .08, .12, 0, 0, 0, 0, .8], // triumphant jingle

  // --- Deathmatch / combat ---
  dm_death:     [.7, .25, 80, 0, .06, .4, 4, 1.5, -3, 0, 0, 0, 0, 1, 0, 0, 0, .2],  // explosion-ish burst
  kill:         [.5, 0, 740, 0, .02, .08, 2, 1, -4, 0, 0, 0, 0, .05, 0, 0, 0, .5],  // sharp confirm hit
  warn:         [.45, 0, 620, 0, .1, .12, 1, 1, 0, 0, -160, .06, .08, 0, 0, 0, 0, .8], // alarm blip

  // --- Item pickups & powerups ---
  item_grant:   [.45, 0, 600, .01, .08, .2, 1, 1, 0, 0, 300, .06, .06, 0, 0, 0, 0, .7], // pickup jingle
  item_jump:    [.4, 0, 260, .02, .08, .14, 0, 1, 18, 0, 0, 0, 0, 0, 0, 0, 0, .6],  // boing
  item_boost:   [.45, .05, 220, .04, .14, .22, 0, 1, 10, 0, 0, 0, 0, .08, 0, 0, 0, .6], // whoosh
  item_shield:  [.35, 0, 700, .05, .2, .35, 0, 1, 2, 0, 100, .15, .05, 0, 6, 0, 0, .8], // shimmer
  item_super:   [.5, 0, 300, .05, .2, .4, 1, 1, 14, 0, 260, .1, .05, 0, 0, 0, 0, .8],  // power-up sweep

  // --- Score ---
  score_up:     [.4, 0, 880, 0, .03, .1, 1, 1, 0, 0, 540, .05, 0, 0, 0, 0, 0, .6],  // coin
  score_down:   [.35, 0, 300, 0, .04, .12, 0, 1, -3, 0, 0, 0, 0, 0, 0, 0, 0, .5],   // low blip

  // --- Jump physics ---
  jump_launch:  [.4, 0, 240, .01, .06, .16, 0, 1, 16, 0, 0, 0, 0, 0, 0, 0, 0, .6],  // spring
  jump_land:    [.45, .1, 110, 0, .03, .12, 4, 1, 0, 0, 0, 0, 0, .4, 0, 0, 0, .3],  // thud
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

export { play, init };
export default { play, init };

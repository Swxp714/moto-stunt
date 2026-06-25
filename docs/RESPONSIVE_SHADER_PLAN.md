# RESPONSIVE PIXEL/DOT SHADER PLAN — MOTO STUNT

> Planning document only. No code changes here. This plan is implementation-ready and
> references exact `file:line` so it can be executed later.
>
> **Goal (user's words, paraphrased):** When the game window/screen is small, the pixel-art
> "dot" shader makes everything so chunky/low-res that you can't see anything. The pixel
> density is tied to a fixed divisor of the window size, so a small window = huge dots. We
> want the shader to *smartly* (알잘딱) keep the pixelation and aspect ratio sensible and
> *fixed-looking* across screen sizes — without clipping the in-canvas UI (title / PLAY /
> EXIT / 설정).

---

## 1. Current State (with file:line references)

### 1.1 The pixel-art composite approach (how the "dot look" is produced)

The game does **not** use an `EffectComposer`. It uses a hand-rolled low-res-RT → fullscreen-quad
composite:

1. Each player world is rendered into a **low-resolution `WebGLRenderTarget`** with
   `NearestFilter` (so upscaling shows hard square dots).
   - `makeLowRT()` — `src/main.js:830`–`838`. Creates an RT at a placeholder `2×2`, with
     `minFilter/magFilter = NearestFilter` and a `DepthTexture` (also Nearest) for the
     depth-based color-focus effect.
   - `const rts = [makeLowRT(), makeLowRT()]` — `src/main.js:839` (slot 0 = left/1P, slot 1 = right in split).
2. A **fullscreen quad** with `compositeMat` (`src/main.js:841`–`900`) samples those RTs and applies:
   - high-speed barrel warp (`uSpeedL/R`, `uWarp`),
   - depth-based color focus (grayscale outside a world-distance band),
   - per-side tint (local 2P red/blue),
   - flash,
   - **Bayer ordered dithering + posterize color quantization** — `src/main.js:894`–`897`:
     ```glsl
     vec2 bUv = (vUv * uResolution) / uBayerSize;     // dither tiled in SCREEN px
     float th = texture2D(tBayer, bUv).r - 0.5;
     c += th * uDither / uColorSteps;
     c = floor(c * uColorSteps + 0.5) / uColorSteps;  // posterize
     ```
   - `quadScene` / `quadCam` — `src/main.js:901`–`903`.
3. The main renderer's canvas is stretched to the full window by CSS and relies on
   `image-rendering: pixelated` to keep the dots crisp:
   - `index.html:16` `#app { position: fixed; inset: 0; }`
   - `index.html:17` `canvas { display: block; image-rendering: pixelated; }`

### 1.2 Where resolution / divisor is chosen — the divisor inventory

There are **three independent resolution choices**, two of which are the bug:

| # | Location | Code | Divisor | In scope? |
|---|----------|------|---------|-----------|
| A | Main game RTs — `sizeTargets()` `src/main.js:937`–`956` | `lowW = floor(halfW/ps)`, `lowH = floor(H/ps)` with `ps = CFG.pixelSize` (`src/main.js:939`,`942`,`943`) | **fixed `/4`** | ✅ primary |
| B | Hero menu — `resizeHero()` `src/main.js:1308`–`1312` (esp. `1310`) | `heroR.setSize(floor(innerWidth/4), floor(innerHeight/4), false)` | **fixed `/4`** (hard-coded, not even `CFG.pixelSize`) | ✅ secondary |
| C | Webcam dot effect `src/main.js:1176` | `const pf = 3` on a fixed `240×168` offscreen canvas | fixed, but **not window-tied** | ❌ out of scope |

`CFG.pixelSize = 4` is defined at `src/main.js:61`. `colorSteps:6, dither:0.65` at `src/main.js:62`.

### 1.3 resize() wiring

- **Main game:** `addEventListener('resize', sizeTargets)` — `src/main.js:1800`. Also called
  explicitly on init `src/main.js:1922` and on every mode switch
  (`sizeTargets()` at `:1038`, `:1429`, `:1442`, `:1549`, `:1635`, inside `setGameMode`/DM setup).
- **Hero menu:** `addEventListener('resize', resizeHero)` — `src/main.js:1389`; also called from
  `showHero(on)` at `src/main.js:1386` (`if (on) { resizeHero(); ... }`).

### 1.4 Camera framing

- Main 1P/2P world camera: `PerspectiveCamera(62, 1, 0.1, 1000)` — `src/main.js:302`.
  Aspect set in `sizeTargets`: `aspect = halfW / H` → `worlds[i].camera.aspect` (`:946`–`948`).
- DM arena cameras: `PerspectiveCamera(60, ...)` — `src/main.js:528`; winCam `:656`. Aspect set
  in `sizeTargets` `:952`–`955`.
- Hero menu camera: `PerspectiveCamera(32, 1, 0.1, 100)` — `src/main.js:1273`;
  positioned `heroCam.position.set(0, 3.6, 12.8); heroCam.lookAt(0,1.3,0)` — `src/main.js:1378`.
  Aspect set in `resizeHero`: `heroCam.aspect = innerWidth/innerHeight` — `src/main.js:1311`.
- In-canvas hero UI lives in **world space**: title `(0,4.0)`, subtitle `(0,3.25)`
  (`:1281`–`1282`); buttons `PLAY (0,-0.35)`, `EXIT (-3.9,-1.45)`, `설정 (+3.9,-1.45)`
  (`:1291`–`1293`). These are sized to a **vertical** FOV; horizontal extent depends on aspect.

### 1.5 KNOWN BUG found while grounding this plan (must fix in Phase 0)

`renderer.setSize(...)` is called **only once at init** (`src/main.js:71`) and **never on resize**.
The resize handler `sizeTargets` (`:937`) updates the low-res RTs and `uResolution` but **never
resizes the main renderer's drawing buffer / canvas**. Consequences:

- When the window **grows**, the main canvas backbuffer stays at its initial size and CSS
  stretches it → extra blur, and `uResolution` (now larger) no longer matches the actual
  drawing buffer, so the **Bayer dither tile drifts out of alignment** with screen pixels
  (`bUv = vUv * uResolution / uBayerSize`, `:894`).
- When the window **shrinks**, the canvas is larger than the viewport (overflow hidden), wasting
  fill and again mismatching `uResolution`.

The hero path does NOT have this bug — `resizeHero` calls `heroR.setSize(...)` every time.
This asymmetry is part of why the two paths must be unified (see §4).

---

## 2. Diagnosis — precisely WHY small screens over-pixelate

### 2.1 Fixed divisor → vertical dot count scales with the window

With a fixed divisor `ps = 4`, the low-res vertical resolution is `lowH = floor(H / 4)`:

| Window height H | `lowH` (rows of dots) | Scene detail |
|-----------------|------------------------|--------------|
| 1080 | 270 | fine |
| 720  | 180 | ok |
| 540  | 135 | coarse |
| 400  | 100 | very chunky |
| 300  | 75  | unreadable |

Each dot always covers `ps×ps = 4×4` **screen pixels**, so on a *physically smaller* window the
**number of dots across the scene drops**, i.e. each dot represents a *larger share of the world*.
That is exactly the "everything is huge dots, can't see anything" complaint. The dot's screen
size is constant; its **effective resolution (dots-per-scene)** is what collapses.

### 2.2 The fix in one sentence

**Lock the low-res RT to a target *vertical* resolution (constant `lowH`, e.g. 240–360) and derive
the divisor from the window**, instead of locking the divisor and letting `lowH` float. Then the
scene always has ~the same number of dots regardless of window size; small windows just get
slightly *smaller* dots (still crisp), not *fewer* dots.

### 2.3 Aspect-ratio handling today

`aspect = halfW / H` is fed straight into a perspective camera with a **fixed vertical FOV**
(62° main, 32° hero). So:
- **Wide window** → wide horizontal FOV → you see *more* sideways (fine for the racetrack, but the
  hero's ±3.9 buttons have *extra* margin — safe).
- **Narrow / portrait window** → narrow horizontal FOV → the ±3.9 hero buttons fall **outside the
  frustum and get clipped**. This is the in-canvas-UI clipping problem already flagged.

Quick geometry for the hero buttons (cam at z=12.8, buttons at z=2 → distance ≈ 10.8; vertical
FOV 32°):
- visible half-height at the buttons ≈ `10.8 * tan(16°) ≈ 3.10`.
- visible half-width = half-height × aspect ≈ `3.10 * aspect`.
- Buttons reach `x ≈ ±3.9 + halfWidth(0.95) ≈ ±4.85`. They fit only when
  `3.10 * aspect ≥ 4.85` → **aspect ≥ ~1.56**. Below ~16:10 the EXIT/설정 buttons start
  clipping; in portrait (aspect < 1) they're far off-screen.

### 2.4 devicePixelRatio interaction

- `renderer.setPixelRatio(1)` — `src/main.js:70`. The main renderer ignores DPR entirely. Combined
  with the never-resized canvas (§1.5), on a retina/HiDPI display the canvas is laid out at CSS px
  but the backbuffer is at 1× → the browser upscales. With `image-rendering: pixelated` this is
  *mostly fine for the intended pixel look*, but it means our "screen pixels" in the dither math
  are **CSS px, not device px**. That is actually desirable for a *fixed dot look*, but it must be
  made **intentional and consistent** between the two render paths (hero `setSize(..., false)`
  also bypasses DPR — good, keep it).
- Risk: if a future change sets `setPixelRatio(devicePixelRatio)`, the Bayer tile (`uResolution`)
  and the RT divisor math would silently double on retina, halving the dot size. The plan below
  pins everything to **CSS pixels** to avoid this.

---

## 3. Recommended Approach (with formulas)

### 3.1 Core idea: target a FIXED internal pixel grid

Replace the constant divisor with a **constant target vertical resolution** and derive the divisor:

```
TARGET_H = 320            // target dot-rows for the scene (tune 240–360)
DOT_MIN  = 2              // min screen px per dot (never smaller than 2 → stays visibly "pixel")
DOT_MAX  = 6              // max screen px per dot (never chunkier than this even on tiny windows)

// derive divisor from the *window height* so dot-rows ≈ TARGET_H
rawPs = H / TARGET_H
ps    = clamp(round(rawPs), DOT_MIN, DOT_MAX)   // integer divisor, clamped

// low-res RT size (halfW handles split-screen, exactly like today)
lowH  = max(2, round(H / ps))
lowW  = max(2, round(halfW / ps))
```

Worked numbers (`TARGET_H=320`, 1P so `halfW = W`):

| H | rawPs = H/320 | ps (clamped) | lowH = H/ps | dot size (screen px) |
|------|---------------|--------------|-------------|----------------------|
| 1440 | 4.50 | 5 | 288 | 5 |
| 1080 | 3.38 | 3 | 360 | 3 |
| 800  | 2.50 | 3 (round 2.5→3*) | 267 | 3 |
| 540  | 1.69 | 2 | 270 | 2 |
| 400  | 1.25 | 2 (clamp DOT_MIN) | 200 | 2 |
| 300  | 0.94 | 2 (clamp) | 150 | 2 |

\* round-half choice is a tuning detail; `Math.round`/`Math.max(DOT_MIN, ...)` both fine.

**Result:** `lowH` now stays in a tight band (~150–360) instead of collapsing to 75. On small
windows the *dot size* shrinks toward `DOT_MIN=2` (still crisply pixel) rather than the *dot count*
collapsing. That is the "fixed-looking pixelation" the user wants.

> **Why clamp `ps` instead of clamping `lowH`?** We want **integer** divisors so the upscale is a
> clean nearest-neighbor multiple (no shimmering). Deriving an integer `ps` from `H/TARGET_H` and
> clamping it gives a near-constant `lowH` while guaranteeing clean integer scaling. `DOT_MIN`
> guarantees a minimum readable dot; `DOT_MAX` guarantees that even a huge window doesn't make
> the scene *too* low-res (perf + look).

**Alternative considered (NOT recommended):** keep `lowH = TARGET_H` exactly and let the canvas
CSS-stretch a fixed 320-row buffer by a non-integer factor. Rejected because non-integer
nearest-neighbor upscaling produces **uneven dot sizes / shimmer** on motion — the opposite of a
"fixed" look. Integer-divisor clamping is the recommended path.

### 3.2 Aspect-ratio strategy — RECOMMENDED: stabilize framing, not letterbox

Two options:

- **Option A — Letterbox/pillarbox to a target aspect (e.g. 16:9).** Render into a fixed-aspect
  region, fill the rest with black bars. Pros: dot grid and framing 100% constant; UI never clips.
  Cons: visible bars; wastes screen on odd aspects; more invasive (viewport/scissor or a second
  CSS box).
- **Option B — Fit-to-window with a stable *vertical* framing + horizontal-FOV floor
  (RECOMMENDED).** Keep filling the whole window (no bars), but make the camera framing
  *vertical-anchored* so in-canvas UI never clips:
  - Keep vertical FOV fixed for **wide** aspects (current behavior).
  - For **narrow** aspects (aspect below a threshold `ASPECT_REF`, e.g. 16:9 = 1.778), **widen the
    vertical FOV** so the fixed horizontal content still fits. I.e. hold *horizontal* FOV constant
    below the threshold instead of vertical:

    ```
    ASPECT_REF = 16/9
    if (aspect >= ASPECT_REF) {
      cam.fov = BASE_FOV;                         // wide: vertical-fixed (as today)
    } else {
      // narrow/portrait: keep horizontal extent constant → grow vertical FOV
      const hFovRef = 2*atan(tan(BASE_FOV/2) * ASPECT_REF);
      cam.fov = degrees( 2*atan(tan(hFovRef/2) / aspect) );
    }
    cam.aspect = halfW / H;  cam.updateProjectionMatrix();
    ```

  This guarantees the **horizontal world extent never shrinks below the 16:9 reference**, so the
  hero's ±3.9 buttons (which need aspect ≥ ~1.56, §2.3) stay in frame down to portrait. The cost is
  that very tall windows show *more vertically* (acceptable — nothing important lives at top/bottom
  except the title at y=4.0, which we keep in frame; verify in Phase 3).

  **Recommendation: Option B for gameplay** (no bars, immersive, racetrack reads fine) **and a
  light letterbox cap only if Phase-3 verification shows the racetrack distorting on extreme
  aspects** (then add a max-aspect clamp, see §3.6). For the **hero menu specifically**, Option B's
  horizontal-FOV-floor is the key fix for button clipping.

### 3.3 devicePixelRatio / retina handling

- Keep `renderer.setPixelRatio(1)` (`src/main.js:70`) and keep hero `setSize(..., false)`
  (`src/main.js:1310`) so **all math is in CSS pixels**. This makes the dot look DPR-independent
  (a 320-row scene looks the same on retina and non-retina), which is what we want for a *fixed*
  pixel aesthetic.
- Explicitly resize the **main renderer** on resize to CSS px (fixes §1.5):
  `renderer.setSize(W, H, true)` (the `true`/default updates the canvas CSS size; we keep
  `image-rendering: pixelated` so the low-res→full-window upscale stays crisp). Confirm in Phase 0
  that `uResolution` is set to the **same** `W,H` used for `setSize` so the Bayer tile aligns.
- Do **not** introduce `setPixelRatio(devicePixelRatio)` — it would double the dither tile and halve
  dot size on retina.

### 3.4 Minimum readable dot size + clamping

- `DOT_MIN = 2`, `DOT_MAX = 6` (tune). `ps` is `clamp(round(H/TARGET_H), DOT_MIN, DOT_MAX)`.
- Rationale: below 2 screen-px the "dot" stops reading as pixel art; above ~6 the scene is too
  coarse and the existing complaint returns. Expose both as `CFG` so they're tunable
  (see §3.7).

### 3.5 Unify `resizeHero()` and `sizeTargets()` behind one helper

Both paths must use the **same** target-resolution math so the menu and the game have a
consistent dot size. Introduce a single pure helper (new function, e.g. `computePixelGrid`):

```
// returns { ps, lowW, lowH } for a given content width/height in CSS px
function computePixelGrid(contentW, contentH) {
  const ps  = clamp(Math.round(contentH / CFG.targetH), CFG.dotMin, CFG.dotMax);
  const lowW = Math.max(2, Math.round(contentW / ps));
  const lowH = Math.max(2, Math.round(contentH / ps));
  return { ps, lowW, lowH };
}
```

- `sizeTargets()` (`src/main.js:937`) calls it with `(halfW, H)` to size `rts[0]/rts[1]`, and adds
  the missing `renderer.setSize(W, H)` (§1.5 fix) + the aspect/FOV logic from §3.2.
- `resizeHero()` (`src/main.js:1308`) calls it with `(innerWidth, innerHeight)` to replace the
  hard-coded `/4`, and adds the §3.2 horizontal-FOV floor for `heroCam` so EXIT/설정 never clip.

This removes the magic `/4` from `:1310` and the `CFG.pixelSize` usage from `:939/:942/:943`,
replacing both with the shared, clamped, target-driven grid.

### 3.6 Mobile / portrait considerations (side buttons at world x ≈ ±3.9)

- The §3.2 horizontal-FOV floor already keeps the **hero** EXIT/설정 buttons in frame down to
  portrait, because horizontal world extent never drops below the 16:9 reference.
- **Belt-and-suspenders for very narrow / portrait:** if `aspect < PORTRAIT_THRESHOLD` (e.g. < 1.1),
  additionally **pull the buttons inward and/or stack them vertically** in `initHero`/`resizeHero`
  by recomputing their world `x` from the current visible half-width:
  ```
  visHalfW = (heroCam.position.z - 2) * tan(hFov/2);      // world half-width at button plane
  sideX    = min(3.9, visHalfW - 1.1);                    // keep ~1.1 margin so plate stays in frame
  heroExit.position.x = -sideX;  heroSettings.position.x = +sideX;
  ```
  In extreme portrait, optionally move EXIT/설정 **below** PLAY (y stack) instead of beside it.
- For **gameplay** in portrait, the racetrack still reads (vertical-anchored framing); the main
  concern is HUD/DOM overlays, which are CSS and out of scope for the shader but worth a Phase-3
  visual check.

### 3.7 New/changed `CFG` knobs (near `src/main.js:61`)

```
pixelSize: 4,        // (legacy) — keep as fallback, but no longer the live divisor
targetH: 320,        // NEW: target dot-rows; smaller = chunkier, larger = finer
dotMin: 2,           // NEW: min screen px per dot (clamp)
dotMax: 6,           // NEW: max screen px per dot (clamp)
aspectRef: 1.7778,   // NEW: 16:9 reference; below this, horizontal FOV is held constant
```

---

## 4. Phased Rollout + Playwright Verification

> Verification uses Playwright (`mcp__playwright__puppeteer_*`): `navigate` to the local
> `serve.py` URL, resize the viewport via `puppeteer_evaluate` (`window.resizeTo` / set
> viewport), `puppeteer_screenshot`, and `puppeteer_evaluate` to read back
> `window.__moto`/`compositeMat.uniforms` and canvas sizes. Assertions per phase below.

### Phase 0 — Fix the never-resized renderer (the §1.5 bug). LOW RISK, do first.
- **Change:** in `sizeTargets()` (`src/main.js:937`–`956`) add `renderer.setSize(W, H)` and ensure
  `uResolution` matches. No divisor change yet.
- **Verify (Playwright):** load page; for viewports `1920×1080`, `1280×720`, `800×600`,
  `500×400`: assert `renderer.domElement.width === innerWidth` (DPR=1) and
  `compositeMat.uniforms.uResolution.value` equals `(innerWidth, innerHeight)`. Screenshot each;
  confirm no stretch/blur and the dither grid is aligned (no diagonal moiré).

### Phase 1 — Target-resolution grid for the MAIN game.
- **Change:** add `CFG.targetH/dotMin/dotMax` (`:61`); add `computePixelGrid()` helper; rewrite
  `sizeTargets()` `:939`–`945` to use it (replace `ps = CFG.pixelSize`, `floor(halfW/ps)`,
  `floor(H/ps)`).
- **Verify (Playwright):** for the same viewport set, read back the RT size via a small debug hook
  (expose `lastGrid = {ps, lowW, lowH}` on `window.__moto`) and assert:
  - `lowH` stays within `[TARGET_H*0.6, TARGET_H*1.3]` across all sizes (i.e. ~150–360, **not** 75);
  - `ps ∈ [dotMin, dotMax]`;
  - measured dot size in screenshots (sample a flat-color region, count px per dot) ≈ `ps` and is
    roughly constant (2–6) across window sizes — the core "fixed dot" assertion.

### Phase 2 — Unify hero menu onto the same grid.
- **Change:** rewrite `resizeHero()` `:1308`–`1312` to call `computePixelGrid(innerWidth, innerHeight)`
  (drop the hard-coded `/4` at `:1310`).
- **Verify (Playwright):** open main menu (`#menu.mainscreen`); for each viewport, screenshot and
  assert the hero dot size matches the in-game dot size (same `ps`), and the menu is readable at
  `500×400` (title legible, not a blob).

### Phase 3 — Aspect / FOV floor + UI-clip guard (§3.2, §3.6).
- **Change:** add `CFG.aspectRef`; in `sizeTargets` (`:946`–`955`) and `resizeHero` (`:1311`) apply
  the horizontal-FOV-floor formula; in hero, recompute `heroExit/heroSettings` `x` from visible
  half-width (and optional portrait stacking).
- **Verify (Playwright):** for viewports `1920×1080`, `1280×720`, `1024×768`, `768×1024` (portrait),
  `420×740` (phone portrait):
  - assert the three hero buttons' projected screen positions (via
    `THREE.Vector3.project(heroCam)` exposed on a debug hook) are **all within `[0,1]×[0,1]` NDC →
    on-screen** (no clipping) — the regression this whole guard exists to prevent;
  - click PLAY at each size (`puppeteer_click` at the projected pixel coords) and assert the play
    transition fires (`window.__moto`/screen state changes);
  - screenshot to confirm the racetrack framing is sensible (no extreme stretch) in portrait.

### Phase 4 — Tuning + polish.
- Sweep `targetH ∈ {240, 280, 320, 360}` and `dotMin/dotMax`; pick values where 1080p looks
  identical-or-better than today and 400px-tall is *readable*. Lock final `CFG` values.
- **Verify:** final screenshot matrix (5 sizes × menu+game); manual sign-off that dots look
  "fixed" across all sizes and nothing clips.

---

## 5. Exact change-site checklist (file:line)

| Site | File:line | Change |
|------|-----------|--------|
| CFG knobs | `src/main.js:61`–`62` | add `targetH`, `dotMin`, `dotMax`, `aspectRef`; keep `pixelSize` as legacy fallback |
| Renderer resize bug | `src/main.js:937`–`956` (`sizeTargets`) | **add `renderer.setSize(W,H)`** (Phase 0) |
| Main grid math | `src/main.js:939`,`942`,`943` | replace `ps=CFG.pixelSize` + `floor(halfW/ps)` + `floor(H/ps)` with `computePixelGrid(halfW,H)` |
| Main aspect/FOV | `src/main.js:946`–`948` (+ `:302` BASE_FOV, DM `:528`/`:656`, `:952`–`955`) | apply horizontal-FOV floor below `aspectRef` |
| New helper | near `src/main.js:905` (before `sizeTargets`) | add `computePixelGrid(contentW, contentH)` |
| Hero grid math | `src/main.js:1310` | replace hard-coded `/4` with `computePixelGrid(innerWidth,innerHeight)` |
| Hero aspect/FOV | `src/main.js:1311` | apply FOV floor for `heroCam` |
| Hero button clip-guard | `src/main.js:1291`–`1293` (positions) + `resizeHero` `:1308` | recompute EXIT/설정 `x` from visible half-width; optional portrait stacking |
| (No change) webcam dot | `src/main.js:1176` (`pf=3`) | out of scope — fixed 240×168 canvas, not window-tied |
| (No change) CSS | `index.html:16`,`17`,`185` | keep `image-rendering: pixelated`; canvas already fills window |

---

## 6. Risks & Rollback

- **Risk:** changing FOV alters gameplay feel (how much track you see). Mitigation: only deviate
  from `BASE_FOV` *below* `aspectRef`; wide screens are unchanged. Rollback = set `aspectRef` very
  high (forces always-vertical-fixed = old behavior) without code revert.
- **Risk:** non-integer upscale shimmer if someone bypasses the integer `ps` clamp. Mitigation:
  `ps` is always `round`+clamped to an int; `image-rendering: pixelated` already in CSS.
- **Risk:** retina regression if `setPixelRatio` is later changed. Mitigation: §3.3 pins everything
  to CSS px; add a code comment at `src/main.js:70`.
- **Per-phase rollback:** each phase is independent. Phase 0 is a pure bugfix and safe to ship
  alone. Phases 1–3 are gated behind `CFG` knobs, so reverting = restoring old `CFG`/divisor.

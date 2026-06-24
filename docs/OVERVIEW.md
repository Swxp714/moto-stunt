# 🏍️ MOTO STUNT — Code Overview

> Developer onboarding doc. Read this in 5 minutes to understand the codebase before building a new game mode.
> The authoritative design doc is [`docs/GAMEPLAN.md`](./GAMEPLAN.md) (SSOT). This file describes the **code as it actually exists**.

---

## 1. What the game is

A **motion-controlled motorcycle stunt-racing** web game. You hold both hands up like handlebars in front of your webcam; tilting them steers the bike between lanes, and **raising your hands lifts the front wheel into a wheelie**. The wheelie is the core risk/reward mechanic — riding on the rear wheel boosts speed, but if the pitch angle exceeds a threshold you flip over backwards and crash (you also crash on obstacles). After a crash the bike freezes briefly, then **rewinds and respawns** with short invincibility. First to the finish line wins. The whole thing renders **low-poly 3D through a pixel-art post-process shader** (pixelation + Bayer dither + color quantization + a depth-based "color near the player only" grayscale focus). It supports **1-player**, **local 2-player split-screen** (one webcam, hands binned left/right), with **online 2P planned** (Phase 5, not yet implemented).

---

## 2. Tech stack & how to run

| Area | Choice |
|------|--------|
| Rendering | **Three.js r160**, no-build ESM via `<script type="importmap">` (`index.html`) |
| Hand tracking | **`@mediapipe/tasks-vision@0.10.35`** `HandLandmarker` (Tasks API, GPU delegate w/ CPU fallback) |
| Build step | **None** — pure ES modules loaded from CDN |
| Dev server | **`python serve.py`** → http://127.0.0.1:**8123** |
| UI font | **Galmuri11** pixel font (CDN), `image-rendering: pixelated` everywhere |

**Importmap note** (`index.html`): both `three` and `three/addons/` are mapped to the **same** 0.160.0 version (addons `import 'three'` bare — mismatched versions cause duplicate-module errors).

**Running:** `python serve.py`, open `http://127.0.0.1:8123`. The server (`serve.py`) is just `http.server.SimpleHTTPRequestHandler` with **no-cache headers** added in `end_headers()` — this exists because browsers aggressively cache ES modules and stale code was a recurring bug. Webcam needs a secure context; `127.0.0.1` counts as secure. On first run after older caching, a hard refresh (Ctrl+Shift+R) may be needed.

---

## 3. Architecture

All gameplay/render logic lives in **`src/main.js`** (~680 lines). Two helper modules: **`src/hands.js`** (input from webcam) and **`src/pixelart.js`** (the Bayer-dither texture helper). There is one shared `WebGLRenderer` with `autoClear=false` and `setPixelRatio(1)`.

### 3a. `createWorld(bodyColor)` — the world factory  (`main.js:134`)
Each player gets a **fully independent `THREE.Scene`** (its own camera, bike, track, obstacles, lights, particle systems, and `game`/`fx` state). This is the single most important architectural pattern: there is **no shared scene graph between players**, which keeps 1P and 2P on the exact same code path and makes the two tracks fair (identical deterministic layout). It returns:

```js
{ scene, camera, game, fx, reset, update, celebrate, bike, obstacles }
```

Two worlds are created up front: `const worlds = [createWorld(0xff5a3c), createWorld(0x49d17a)]` (`main.js:371`). World `[1]` is only updated/rendered in 2P mode.

The scene assembled per world: grid-floor shader (`buildGridFloor`, `main.js:39`), road + finish gate (`buildRoad`, `main.js:59`), the bike (`buildBike`, `main.js:83`), obstacles (`buildObstacles`, `main.js:116`), a `HemisphereLight` + `DirectionalLight` (flat lighting, **no shadow maps**), a player-tracking `SpotLight`, a ground **light-pool** disc, and two particle systems (sparks, fireworks).

### 3b. Render pipeline — low-res RT + pixel-art composite shader
Defined at `main.js:373-457`. Pipeline per frame (`loop()`, `main.js:640`):

1. Each active world renders into its own **low-resolution `WebGLRenderTarget`** (`rts[0]`, `rts[1]`, `makeLowRT` `main.js:376`) sized `viewport / CFG.pixelSize` with `NearestFilter`. Each RT also carries a **`DepthTexture`** (used for the color-focus effect).
2. A single full-screen quad (`quadScene` + `compositeMat`, `main.js:387`) composites both RTs to the screen with one fragment shader that does, in order:
   - **Split**: `uSplit` picks `tLeft` for the whole screen (1P) or left/right halves (2P).
   - **Speed warp**: barrel distortion away from screen center, scaled per-side by `uSpeedL/uSpeedR` × `uWarp`.
   - **Depth-based color focus**: linearizes the depth texture to eye-space Z, and only keeps full color within a band around `uFocus` (~11 units from camera); everything farther is grayscaled. So the world is mostly monochrome and **only objects near the player are in color** (GAMEPLAN §4 "v2 depth color").
   - **Per-side flash**: full-screen color flash from `uFlashL/uFlashR` (red on crash, cyan on respawn).
   - **Bayer dither + quantization**: ordered dither (from `makeBayerTexture`) then posterize each channel to `uColorSteps`.

   Live-tunable via `window.__moto.composite.uniforms`.

### 3c. Input system  (`main.js:459-520`, `src/hands.js`)
`inputFor(which)` (`main.js:496`) returns `{ steer, wheelie }` for a player, dispatching to keyboard or motion based on `inputSource`. **`wheelie` is a signed value** in `[-1, +1]`: positive raises the front wheel, negative lowers it. (This signedness is deliberate — see GAMEPLAN's "윌리 안 내려감" bug fix: a clamped `max(0,…)` wheelie could never come back down through EMA residue.)

- **Keyboard** (`kbPlayer`, `main.js:479`): 1P uses arrows or WASD; 2P uses WASD for P1, arrows for P2. Holding up = `+CFG.kbWheelie`, releasing = `-1`.
- **Motion** (`HandTracker` in `hands.js`): `tracker.controls(region)` returns smoothed signed controls. `region` is `'all'` in 1P, `'left'`/`'right'` in 2P (hands binned by mirrored x). No hands → `{ steer:0, wheelie:-0.5 }` (eases the wheel down safely).

The pure mapping lives in `computeControls(grips)` (`hands.js:20`, unit-tested): two hands form a "handlebar" — `steer = atan2(Δy,Δx)/FULL_LOCK`, `wheelie = (0.5 - avgHandY)*2`. `HandTracker` (`hands.js:45`) owns MediaPipe + webcam, throttles detection to ~30 Hz, mirrors x to selfie space, and smooths with EMA(0.35) + 6% deadzone.

### 3d. Game loop  (`loop()`, `main.js:640`)
`requestAnimationFrame` driven, `dt` clamped to 0.05. Steps: detect hands (if motion) → `world.update(dt, inputFor(i))` for each active world → push per-side flash & speed factors into the composite uniforms → render each world to its RT → composite quad to screen → `drawCamOverlay()` → `updateHud()` → `checkResult()`.

### 3e. HUD  (`index.html` + `main.js:522-563`)
DOM/CSS overlay (not in WebGL). Per-player `.side` panels (speed, chunky pixel progress bar, status tags), a center divider for split mode, finish banner, per-player near-flip warning boxes (`#p1warn`/`#p2warn`), webcam feed widget (`#camWrap`), mode tag, and motion-start button. `updateHud()` (`main.js:547`) writes speed/progress/tags and toggles the warning.

---

## 4. Key systems & where they live

All in `src/main.js` inside `createWorld()` unless noted.

| System | Location | Notes |
|--------|----------|-------|
| **Wheelie / pitch physics** | `update()` `main.js:286-301` | `game.pitch` integrates signed `wheelie` × rise/fall rate; speed lerps toward a boost target (`wheelieAccel`); `pitch > maxPitch` ⇒ crash. |
| **Crash & rewind-respawn** | `triggerCrash` `:265`, `respawn` `:277` | Crash freezes for `respawnFreeze`, red flash + camera shake; respawn rewinds to position from `rewindSeconds` ago using the `history[]` buffer, cyan flash + invincibility. Invincible blink at `:333`. |
| **Obstacles** | `buildObstacles` `:116`, collision in `update` `:308-314` | Deterministic cone placement (`Math.sin(z*0.37)` lane), AABB-ish proximity test. |
| **Spotlight + light-pool** | `:145-163` | Player-tracking `SpotLight`; additive ground disc with `floor(a*4)` falloff → quantized concentric "pixel light" rings. |
| **Sparks** | `:165-195` | `THREE.Points` pool (90), fixed-pixel size, gravity + backward velocity; emitted when `pitch > maxPitch*0.6`. |
| **Fireworks** | `:197-246` | `THREE.Points` pool (500), vertex-colored additive bursts; `celebrate()` runs ~4.5 s, called by `checkResult` for the winner. |
| **Speed-sensation effects** | camera `:344-356`, warp in composite shader | Speed factor `spF` pulls camera back/up, widens FOV (62→95), and drives the per-side barrel warp uniform. |
| **Warning UI** | CSS `index.html` `.warn`, toggled `updateHud` `:553` | Blinking "뒤집힘 주의" box at ~70% of max pitch (`CFG.maxPitch*0.7`). |
| **Modes (1P/2P/ONLINE)** | `setGameMode` `:506`, `setSource` `:515` | Keys: `1`/`2` mode, `M` keyboard↔motion, `R` reset. ONLINE (Phase 5) **not implemented**. |
| **Result / win** | `checkResult` `:614` | 1P shows finish time; 2P first-to-finish wins. |

---

## 5. Reusable building blocks for a new mode

The codebase is structured so a new mode mostly reuses the existing scaffolding:

**Reuse as-is**
- **`createWorld()` world factory** — the cleanest reuse point. Spin up an independent scene with its own camera/bike/state. The render loop already iterates `worlds[0..n]`; a new mode can pass different inputs into the same `update()` or fork `update()` per mode.
- **`buildBike(bodyColor)`** — self-contained bike with a pivot group rotating at the rear-wheel contact point (correct for wheelies) and spinning wheels. Drop into any scene.
- **Pixel-art composite** (`compositeMat`, `makeBayerTexture`, `makePixelArtPass`) — the entire pixel/dither/quantize/color-focus/flash/warp grade is reusable; it operates on RT textures, agnostic to what was rendered. Tweak via uniforms.
- **Input layer** (`HandTracker`, `computeControls`, `inputFor`/`kbPlayer`) — produces a normalized `{steer, wheelie}`; a new mode can read the same signal or add fields.
- **HUD patterns** — per-side DOM panels, pixel progress bar, banners, warning boxes, `window.__moto` live-tuning hook.

**Would need to change / add**
- `game` state + `update()` physics are racing-specific (distance/lane/pitch). A new mode likely needs its own state shape and update rules (consider a mode-specific `update` or a strategy passed into `createWorld`).
- Track layout (`buildRoad`, `buildObstacles`, `trackLength`) and win condition (`checkResult`) are race-bound.
- `setGameMode` only knows `'1P'`/`'2P'`; add a new mode branch (and the loop's `nWorlds` logic).
- Online sync (Phase 5) is unbuilt — would add a netcode layer feeding a remote world's state.

---

## 6. Tuning params (`CFG`, `main.js:13`)

Mirrors GAMEPLAN §10. All live in one object.

| Key | Value | Meaning |
|-----|-------|---------|
| `baseSpeed` | 60 | base forward speed (u/s) |
| `wheelieSpeedMul` | 2.3 | speed multiplier during full wheelie (top ≈138) |
| `wheelieAccel` | 7 | how fast speed ramps to the boost target |
| `steerSpeed` | 22 | lateral lane-change speed |
| `roadWidth` | 12 | road width / lane clamp |
| `maxPitch` | 1.0 | max safe front-wheel angle (rad); exceed ⇒ crash |
| `pitchRiseRate` | 2.2 | wheelie raise rate per full input (rad/s) |
| `pitchFallRate` | 2.5 | front-wheel lowering rate |
| `kbWheelie` | 0.5 | keyboard wheelie-up strength (1 = full) |
| `trackLength` | 3000 | distance to finish |
| `rewindSeconds` | 2 | respawn rewind window |
| `respawnFreeze` | 1.0 | death freeze (s) |
| `invincibleTime` | 1.5 | post-respawn invincibility (s) |
| `pixelSize` | 5 | low-res RT downscale factor (pixel chunkiness) |
| `colorSteps` | 4 | pixel-art quantization steps/channel ("strong retro") |
| `dither` | 1.0 | Bayer dither strength |
| `speedWarp` | 0.55 | barrel screen-warp strength at top speed |

**Live tuning hook** (`main.js:465`): `window.__moto` exposes `CFG`, `STATE`, `worlds`, `tracker`, `computeControls`, and `composite` (the composite material — adjust `composite.uniforms.uFocus/uBand0/uBand1` for the color-focus band, etc.). Also `hands.js` constants: `FULL_LOCK` 1.05, `DEADZONE` 0.06, `EMA` 0.35, `GRIP` landmark 9.

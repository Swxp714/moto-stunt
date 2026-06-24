// MOTO STUNT — Phase 2: MediaPipe hand tracking → controls
// SSOT: docs/GAMEPLAN.md §5
import { FilesetResolver, HandLandmarker, FaceLandmarker }
  from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35';

const VISION_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL   = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const FACE_MODEL  = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HEAD_GAIN = 2.6;     // head-yaw sensitivity
const HEAD_INVERT = false; // flip if camera pans the wrong way

const GRIP = 9;            // middle_MCP — most stable hand-center landmark
const FULL_LOCK = 1.05;    // rad of handlebar tilt that = full steer (bigger = less sensitive)
const DEADZONE = 0.06;
const EMA = 0.35;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// Pure mapping: grip points -> {steer, wheelie}. Unit-testable, no side effects.
//   grips: array of {x,y} normalized 0..1 (y is top-down: 0=top of frame)
// ---------------------------------------------------------------------------
export function computeControls(grips) {
  if (!grips || grips.length === 0) return { present: false, steer: 0, wheelie: 0, hands: 0 };

  if (grips.length === 1) {
    // single-hand fallback: steer by horizontal offset, wheelie by height
    const g = grips[0];
    const steer = clamp((g.x - 0.5) * 1.6, -1, 1);
    const wheelie = clamp((0.5 - g.y) * 2, -1, 1);   // + above midline / - below
    return { present: true, steer, wheelie, hands: 1 };
  }

  // two hands as a handlebar: leftmost & rightmost by x
  const s = [...grips].sort((a, b) => a.x - b.x);
  const L = s[0], R = s[s.length - 1];
  const tilt = Math.atan2(R.y - L.y, R.x - L.x);   // 0 = level bar
  const steer = clamp(tilt / FULL_LOCK, -1, 1);
  const handY = (L.y + R.y) / 2;
  // signed: hands above midline raise the front wheel (+), below midline lower it (-)
  const wheelie = clamp((0.5 - handY) * 2, -1, 1);
  return { present: true, steer, wheelie, hands: 2 };
}

// ---------------------------------------------------------------------------
// HandTracker: owns MediaPipe + webcam, produces smoothed controls per region
// ---------------------------------------------------------------------------
export class HandTracker {
  constructor() {
    this.ready = false;
    this.landmarker = null;
    this.video = null;
    this.results = null;
    this.lastVideoTime = -1;
    this.lastDetectMs = 0;
    this.minInterval = 33;   // throttle detection to ~30Hz (render stays 60)
    this.delegate = null;
    this.faceLm = null;
    this.headYaw = 0;        // -1 (look left) .. +1 (look right)
    this.lastFaceMs = 0;
    // per-region smoothing state (region key -> {steer,wheelie})
    this._smooth = {};
    this.error = null;
  }

  async init(videoEl) {
    try {
      const vision = await FilesetResolver.forVisionTasks(VISION_WASM);
      // GPU delegate first (fast on real hardware; coexists fine with the Three.js
      // context). CPU is only a fallback — it's far heavier and causes the lag.
      const opts = {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        numHands: 4, runningMode: 'VIDEO',
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      };
      try {
        this.landmarker = await HandLandmarker.createFromOptions(vision, opts);
        this.delegate = 'GPU';
      } catch (e) {
        opts.baseOptions.delegate = 'CPU';
        this.landmarker = await HandLandmarker.createFromOptions(vision, opts);
        this.delegate = 'CPU';
      }

      // optional face tracking for head-look camera (don't fail hands if it errors)
      try {
        this.faceLm = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate: opts.baseOptions.delegate },
          numFaces: 1, runningMode: 'VIDEO',
        });
      } catch (e) { this.faceLm = null; }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 360, facingMode: 'user' }, audio: false,
      });
      this.video = videoEl;
      this.video.srcObject = stream;
      await this.video.play();
      this.ready = true;
      return true;
    } catch (e) {
      this.error = e && e.message ? e.message : String(e);
      return false;
    }
  }

  detect(nowMs) {
    if (!this.ready) return;
    if (nowMs - this.lastDetectMs < this.minInterval) return;   // throttle ~30Hz
    if (this.video.currentTime === this.lastVideoTime) return;  // skip duplicate frames
    this.lastDetectMs = nowMs;
    this.lastVideoTime = this.video.currentTime;
    this.results = this.landmarker.detectForVideo(this.video, nowMs);

    // head yaw from face mesh (throttled ~20Hz), for the look-around camera
    if (this.faceLm && nowMs - this.lastFaceMs > 50) {
      this.lastFaceMs = nowMs;
      try {
        const fr = this.faceLm.detectForVideo(this.video, nowMs);
        const f = fr && fr.faceLandmarks && fr.faceLandmarks[0];
        if (f) {
          const nose = f[1], le = f[33], re = f[263];      // nose tip, outer eye corners
          const eyesMid = (le.x + re.x) / 2;
          const eyeW = Math.abs(re.x - le.x) || 0.12;
          let raw = clamp(((nose.x - eyesMid) / eyeW) * HEAD_GAIN, -1, 1);
          if (HEAD_INVERT) raw = -raw;
          this.headYaw = 0.8 * this.headYaw + 0.2 * raw;     // EMA smooth
        } else {
          this.headYaw *= 0.85;                              // recentre when no face
        }
      } catch (e) {}
    }
  }

  // grip points for a frame region: 'all' | 'left' (x<0.5) | 'right' (x>=0.5)
  // x is mirrored (1 - rawX) so controls & L/R binning match the selfie-mirrored
  // display the player actually sees (fixes reversed steering).
  grips(region = 'all') {
    if (!this.results) return [];
    const out = [];
    for (const lm of this.results.landmarks) {
      const mx = 1 - lm[GRIP].x;   // mirror to selfie-view space
      if (region === 'left' && mx >= 0.5) continue;
      if (region === 'right' && mx < 0.5) continue;
      out.push({ x: mx, y: lm[GRIP].y });
    }
    return out;
  }

  // smoothed, deadzoned controls for a region
  controls(region = 'all') {
    const raw = computeControls(this.grips(region));
    const sm = this._smooth[region] || (this._smooth[region] = { steer: 0, wheelie: 0 });
    if (raw.present) {
      sm.steer   = EMA * raw.steer   + (1 - EMA) * sm.steer;
      sm.wheelie = EMA * raw.wheelie + (1 - EMA) * sm.wheelie;
    } else {
      sm.steer   *= 0.9;   // fade toward center when hands lost
      sm.wheelie *= 0.9;
    }
    const steer = Math.abs(sm.steer) < DEADZONE ? 0 : sm.steer;
    return { present: raw.present, hands: raw.hands, steer, wheelie: sm.wheelie }; // signed
  }
}

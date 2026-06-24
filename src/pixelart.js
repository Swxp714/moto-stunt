// MOTO STUNT — pixel-art post pass: Bayer dithering + color quantization + optional palette
// Inspired by GodotPixelRenderer (pixelation + quantization + palette + Bayer dither).
// Goes AFTER RenderPixelatedPass in the EffectComposer.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Recursive Bayer matrix (ordered dithering threshold map)
function bayerMatrix(n) {
  if (n === 1) return [[0]];
  const h = n / 2, s = bayerMatrix(h);
  const m = Array.from({ length: n }, () => new Array(n));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const base = 4 * s[y % h][x % h];
    const quad = (x < h) ? (y < h ? 0 : 3) : (y < h ? 2 : 1);
    m[y][x] = base + quad;
  }
  return m;
}

export function makeBayerTexture(n = 8) {
  const mat = bayerMatrix(n);
  const data = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    data[y * n + x] = Math.round((mat[y][x] / (n * n)) * 255);
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// A small default 8-colour-ish palette (cool retro). Used only when uPalette=1.
const DEFAULT_PALETTE = [
  0x0c1020, 0x16324f, 0x2f7fc0, 0x5ad1ff,
  0x14141a, 0xff5a3c, 0xff7a1a, 0xffd54a,
].map(h => new THREE.Color(h));

export function makePixelArtPass(opts = {}) {
  const bayerSize = 8;
  const palette = (opts.palette || DEFAULT_PALETTE);
  const paletteArr = new Float32Array(64 * 3); // up to 64 colours
  palette.forEach((c, i) => { paletteArr[i*3] = c.r; paletteArr[i*3+1] = c.g; paletteArr[i*3+2] = c.b; });

  const pass = new ShaderPass({
    uniforms: {
      tDiffuse:    { value: null },
      tBayer:      { value: makeBayerTexture(bayerSize) },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uColorSteps: { value: opts.colorSteps ?? 6 },   // quantization steps per channel
      uDither:     { value: opts.dither ?? 0.8 },      // dither strength
      uBayerSize:  { value: bayerSize },
      uPalette:    { value: opts.usePalette ? 1 : 0 }, // 0 = posterize, 1 = snap to palette
      uPaletteN:   { value: palette.length },
      uPaletteCol: { value: paletteArr },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform sampler2D tBayer;
      uniform vec2  uResolution;
      uniform float uColorSteps;
      uniform float uDither;
      uniform float uBayerSize;
      uniform int   uPalette;
      uniform int   uPaletteN;
      uniform vec3  uPaletteCol[64];

      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;

        // ordered (Bayer) dithering threshold, tiled over screen pixels
        vec2 bUv = (vUv * uResolution) / uBayerSize;
        float th = texture2D(tBayer, bUv).r - 0.5;
        c += th * uDither / uColorSteps;

        if (uPalette == 1) {
          // snap to nearest palette colour
          float best = 1e9; vec3 pick = c;
          for (int i = 0; i < 64; i++) {
            if (i >= uPaletteN) break;
            vec3 p = uPaletteCol[i];
            float d = dot(c - p, c - p);
            if (d < best) { best = d; pick = p; }
          }
          c = pick;
        } else {
          // posterize: quantize each channel to N steps
          c = floor(c * uColorSteps + 0.5) / uColorSteps;
        }
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }
    `,
  });

  pass.setResolution = (w, h) => { pass.uniforms.uResolution.value.set(w, h); };
  return pass;
}

// MOTO STUNT — shared scene helpers used by more than one world (racing + deathmatch).
import * as THREE from 'three';
import { CFG } from './config.js';

// the infinite neon grid floor (a big shader plane). Shared by racing + the DM arena.
export function buildGridFloor() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uLine: { value: new THREE.Color(0x1f4f7a) }, uMajor: { value: new THREE.Color(0x2f7fc0) },
      uBg: { value: new THREE.Color(0x0c1020) }, uScale: { value: 0.5 },
    },
    extensions: { derivatives: true },
    vertexShader: `varying vec3 vWorld; void main(){ vWorld=(modelMatrix*vec4(position,1.0)).xyz;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vWorld; uniform vec3 uLine; uniform vec3 uMajor; uniform vec3 uBg; uniform float uScale;
      float grid(vec2 c){ vec2 g=abs(fract(c-0.5)-0.5)/fwidth(c); return 1.0-min(min(g.x,g.y),1.0); }
      void main(){ vec2 c=vWorld.xz*uScale; float mi=grid(c); float ma=grid(c*0.2);
        vec3 col=mix(uBg,uLine,mi); col=mix(col,uMajor,ma); gl_FragColor=vec4(col,1.0); }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 4000), mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.02, -CFG.trackLength / 2);
  return floor;
}

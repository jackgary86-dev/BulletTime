import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * The heat haze behind a missile's motor (#247): hot exhaust bends the light
 * that passes through it, so whatever is behind the plume shimmers. Drawn as a
 * screen-space refraction of the rendered frame inside a capsule around the
 * plume's projected axis, wobbled by noise that streams away from the nozzle.
 */
export class HeatHazePass extends Pass {
  /** Nozzle and the far end of the hot air, in world space, and the haze's radius in metres. */
  readonly nozzle = new THREE.Vector3();
  readonly tip = new THREE.Vector3();
  radius = 0;
  /** 0–1: how hard the air bends the light. */
  strength = 0;
  /** Wall-clock seconds, for the shimmer. */
  time = 0;

  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly side = new THREE.Vector3();

  constructor(private readonly camera: THREE.Camera) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        nozzle: { value: new THREE.Vector2() },
        tip: { value: new THREE.Vector2() },
        radius: { value: 0 },
        strength: { value: 0 },
        aspect: { value: 1 },
        time: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 nozzle;
        uniform vec2 tip;
        uniform float radius;
        uniform float strength;
        uniform float aspect;
        uniform float time;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv; p.x *= aspect;
          vec2 a = nozzle; a.x *= aspect;
          vec2 b = tip; b.x *= aspect;
          vec2 ab = b - a;
          float len2 = max(dot(ab, ab), 1e-8);
          float s = clamp(dot(p - a, ab) / len2, 0.0, 1.0);
          float dist = length(p - (a + ab * s));
          // Narrow at the nozzle, spreading as the exhaust mixes and cools; strongest near the nozzle.
          float r = max(radius * (0.6 + 0.8 * s), 1e-5);
          float mask = (1.0 - smoothstep(0.0, r, dist)) * (1.0 - s) * (1.0 - s * 0.5);
          // Shimmer streaming back along the axis.
          float along = s * 9.0 - time * 7.0;
          vec2 wobble = vec2(
            sin(along * 2.1 + dist * 28.0) + 0.5 * sin(along * 4.7 + 1.3),
            cos(along * 1.7 - dist * 22.0) + 0.5 * cos(along * 3.9 + 2.1));
          vec2 offset = wobble * mask * strength;
          offset.x /= aspect;
          gl_FragColor = texture2D(tDiffuse, vUv + offset);
        }`,
    });
    this.quad = new FullScreenQuad(this.material);
    this.enabled = false;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    const aspect = readBuffer.width / Math.max(1, readBuffer.height);
    const a = this.a.copy(this.nozzle).project(this.camera);
    const b = this.b.copy(this.tip).project(this.camera);
    // The haze's radius on screen: a point one radius to the camera's right of the nozzle.
    const side = this.side.setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(this.radius).add(this.nozzle).project(this.camera);
    u.nozzle.value.set(a.x * 0.5 + 0.5, a.y * 0.5 + 0.5);
    u.tip.value.set(b.x * 0.5 + 0.5, b.y * 0.5 + 0.5);
    u.radius.value = Math.abs(side.x - a.x) * 0.5 * aspect;
    u.aspect.value = aspect;
    u.time.value = this.time;
    // Behind the camera: nothing to draw, just copy.
    u.strength.value = a.z > 1 || b.z > 1 ? 0 : 0.02 * this.strength;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * The muzzle blast as schlieren footage shows it (#65): no visible ring, just
 * a thin spherical shell where the air is compressed, bending the light that
 * passes through it. Drawn as a screen-space refraction of the rendered frame
 * around the shell's projected outline, so whatever is behind it (the grid
 * board, the lab, the target) ripples as the shell sweeps over it.
 */
export class ShockwavePass extends Pass {
  /** Shell centre in world space, its radius in metres and its strength, 0–1. */
  readonly center = new THREE.Vector3();
  radius = 0;
  strength = 0;

  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;
  private readonly tmp = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor(private readonly camera: THREE.Camera) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        center: { value: new THREE.Vector2() },
        radius: { value: 0 },
        width: { value: 0.01 },
        strength: { value: 0 },
        aspect: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 center;
        uniform float radius;
        uniform float width;
        uniform float strength;
        uniform float aspect;
        varying vec2 vUv;
        void main() {
          vec2 d = vUv - center;
          d.x *= aspect;
          float r = length(d);
          vec2 dir = r > 1e-5 ? d / r : vec2(0.0);
          // A compressed shell then a rarefied one: the derivative of a gaussian bends light out, then in.
          float x = (r - radius) / width;
          float profile = x * exp(-x * x);
          vec2 offset = dir * profile * strength;
          offset.x /= aspect;
          vec4 color = texture2D(tDiffuse, vUv - offset);
          // A schlieren knife edge turns those gradients into faint light and dark bands.
          color.rgb *= 1.0 + 12.0 * strength * profile * dot(dir, vec2(0.6, 0.8));
          gl_FragColor = color;
        }`,
    });
    this.quad = new FullScreenQuad(this.material);
    this.enabled = false;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    const aspect = readBuffer.width / Math.max(1, readBuffer.height);
    // Project the centre and a point one radius to its right, as seen by the camera now.
    const c = this.tmp.copy(this.center).project(this.camera);
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(this.radius).add(this.center).project(this.camera);
    const radius = Math.abs(this.right.x - c.x) * 0.5 * aspect;
    u.center.value.set(c.x * 0.5 + 0.5, c.y * 0.5 + 0.5);
    u.aspect.value = aspect;
    u.radius.value = radius;
    // The shell thickens a little as it grows, but stays a thin line.
    u.width.value = 0.004 + radius * 0.06;
    u.strength.value = 0.05 * this.strength;
    // Behind the camera: nothing to draw, just copy.
    if (c.z > 1) u.strength.value = 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

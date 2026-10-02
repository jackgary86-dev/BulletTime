import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * The final look (#73), applied to the finished, tone-mapped frame: a
 * lift/gamma/gain grade with cool shadows and warm highlights, a gentle
 * vignette, fine animated film grain, and a touch of chromatic aberration
 * toward the frame edges, as from a real lens. The muzzle flash briefly
 * overloads it, as it does a high-speed camera's sensor (#75).
 */
export interface Grade {
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  saturation: number;
  vignette: number;
  grain: number;
  aberration: number;
}

/** The lab: neutral-warm, with cool shadows from the rim light and a little lens character. */
export const LAB_GRADE: Grade = {
  lift: [0.008, 0.01, 0.018],
  gamma: [1, 1, 1],
  gain: [1.03, 1.0, 0.97],
  shadowTint: [0.94, 0.99, 1.07],
  highlightTint: [1.04, 1.0, 0.95],
  saturation: 1.05,
  vignette: 0.35,
  grain: 0.03,
  aberration: 0.005,
};

/** High-speed backlit footage: cooler, a little desaturated, noisier, with a lighter vignette. */
export const HIGHSPEED_GRADE: Grade = {
  lift: [0, 0.004, 0.01],
  gamma: [1, 1, 1.02],
  gain: [0.98, 1.0, 1.03],
  shadowTint: [0.96, 1.0, 1.05],
  highlightTint: [1.0, 1.0, 1.0],
  saturation: 0.85,
  vignette: 0.2,
  grain: 0.045,
  aberration: 0.004,
};

/**
 * How hard the muzzle flash overloads the camera, `since` seconds after the
 * shot, counted in footage frames (#75): nothing on the trigger frame, a peak
 * on the next, then a fade over a few frames, at any slow-motion rate. A frame
 * lasts twice the 180° shutter.
 */
export function flashExposure(since: number, shutterS: number): number {
  if (shutterS <= 0 || since < 0) return 0;
  const frames = since / (2 * shutterS);
  return frames > 12 ? 0 : frames * Math.exp(1 - frames);
}

const v3 = (c: [number, number, number]) => new THREE.Vector3(...c);

export class GradePass extends ShaderPass {
  constructor() {
    super({
      uniforms: {
        tDiffuse: { value: null },
        lift: { value: v3(LAB_GRADE.lift) },
        gamma: { value: v3(LAB_GRADE.gamma) },
        gain: { value: v3(LAB_GRADE.gain) },
        shadowTint: { value: v3(LAB_GRADE.shadowTint) },
        highlightTint: { value: v3(LAB_GRADE.highlightTint) },
        saturation: { value: LAB_GRADE.saturation },
        vignette: { value: LAB_GRADE.vignette },
        grain: { value: LAB_GRADE.grain },
        aberration: { value: LAB_GRADE.aberration },
        time: { value: 0 },
        flash: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec3 lift;
        uniform vec3 gamma;
        uniform vec3 gain;
        uniform vec3 shadowTint;
        uniform vec3 highlightTint;
        uniform float saturation;
        uniform float vignette;
        uniform float grain;
        uniform float aberration;
        uniform float time;
        uniform float flash;
        varying vec2 vUv;

        float hash(vec2 p) {
          p = fract(p * vec2(443.897, 441.423));
          p += dot(p, p.yx + 19.19);
          return fract((p.x + p.y) * p.x);
        }

        void main() {
          vec2 c = vUv - 0.5;
          float r2 = dot(c, c);
          // Lateral colour fringing that grows toward the edges.
          vec2 off = c * aberration * r2 * 4.0;
          vec4 base = texture2D(tDiffuse, vUv);
          vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, base.g, texture2D(tDiffuse, vUv - off).b);

          col = gain * (col + lift * (1.0 - col));
          col = pow(max(col, 0.0), 1.0 / gamma);
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col *= mix(shadowTint, highlightTint, smoothstep(0.05, 0.75, l));
          col = mix(vec3(l), col, saturation);

          // The muzzle flash overloads the sensor (#75): exposure jumps, then the frame washes white.
          col = mix(col * (1.0 + 1.6 * flash), vec3(1.0), 0.4 * flash);

          col *= 1.0 - vignette * (1.0 - flash) * smoothstep(0.08, 0.5, r2);

          // Grain: finer and stronger in the mid-tones, fresh every frame.
          float n = hash(gl_FragCoord.xy + fract(time * 17.0) * 113.0) - 0.5;
          col += n * grain * (1.0 - abs(l - 0.5) * 1.2);
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), base.a);
        }`,
    });
  }

  setGrade(grade: Grade): void {
    const u = this.uniforms as Record<string, THREE.IUniform>;
    (u.lift.value as THREE.Vector3).set(...grade.lift);
    (u.gamma.value as THREE.Vector3).set(...grade.gamma);
    (u.gain.value as THREE.Vector3).set(...grade.gain);
    (u.shadowTint.value as THREE.Vector3).set(...grade.shadowTint);
    (u.highlightTint.value as THREE.Vector3).set(...grade.highlightTint);
    u.saturation.value = grade.saturation;
    u.vignette.value = grade.vignette;
    u.grain.value = grade.grain;
    u.aberration.value = grade.aberration;
  }

  /** Sensor overload from the muzzle flash, 0–1. */
  setFlash(amount: number): void {
    (this.uniforms as Record<string, THREE.IUniform>).flash.value = amount;
  }

  tick(seconds: number): void {
    (this.uniforms as Record<string, THREE.IUniform>).time.value = seconds;
  }
}

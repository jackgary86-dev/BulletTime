import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface PostFx {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  depthOfField: BokehPass;
  /** Sets the depth-of-field focus distance in metres from the camera. */
  setFocus(distance: number): void;
  setSize(width: number, height: number): void;
  render(): void;
}

/**
 * Post-processing chain: scene render, then bloom for muzzle flash and sparks,
 * then a subtle depth of field, then tone mapping and sRGB conversion.
 * Motion blur is optional in the brief and left for the performance ticket.
 */
export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostFx {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // A high threshold keeps the dark studio clean; only hot effects will bloom.
  const bloom = new UnrealBloomPass(size.clone(), 0.55, 0.4, 0.85);
  composer.addPass(bloom);

  const depthOfField = new BokehPass(scene, camera, {
    focus: camera.position.length(),
    aperture: 0.0015,
    maxblur: 0.006,
  });
  composer.addPass(depthOfField);

  composer.addPass(new OutputPass());

  const focusUniform = (depthOfField.uniforms as Record<string, THREE.IUniform<number>>).focus;

  return {
    composer,
    bloom,
    depthOfField,
    setFocus(distance) {
      focusUniform.value = distance;
    },
    setSize(width, height) {
      composer.setSize(width, height);
      bloom.resolution.set(width, height);
    },
    render() {
      composer.render();
    },
  };
}

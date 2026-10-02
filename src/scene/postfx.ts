import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShockwavePass } from './shockwavePass';
import { GradePass } from './gradePass';

export interface PostFx {
  composer: EffectComposer;
  /** Ground-truth ambient occlusion: darkens creases and where objects meet the floor (#55). */
  ambientOcclusion: GTAOPass;
  bloom: UnrealBloomPass;
  depthOfField: BokehPass;
  /** The muzzle blast's refracting shell (#65); enabled only while it is in the air. */
  shockwave: ShockwavePass;
  /** The final colour grade, vignette, grain and lens fringing (#73). */
  grade: GradePass;
  /** Sets the depth-of-field focus distance in metres from the camera. */
  setFocus(distance: number): void;
  setSize(width: number, height: number): void;
  render(): void;
}

/**
 * Post-processing chain: scene render, then ambient occlusion, then bloom for muzzle flash and sparks,
 * then a subtle depth of field, the muzzle blast refraction, tone mapping and sRGB conversion,
 * and finally the colour grade.
 */
export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostFx {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const ambientOcclusion = new GTAOPass(scene, camera, size.x, size.y);
  // Radius in metres: enough for a target stand to shade the floor, not so much that whole walls go grey.
  ambientOcclusion.updateGtaoMaterial({ radius: 0.12, distanceExponent: 1.5, thickness: 1, scale: 1.1, samples: 16 });
  ambientOcclusion.updatePdMaterial({ radius: 6, rings: 2, samples: 16 });
  ambientOcclusion.blendIntensity = 0.9;
  hideSeeThroughFromAo(ambientOcclusion);
  composer.addPass(ambientOcclusion);

  // A high threshold keeps the dark studio clean; only hot effects will bloom.
  const bloom = new UnrealBloomPass(size.clone(), 0.55, 0.4, 0.85);
  composer.addPass(bloom);

  const depthOfField = new BokehPass(scene, camera, {
    focus: camera.position.length(),
    aperture: 0.0015,
    maxblur: 0.006,
  });
  composer.addPass(depthOfField);

  const shockwave = new ShockwavePass(camera);
  composer.addPass(shockwave);

  composer.addPass(new OutputPass());

  const grade = new GradePass();
  composer.addPass(grade);

  const focusUniform = (depthOfField.uniforms as Record<string, THREE.IUniform<number>>).focus;

  return {
    composer,
    ambientOcclusion,
    bloom,
    depthOfField,
    shockwave,
    grade,
    setFocus(distance) {
      focusUniform.value = distance;
    },
    setSize(width, height) {
      composer.setSize(width, height);
      ambientOcclusion.setSize(width, height);
      bloom.resolution.set(width, height);
    },
    render() {
      grade.tick(performance.now() / 1000);
      composer.render();
    },
  };
}

/**
 * GTAO only skips points and lines. Gel, water, glass and soft effect sprites
 * are see-through, so they must not occlude what is behind them either.
 */
function hideSeeThroughFromAo(pass: GTAOPass): void {
  const internals = pass as unknown as { scene: THREE.Scene; _visibilityCache: THREE.Object3D[]; _overrideVisibility(): void };
  internals._overrideVisibility = function () {
    this.scene.traverse((object) => {
      if (!object.visible) return;
      const mesh = object as THREE.Mesh;
      const materials = mesh.isMesh ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      const seeThrough = materials.some((m) => m.transparent || (m as THREE.MeshPhysicalMaterial).transmission > 0);
      if ((object as THREE.Points).isPoints || (object as THREE.Line).isLine || (object as THREE.Sprite).isSprite || seeThrough) {
        object.visible = false;
        this._visibilityCache.push(object);
      }
    });
  };
}

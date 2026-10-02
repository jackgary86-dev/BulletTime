import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { samplePrimary } from '../sim/sample';
import { activeShot } from '../sim/session';
import type { Timeline } from '../sim/types';

export type CameraMode = 'auto' | 'side' | 'tracking' | 'closeup' | 'orbit';

export const CAMERA_MODES: { mode: CameraMode; label: string }[] = [
  { mode: 'auto', label: 'Auto' },
  { mode: 'side', label: 'Side' },
  { mode: 'tracking', label: 'Track' },
  { mode: 'closeup', label: 'Close' },
  { mode: 'orbit', label: 'Orbit' },
];

/**
 * Natural frequency of the camera's spring toward each pose, per real second. Higher = snappier.
 * The spring is critically damped, so the camera glides in without overshooting (#75).
 */
const EASE_RATE = { side: 5, tracking: 20, closeup: 6 } as const;
/** How quickly the spring's stiffness follows a change of pose, per real second, so cuts never jerk. */
const STIFFNESS_BLEND_RATE = 3;
/** In auto mode, cut to the close-up this long (sim time) before impact, in seconds. */
const CLOSEUP_LEAD_S = 120e-6;
/** In auto mode, hold the close-up this long after impact before pulling back, in seconds. */
const CLOSEUP_HOLD_S = 1.2e-3;

interface Pose {
  position: THREE.Vector3;
  look: THREE.Vector3;
  ease: number;
}

/**
 * Drives the camera through the presets: a classic side-on ballistics view, a
 * tracking shot that follows the bullet, a close-up on the impact point, free
 * orbit, and "auto", which cuts between them as the shot unfolds. Dragging the
 * view at any time hands control to orbit.
 */
export class CameraDirector {
  mode: CameraMode = 'auto';
  private impactPoint = new THREE.Vector3();
  private targetDepth = 0.4;
  private readonly look = new THREE.Vector3();
  private readonly pose: Pose = { position: new THREE.Vector3(), look: new THREE.Vector3(), ease: EASE_RATE.side };
  /** Velocities of the camera position and look point, in metres per real second. */
  private readonly velocity = new THREE.Vector3();
  private readonly lookVelocity = new THREE.Vector3();
  /** The spring's current stiffness, easing toward the pose's own. */
  private stiffness: number = EASE_RATE.side;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly controls: OrbitControls,
    private readonly onModeChange: (mode: CameraMode) => void,
  ) {
    controls.addEventListener('start', () => {
      if (this.mode !== 'orbit') this.setMode('orbit');
    });
    this.look.copy(controls.target);
  }

  /** Where the target's front face is struck and how deep the target is, for framing. */
  setTarget(impactPoint: THREE.Vector3, depth: number): void {
    this.impactPoint.copy(impactPoint);
    this.targetDepth = depth;
  }

  setMode(mode: CameraMode): void {
    // Leaving orbit, the camera starts at rest from wherever the user left it.
    if (this.mode === 'orbit' && mode !== 'orbit') {
      this.look.copy(this.controls.target);
      this.velocity.set(0, 0, 0);
      this.lookVelocity.set(0, 0, 0);
      // Start soft, so the glide away from a hand-placed view is gentle.
      this.stiffness = Math.min(this.stiffness, EASE_RATE.side);
    }
    this.mode = mode;
    if (mode === 'orbit') this.controls.target.copy(this.look);
    this.onModeChange(mode);
  }

  /** Back to the default framing, snapping rather than easing. */
  reset(): void {
    this.setMode('auto');
    this.sidePose(this.pose);
    this.camera.position.copy(this.pose.position);
    this.look.copy(this.pose.look);
    this.camera.lookAt(this.look);
    this.controls.target.copy(this.look);
    this.velocity.set(0, 0, 0);
    this.lookVelocity.set(0, 0, 0);
    this.stiffness = this.pose.ease;
  }

  /** Distance from the camera to what it is looking at, for depth-of-field focus. */
  get focusDistance(): number {
    return this.camera.position.distanceTo(this.mode === 'orbit' ? this.controls.target : this.look);
  }

  update(realDeltaS: number, t: number | null, timeline: Timeline | null): void {
    if (this.mode === 'orbit') {
      this.controls.update();
      return;
    }

    const pose = this.pose;
    switch (this.resolveMode(t, timeline)) {
      case 'tracking':
        if (!this.trackingPose(pose, t, timeline)) this.sidePose(pose);
        break;
      case 'closeup':
        this.closeupPose(pose);
        break;
      default:
        this.sidePose(pose);
    }

    // Blend the stiffness too: cutting from the tight tracking spring to the soft side one would
    // otherwise jerk, even with velocity carried over.
    this.stiffness += (pose.ease - this.stiffness) * (1 - Math.exp(-realDeltaS * STIFFNESS_BLEND_RATE));
    springTo(this.camera.position, this.velocity, pose.position, this.stiffness, realDeltaS);
    springTo(this.look, this.lookVelocity, pose.look, this.stiffness, realDeltaS);
    this.camera.lookAt(this.look);
    this.controls.target.copy(this.look);
  }

  private resolveMode(t: number | null, timeline: Timeline | null): Exclude<CameraMode, 'auto' | 'orbit'> {
    if (this.mode !== 'auto') return this.mode as Exclude<CameraMode, 'auto' | 'orbit'>;
    if (t === null || !timeline) return 'side';
    const impactTime = activeShot(timeline, t).impactTime;
    if (t < impactTime - CLOSEUP_LEAD_S) return 'tracking';
    if (t < impactTime + CLOSEUP_HOLD_S) return 'closeup';
    return 'side';
  }

  private sidePose(pose: Pose): void {
    const centreX = this.impactPoint.x + Math.min(this.targetDepth, 0.8) / 2;
    pose.look.set(centreX, this.impactPoint.y, 0);
    pose.position.set(centreX + 0.15, this.impactPoint.y + 0.17, 1.15 + Math.min(this.targetDepth, 0.8) * 0.3);
    pose.ease = EASE_RATE.side;
  }

  private trackingPose(pose: Pose, t: number | null, timeline: Timeline | null): boolean {
    if (t === null || !timeline) return false;
    const frame = samplePrimary(timeline, t);
    if (!frame) return false;
    const p = frame.pos;
    // Low, slightly behind and to the side of the bullet, looking just ahead of its nose.
    pose.position.set(p.x - 0.16, p.y + 0.04, p.z + 0.2);
    pose.look.set(p.x + frame.dir.x * 0.08, p.y + frame.dir.y * 0.08, p.z + frame.dir.z * 0.08);
    pose.ease = EASE_RATE.tracking;
    return true;
  }

  private closeupPose(pose: Pose): void {
    const i = this.impactPoint;
    pose.position.set(i.x - 0.2, i.y + 0.07, 0.3);
    pose.look.set(i.x + 0.05, i.y, 0);
    pose.ease = EASE_RATE.closeup;
  }
}

const offset = new THREE.Vector3();
const push = new THREE.Vector3();

/**
 * One exact step of a critically damped spring pulling `value` toward `target`
 * at natural frequency `omega`: the camera keeps its momentum through a cut and
 * settles without overshoot, however long the frame.
 */
export function springTo(value: THREE.Vector3, velocity: THREE.Vector3, target: THREE.Vector3, omega: number, dt: number): void {
  const decay = Math.exp(-omega * dt);
  offset.subVectors(value, target);
  // temp = (v + omega x) dt
  push.copy(offset).multiplyScalar(omega).add(velocity).multiplyScalar(dt);
  value.copy(target).add(offset.add(push).multiplyScalar(decay));
  velocity.addScaledVector(push, -omega).multiplyScalar(decay);
}

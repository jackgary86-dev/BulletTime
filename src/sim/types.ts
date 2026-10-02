/** Shared types for the precomputed shot timeline. Units: metres, seconds, kilograms. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** One sampled state of one projectile (bullet, pellet or fragment). */
export interface Keyframe {
  t: number;
  /** Nose position. */
  pos: Vec3;
  /** Unit direction of travel. */
  dir: Vec3;
  speed: number;
  /** Angle between the projectile axis and its direction of travel (0 = nose first, π = base first). */
  yaw: number;
  /** Current effective diameter (grows as it expands or flattens). */
  diameter: number;
}

export type TrackKind = 'bullet' | 'pellet' | 'fragment';

export type FinalState =
  | 'intact'
  | 'expanded'
  | 'deformed' // flattened against a hard medium
  | 'fragmented'
  | 'splashed' // disintegrated against hard steel or concrete
  | 'ricocheted'
  | 'detonated';

export interface Track {
  id: number;
  kind: TrackKind;
  massKg: number;
  /** Original diameter in metres. */
  baseDiameter: number;
  keyframes: Keyframe[];
  /** Time the track first appears (fragments spawn mid-shot). */
  spawnT: number;
  /** Time the track ends; after this it rests at its last keyframe or disappears. */
  endT: number;
  /** Whether the projectile is still visible after `endT` (embedded or at rest). */
  persists: boolean;
  finalState: FinalState;
}

export type EventType =
  | 'impact' // first contact with the target
  | 'enter' // entered a later layer
  | 'exit'
  | 'ricochet'
  | 'expand'
  | 'yaw'
  | 'fragment'
  | 'splash'
  | 'detonate'
  | 'stop';

export interface ShotEvent {
  t: number;
  type: EventType;
  trackId: number;
  pos: Vec3;
  /** Surface normal for impact/exit/ricochet/splash, pointing out of the face that was hit. */
  normal?: Vec3;
  speed: number;
  /** Index of the target layer involved. */
  layer?: number;
}

/** Temporary and permanent cavity data along the primary path (gel-like media only). */
export interface CavitySample {
  /** Distance along the path from the layer's entry point, in metres. */
  depth: number;
  pos: Vec3;
  /** Time the bullet passed this point. */
  t: number;
  /** Peak temporary cavity radius, in metres. */
  radius: number;
  /** Permanent wound channel radius, in metres. */
  channelRadius: number;
  /** Energy deposited per metre at this point, in J/m. */
  energyPerMetre: number;
  layer: number;
}

export interface VelocityDepthPoint {
  /** Penetration depth along the path, in metres. */
  depth: number;
  speed: number;
}

export interface ShotSummary {
  impactSpeed: number;
  impactEnergyJ: number;
  /** Deepest point reached in the target, along the path. */
  penetrationM: number;
  passedThrough: boolean;
  exitSpeed: number;
  finalState: FinalState;
  /** Final diameter of the main projectile, in metres. */
  finalDiameter: number;
  fragments: number;
  ricocheted: boolean;
  maxCavityDiameter: number;
  energyDepositedJ: number;
  velocityVsDepth: VelocityDepthPoint[];
}

export interface Timeline {
  tracks: Track[];
  events: ShotEvent[];
  cavity: CavitySample[];
  summary: ShotSummary;
  duration: number;
  impactTime: number;
}

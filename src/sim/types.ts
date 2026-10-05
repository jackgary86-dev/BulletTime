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
  /** How far a concrete panel has crushed the bullet, 0-1 (#226). Absent when untouched. */
  crush?: number;
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
  /** A scab torn off a plate's far face by a squash head (#204): plate, not penetrator. */
  scab?: boolean;
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
  /** Detonations: TNT-equivalent yield in kilograms, the fireball look, and the overpressure at the target face (kPa; charges only). */
  yieldKg?: number;
  fireball?: string;
  pressureKPa?: number;
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
  /** Detonating rounds only: TNT-equivalent yield (kg) and overpressure at the face (kPa, charges). */
  yieldKg?: number;
  blastKPa?: number;
  /** Warheads and charges: the deepest fragment or jet, and its speed against depth (the main projectile bursts, so its own curve is empty). */
  penetrator?: { trackId: number; startSpeed: number; curve: VelocityDepthPoint[] };
  /** Charges only: how each target layer fared, front to back. */
  blastLayers?: { name: string; pressureKPa: number; outcome: 'intact' | 'cracked' | 'toppled' | 'destroyed' }[];
}

/** One shot within a timeline: a single fire, or one round of a group or burst (#22). */
export interface ShotInfo {
  /** Sim time the round leaves the muzzle. */
  start: number;
  impactTime: number;
  /** Id of the main projectile's track (the bullet, or the first pellet). */
  primaryId: number;
  /** This shot's tracks are ids firstTrack … firstTrack + trackCount − 1. */
  firstTrack: number;
  trackCount: number;
  bulletId: string;
  /** Where the shot was aimed on the target face, relative to the centre, in metres. */
  aim: { y: number; z: number };
  summary: ShotSummary;
}

export interface Timeline {
  tracks: Track[];
  events: ShotEvent[];
  cavity: CavitySample[];
  /** Summary of the most recent shot. */
  summary: ShotSummary;
  duration: number;
  /** Impact time of the first shot. */
  impactTime: number;
  /** Every shot on this timeline, in firing order. */
  shots: ShotInfo[];
}

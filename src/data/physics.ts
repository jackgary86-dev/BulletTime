/**
 * Global tuning constants for the physics engine. Per-bullet and per-medium
 * constants live in `bullets.ts` and `media.ts`; these apply to every shot.
 */
export const PHYSICS = {
  /** Integration step, in seconds. */
  stepS: 1e-6,
  /** Keep one keyframe every N steps (plus every event). */
  sampleEvery: 5,
  /** A projectile slower than this inside a medium has come to rest, in m/s. */
  restSpeed: 1.5,
  /** Simulation hard limit, in seconds. */
  maxTimeS: 0.03,
  /** After the target, follow projectiles this far before ending the shot, in metres. */
  exitRunM: 0.6,
  /** Stop following a projectile this long after it last left material, in seconds. */
  maxAirAfterExitS: 3e-3,
  /** Linger after everything has stopped so the aftermath is visible, in seconds. */
  holdAfterS: 1.5e-3,

  /** Air: density and drag, so flight before the target is not perfectly lossless. */
  airDensity: 1.2,
  airDragCoefficient: 0.3,

  /** Drag multiplier for a projectile travelling sideways (yaw 90°), vs nose-first. */
  sidewaysDragFactor: 3.5,
  /** Distance over which a yawing bullet turns through 180°, in gel, in metres. */
  yawFlipDistanceM: 0.14,
  /** Nose drag factor of a hollow point packed shut by wood, gypsum or glass (like an FMJ). */
  cloggedNoseDragFactor: 0.75,
  /** Bullets slower than this stop yawing, in m/s. */
  yawMinSpeed: 120,
  /** Distance over which a hollow or soft point opens fully, in 10% gel, in metres. Scales with 1/density. */
  expansionDistanceM: 0.02,

  /** Hard media flatten soft bullets on contact: diameter × (1 + flattenGain × (hardness − 0.5)). */
  flattenGain: 2,
  /** Steel and concrete above this hardness can make a bullet splash instead of embedding. */
  splashHardness: 0.7,

  /** Fraction of speed kept after a ricochet, at hardness 0 and 1 (interpolated). */
  ricochetRestitution: [0.35, 0.7] as const,
  /** Entry turns the path toward the surface normal by this fraction of the obliquity × hardness. */
  entryDeflection: 0.12,

  /** Fragments are followed this far through the air before they leave the shot, in metres. */
  fragmentRangeM: 0.4,
  /** Fragment drag factor (irregular, tumbling shapes). */
  fragmentDragFactor: 1.4,
  /** Lead density for fragment sizing, kg/m³. */
  leadDensity: 11340,

  /** Spacing of cavity samples along the path, in metres. */
  cavitySampleM: 0.005,
  /** Permanent wound channel radius as a multiple of the bullet's current radius. */
  channelRadiusFactor: 1.4,
  /**
   * Temporary cavity venting at the entry face (#228): the cavity reaches 63% of its open-gel size one
   * VENT_RATIO × that size into the block. Shapes the cavity so it is pinched at the entry and widest deeper in.
   */
  cavityVentRatio: 0.5,
} as const;

/** How finely a shot is integrated and recorded. */
export interface SimResolution {
  /** Integration step, in seconds. */
  stepS: number;
  /** Keep one keyframe every N steps (plus every event). */
  sampleEvery: number;
  /** Distance between temporary-cavity samples along the wound path, in metres. */
  cavitySampleM: number;
}

/** The web default: 1 µs steps, a keyframe every 5 µs. */
export const STANDARD_RESOLUTION: SimResolution = {
  stepS: PHYSICS.stepS,
  sampleEvery: PHYSICS.sampleEvery,
  cavitySampleM: PHYSICS.cavitySampleM,
};

/** Ultra (#38): 0.25 µs steps, a keyframe every 2 µs and twice the cavity samples. */
export const ULTRA_RESOLUTION: SimResolution = {
  stepS: PHYSICS.stepS / 4,
  sampleEvery: 8,
  cavitySampleM: PHYSICS.cavitySampleM / 2,
};

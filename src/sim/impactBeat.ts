/**
 * The impact beat (#238): the interesting part of a shot (first contact, the
 * cavity opening, spall, exit) is over in a millisecond, so even at 1/1,000 it
 * flashes by. Playback slows down on its own round each impact: it eases into
 * a deeper slow motion just before contact, holds there for the first stretch
 * after it, then ramps back to the chosen speed. It is a warp of the playback
 * clock, not a pause: the scrubber, stepping and replay links see true
 * simulated time, and the HUD's time stamp still reads true sim time, so the
 * slow stretch reads like a high-speed camera ramping its frame rate.
 *
 * Pure functions of simulated time, so the warp is the same on every replay.
 */

/** How a beat is shaped: all times in simulated seconds. */
export interface BeatShape {
  /** Easing in before contact. */
  leadS: number;
  /** Held at `factor` after contact. */
  holdS: number;
  /** Ramping back to full speed after the hold. */
  rampS: number;
  /** The playback rate during the hold, as a share of the chosen rate (0.1 = ten times slower). */
  factor: number;
}

/** The slowest playback preset (see `RATE_PRESETS`): the beat never slows playback below it. */
export const SLOWEST_RATE = 1 / 100_000;

/** The simulators' beat: a tenth speed for the first millisecond after contact, back to full speed three milliseconds later. */
export const IMPACT_BEAT: BeatShape = { leadS: 1e-4, holdS: 1e-3, rampS: 3e-3, factor: 0.1 };

/**
 * The Armor lab's beat (its impacts take microseconds and a stack has one per
 * plate), as shares of the playback length rather than fixed times.
 */
export const ARMOR_BEAT_SHARES = { lead: 0.02, hold: 0.06, ramp: 0.12 };

/** A beat shape for the Armor lab, scaled to a playback `durationS` long. */
export function armorBeat(durationS: number): BeatShape {
  return { leadS: ARMOR_BEAT_SHARES.lead * durationS, holdS: ARMOR_BEAT_SHARES.hold * durationS, rampS: ARMOR_BEAT_SHARES.ramp * durationS, factor: IMPACT_BEAT.factor };
}

/** Smoothstep: 0 at 0, 1 at 1, flat at both ends. */
const smooth = (x: number) => {
  const s = Math.min(1, Math.max(0, x));
  return s * s * (3 - 2 * s);
};

/**
 * The playback rate multiplier at simulated time `t` (s), 1 away from every
 * impact and `factor` during each hold, continuous everywhere. With several
 * impacts the deepest slow-down wins, so a cluster of pellet strikes is one
 * long beat, not a flutter.
 */
export function beatFactor(t: number, impacts: readonly number[], shape: BeatShape = IMPACT_BEAT): number {
  let f = 1;
  for (const ti of impacts) {
    const d = t - ti;
    let g = 1;
    if (d >= -shape.leadS && d < 0) g = 1 - (1 - shape.factor) * smooth((d + shape.leadS) / shape.leadS);
    else if (d >= 0 && d < shape.holdS) g = shape.factor;
    else if (d >= shape.holdS && d < shape.holdS + shape.rampS) g = shape.factor + (1 - shape.factor) * smooth((d - shape.holdS) / shape.rampS);
    if (g < f) f = g;
  }
  return f;
}

/** The stretches of simulated time a beat slows, merged where they overlap and sorted, for the scrubber to show. */
export function beatSpans(impacts: readonly number[], shape: BeatShape = IMPACT_BEAT): [number, number][] {
  const spans = [...impacts].sort((a, b) => a - b).map((ti): [number, number] => [ti - shape.leadS, ti + shape.holdS + shape.rampS]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

/**
 * The most extra real time one beat can add at playback rate `rate` (sim
 * seconds per real second), s: the whole window played at the hold rate.
 */
export function beatExtraRealS(rate: number, shape: BeatShape = IMPACT_BEAT): number {
  return ((shape.leadS + shape.holdS + shape.rampS) / rate) * (1 / shape.factor - 1);
}

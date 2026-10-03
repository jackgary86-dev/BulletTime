/**
 * Where each round of a Fire lands relative to the aim point (#153), before it
 * is kept on the target face. Single is one round on the aim point. A group is
 * deliberate aimed shots, scattered uniformly over a disc of the spread radius.
 * A burst is fast follow-up shots that climb with recoil: each lands higher and
 * a little to the right of the last, with a small scatter.
 */

export type FireMode = 'single' | 'group' | 'burst';

/** How far each burst round climbs, and drifts right, as a fraction of the spread setting. */
export const BURST_CLIMB = 0.7;
export const BURST_DRIFT = 0.3;
/** Scatter of each burst round around its climb line, as a fraction of the spread setting. */
export const BURST_SCATTER = 0.2;

export function roundOffsets(mode: FireMode, count: number, spreadM: number, rand: () => number): { y: number; z: number }[] {
  if (mode === 'single') return [{ y: 0, z: 0 }];
  const out: { y: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (mode === 'group') {
      const r = spreadM * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      out.push({ y: r * Math.sin(a), z: r * Math.cos(a) });
    } else {
      const jitter = () => (rand() - 0.5) * 2 * BURST_SCATTER * spreadM;
      out.push({ y: i * BURST_CLIMB * spreadM + jitter(), z: i * BURST_DRIFT * spreadM + jitter() });
    }
  }
  return out;
}

/** Each mode draws its own random sequence, so a group and a burst never land the same shots. */
export function patternSeed(mode: FireMode, shotsSoFar: number): number {
  return (mode === 'burst' ? 7717 : 9001) + shotsSoFar;
}

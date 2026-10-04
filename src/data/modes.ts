import { ARTILLERY } from './artillery';
import { BULLETS, getBullet, type BulletSpec, type SimulatorId } from './bullets';
import { EXPLOSIVES } from './explosives';
import { DEFAULT_AIRFRAME_ID, DEFAULT_WARHEAD_ID, missileId } from './missiles';

/** What each simulator is called in the UI, and what it calls the thing being tested. */
export interface ModeInfo {
  id: SimulatorId;
  title: string;
  /** Label above the picker. */
  pickerLabel: string;
  /** Round the mode starts on. */
  defaultId: string;
}

export const MODES: Record<SimulatorId, ModeInfo> = {
  bullet: { id: 'bullet', title: 'Bullet', pickerLabel: 'Round', defaultId: '9mm-jhp' },
  artillery: { id: 'artillery', title: 'Artillery', pickerLabel: 'Shell', defaultId: '155mm-he' },
  missile: { id: 'missile', title: 'Missile', pickerLabel: 'Missile', defaultId: missileId(DEFAULT_AIRFRAME_ID, DEFAULT_WARHEAD_ID) },
  explosion: { id: 'explosion', title: 'Explosion', pickerLabel: 'Charge', defaultId: 'charge-block' },
};

/** The rounds the picker lists for a mode (missiles are built from an airframe and a head instead). */
export function roundsForMode(mode: SimulatorId): BulletSpec[] {
  switch (mode) {
    case 'artillery':
      // The 20 mm shell opens the range, shared with Bullet.
      return [getBullet('20mm-hei'), ...ARTILLERY];
    case 'explosion':
      return EXPLOSIVES;
    case 'missile':
      return [];
    default:
      return BULLETS;
  }
}

/** True for rounds that leave a muzzle (and so get a muzzle flash and smoke). */
export function hasMuzzle(spec: BulletSpec): boolean {
  return spec.shape !== 'missile' && spec.shape !== 'charge';
}

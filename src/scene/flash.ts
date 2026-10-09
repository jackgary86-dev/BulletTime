/**
 * How bright the flashes are (#321). A hot impact lights the plate with a point light that bloom then spreads; on a
 * shell hit that light ran to several candela 3 cm off the face and the glow hid the hole it was lighting. The light is
 * soft-capped here, and the Flash setting (off, low, normal) scales it and the muzzle-flash exposure wash. Clean frame
 * turns the wash off, so a frame can always be inspected.
 */

export type FlashLevel = 'normal' | 'low' | 'off';

export const FLASH_LEVELS: { level: FlashLevel; label: string }[] = [
  { level: 'normal', label: 'Normal' },
  { level: 'low', label: 'Low' },
  { level: 'off', label: 'Off' },
];

/** What each level multiplies the impact light and the exposure wash by. */
export const FLASH_SCALE: Record<FlashLevel, number> = { normal: 1, low: 0.4, off: 0 };

/**
 * The brightest the impact light gets, in candela. A rifle round on steel (about 0.1 to 0.2 cd) is barely touched;
 * a shell hit (over 3 cd) and a charge (6 cd and up) are held near this, so a bigger hit still lights more, up to here.
 */
export const FLASH_CAP_CD = 0.6;

/** Soft cap: close to linear for a small flash, rising toward FLASH_CAP_CD for a big one and never past it. */
export function flashCandela(raw: number): number {
  if (!(raw > 0)) return 0;
  return FLASH_CAP_CD * Math.tanh(raw / FLASH_CAP_CD);
}

let level: FlashLevel = 'normal';
let clean = false;

export function setFlashLevel(next: FlashLevel): void {
  level = next;
}

/** Clean frame (#239) is for inspecting a frame, so it drops the exposure wash. */
export function setCleanFrameFlash(on: boolean): void {
  clean = on;
}

/** What the impact light is multiplied by. */
export function lightScale(): number {
  return FLASH_SCALE[level];
}

/** What the muzzle-flash exposure wash is multiplied by. */
export function washScale(): number {
  return clean ? 0 : FLASH_SCALE[level];
}

const STORAGE_KEY = 'bullettime.flash';

export function initialFlash(): FlashLevel {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'normal' || saved === 'low' || saved === 'off') return saved;
  } catch {
    // Storage can be blocked; fall back to normal.
  }
  return 'normal';
}

export function saveFlash(next: FlashLevel): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembered this time; the app still works.
  }
}

/**
 * How bright the flash of a hot impact may be (#321). The point light at the hit grows with the round and, left
 * alone, lit the face so far above everything else that the plate, the hole and the first debris washed out in
 * the frames that matter most. Two things now keep the strike readable:
 *  - a soft cap on the light, so a bigger round still looks bigger but never past what the picture can hold;
 *  - a flash setting (off, low, normal), kept in the browser, that scales the light and the camera's exposure wash.
 * Clean frame also drops the exposure wash, so a blown frame can always be inspected.
 */

export type FlashSetting = 'off' | 'low' | 'normal';

export const FLASH_SETTINGS: readonly FlashSetting[] = ['off', 'low', 'normal'];
export const FLASH_SCALE: Record<FlashSetting, number> = { off: 0, low: 0.4, normal: 1 };

/** The most light a flash may throw, in candela (a soft limit: see `softClipFlash`). */
export const FLASH_CAP_CD = 0.35;

const STORAGE_KEY = 'bullettime.flash';

function load(): FlashSetting {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'off' || saved === 'low' || saved === 'normal') return saved;
  } catch {
    // Private windows and blocked site data: use the default.
  }
  return 'normal';
}

let current: FlashSetting = load();
let washSuppressed = false;

export function flashSetting(): FlashSetting {
  return current;
}

export function setFlashSetting(next: FlashSetting): void {
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembered, still applied.
  }
}

/** Clean frame is on: the whole-frame exposure wash is dropped so the frame can be read. */
export function suppressFlashWash(on: boolean): void {
  washSuppressed = on;
}

/** Soft limit: close to the input for small flashes, flattening toward `cap` for big ones, never above it. */
export function softClipFlash(candela: number, cap = FLASH_CAP_CD): number {
  if (!(candela > 0)) return 0;
  return cap * Math.tanh(candela / cap);
}

/** The light level a flash of `candela` is drawn at, with the setting applied. */
export function flashLightLevel(candela: number, setting: FlashSetting = current): number {
  return softClipFlash(candela) * FLASH_SCALE[setting];
}

/** The multiplier on the camera's exposure wash: the setting, and nothing at all in a clean frame. */
export function flashWashScale(setting: FlashSetting = current, suppressed = washSuppressed): number {
  return suppressed ? 0 : FLASH_SCALE[setting];
}

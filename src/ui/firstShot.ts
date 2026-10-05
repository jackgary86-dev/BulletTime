/**
 * First launch (#241): a fresh player sees one great shot before any menu.
 * After the content gate the launcher is skipped, the Bullet lab opens on a
 * fixed shot (a .308 soft point into 10% gel) and fires it on its own with
 * every panel hidden; the panels and a "Pick a simulator" button slide in
 * once it lands. Later launches go to the launcher as before, unless the
 * player ticks "Open with a shot" in About.
 */

/** The shot a fresh player sees. Change it here. */
export const FIRST_SHOT = { bullet: '308-sp', medium: 'gel10' } as const;

const SEEN_KEY = 'bullettime.firstShotSeen';
const ALWAYS_KEY = 'bullettime.openWithShot';

type Reader = Pick<Storage, 'getItem'>;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether this launch opens on the first shot: never when the address asks
 * for something (a simulator, a replay link, a screenshot run), always when
 * the player asked for it, and otherwise only until the shot has been seen
 * once. With no storage (blocked) it is skipped, since it could not be
 * remembered and would play on every launch.
 */
export function shouldOpenWithShot(store: Reader | null, search: string): boolean {
  const params = new URLSearchParams(search);
  // `?launcher` asks for the launcher outright (the desktop smoke test and store screenshots start fresh profiles).
  if (['mode', 'at', 'still', 'clean', 'launcher'].some((k) => params.has(k))) return false;
  if (!store) return false;
  if (store.getItem(ALWAYS_KEY) === '1') return true;
  return store.getItem(SEEN_KEY) !== '1';
}

export function openWithShotNow(): boolean {
  return shouldOpenWithShot(storage(), globalThis.location?.search ?? '');
}

export function markFirstShotSeen(): void {
  try {
    storage()?.setItem(SEEN_KEY, '1');
  } catch {
    // Not remembered; the shot plays again next time.
  }
}

/** The player's "Open with a shot" choice in About. */
export function openWithShotAlways(): boolean {
  return storage()?.getItem(ALWAYS_KEY) === '1';
}

export function setOpenWithShotAlways(on: boolean): void {
  try {
    storage()?.setItem(ALWAYS_KEY, on ? '1' : '0');
  } catch {
    // Not remembered this time.
  }
}

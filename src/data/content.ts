/**
 * Player content settings (#109): whether the mature-content warning has been
 * accepted, and "reduced gore", which turns simulated blood into a clear blue
 * simulant fluid. Both are remembered in localStorage when it is available.
 */

const ACCEPTED_KEY = 'bullettime.contentWarningAccepted';
const REDUCED_GORE_KEY = 'bullettime.reducedGore';

/** The simulant colour used in place of blood when reduced gore is on. */
export const SIMULANT_COLOR = 0x2f6f9c;

let reduced = read(REDUCED_GORE_KEY) === '1';
const listeners = new Set<(on: boolean) => void>();

export function warningAccepted(): boolean {
  return read(ACCEPTED_KEY) === '1';
}

export function acceptWarning(): void {
  write(ACCEPTED_KEY, '1');
}

export function reducedGore(): boolean {
  return reduced;
}

export function setReducedGore(on: boolean): void {
  if (on === reduced) return;
  reduced = on;
  write(REDUCED_GORE_KEY, on ? '1' : '0');
  for (const listener of listeners) listener(on);
}

/** Calls `listener` whenever reduced gore is switched. */
export function onReducedGoreChange(listener: (on: boolean) => void): void {
  listeners.add(listener);
}

/** `color` as given, or the simulant colour when reduced gore is on. */
export function bloodColor(color: number): number {
  return reduced ? SIMULANT_COLOR : color;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered this time; the setting still applies for this session.
  }
}

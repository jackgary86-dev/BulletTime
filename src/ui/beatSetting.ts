/** The player's choice for the impact beat (#238), remembered across visits. On by default. */

const STORAGE_KEY = 'bullettime.impactBeat';

export function loadImpactBeat(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveImpactBeat(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered this time; the setting still applies now.
  }
}

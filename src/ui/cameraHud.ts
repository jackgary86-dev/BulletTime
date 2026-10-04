/**
 * Burned-in readout of a high-speed camera (#75, #239): the timecode since the
 * trigger and the round's current speed, and nothing else. Depth, energy and
 * the rest are in the results panel.
 */
export interface CameraHud {
  /** Shows the readout at sim time `t` with the round moving at `speed` m/s. */
  set(t: number, speed: number): void;
  hide(): void;
}

export function mountCameraHud(root: HTMLElement): CameraHud {
  const hud = document.createElement('div');
  hud.className = 'camera-hud';
  hud.setAttribute('aria-hidden', 'true');
  hud.hidden = true;
  hud.innerHTML = `
    <span class="hud-time"></span>
    <span class="hud-speed"></span>
  `;
  root.append(hud);
  const time = hud.querySelector<HTMLSpanElement>('.hud-time')!;
  const speedText = hud.querySelector<HTMLSpanElement>('.hud-speed')!;

  return {
    set(t, speed) {
      hud.hidden = false;
      time.textContent = formatTimecode(t);
      speedText.textContent = formatSpeed(speed);
    },
    hide() {
      hud.hidden = true;
    },
  };
}

/** Sim time as a camera timecode: seconds to the microsecond, grouped in threes. */
export function formatTimecode(seconds: number): string {
  const us = Math.round(Math.max(0, seconds) * 1e6);
  const whole = Math.floor(us / 1e6);
  const frac = String(us % 1e6).padStart(6, '0');
  return `T+${whole}.${frac.slice(0, 3)} ${frac.slice(3)} s`;
}

/** A whole number with thin-space thousands, e.g. 60 000. */
export function formatCount(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** A speed in metres per second, e.g. 1 240 m/s. */
export function formatSpeed(metresPerSecond: number): string {
  return `${formatCount(Math.max(0, metresPerSecond))} m/s`;
}

/**
 * Burned-in readout of a high-speed camera (#75), kept to two readouts while
 * a shot plays (#239): the timecode since the trigger, in true simulated time,
 * and the round's speed. Everything else waits for the results panel.
 */
export interface CameraHud {
  /** Shows the readout at sim time `t` with the round at `speedMs` (m/s). */
  set(t: number, speedMs: number): void;
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
  const speed = hud.querySelector<HTMLSpanElement>('.hud-speed')!;

  return {
    set(t, speedMs) {
      hud.hidden = false;
      time.textContent = formatTimecode(t);
      speed.textContent = formatSpeed(speedMs);
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

/** A speed for the readout, e.g. 1 250 m/s. */
export function formatSpeed(speedMs: number): string {
  return `${formatCount(Math.max(0, speedMs))} m/s`;
}

/** A whole number with thin-space thousands, e.g. 60 000. */
export function formatCount(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** An exposure as a shutter speed, e.g. 1/120 000 s. */
export function formatShutter(seconds: number): string {
  return seconds > 0 ? `1/${formatCount(1 / seconds)} s` : '';
}

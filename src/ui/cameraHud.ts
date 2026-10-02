/**
 * Burned-in readout of a high-speed camera (#75), as on Phantom footage: a
 * recording dot, the timecode since the trigger, the frame rate the current
 * slow-motion rate implies, the shutter, and the frame number.
 */
export interface CameraHud {
  /** Shows the readout at sim time `t`, filmed at `fps` with a `shutterS` exposure. */
  set(t: number, fps: number, shutterS: number): void;
  hide(): void;
}

export function mountCameraHud(root: HTMLElement): CameraHud {
  const hud = document.createElement('div');
  hud.className = 'camera-hud';
  hud.setAttribute('aria-hidden', 'true');
  hud.hidden = true;
  hud.innerHTML = `
    <span class="hud-rec">REC</span>
    <span class="hud-time"></span>
    <span class="hud-fps"></span>
    <span class="hud-shutter"></span>
    <span class="hud-frame"></span>
  `;
  root.append(hud);
  const time = hud.querySelector<HTMLSpanElement>('.hud-time')!;
  const fpsText = hud.querySelector<HTMLSpanElement>('.hud-fps')!;
  const shutter = hud.querySelector<HTMLSpanElement>('.hud-shutter')!;
  const frame = hud.querySelector<HTMLSpanElement>('.hud-frame')!;

  return {
    set(t, fps, shutterS) {
      hud.hidden = false;
      time.textContent = formatTimecode(t);
      fpsText.textContent = `${formatCount(fps)} fps`;
      shutter.textContent = formatShutter(shutterS);
      frame.textContent = `F ${String(Math.floor(t * fps + 1e-6)).padStart(6, '0')}`;
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

/** An exposure as a shutter speed, e.g. 1/120 000 s. */
export function formatShutter(seconds: number): string {
  return seconds > 0 ? `1/${formatCount(1 / seconds)} s` : '';
}

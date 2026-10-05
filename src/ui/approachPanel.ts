import { BEARING_STEP_DEG, MAX_BEARING_DEG, MAX_DIVE_DEG, clampApproach, type Approach } from '../sim/approach';

export interface ApproachPanel {
  set(approach: Approach): void;
  get(): Approach;
}

/**
 * Missile approach (#250): the dive angle (0° level to 90° straight down) and
 * the bearing it comes in on (in 15° steps either side of head on). The aim
 * point stays on the target; the path is worked back from it.
 */
export function mountApproachPanel(host: HTMLElement, onChange: (approach: Approach) => void): ApproachPanel {
  const section = document.createElement('section');
  section.className = 'approach-section';
  section.innerHTML = `
    <label class="field-label">Dive <output class="dive-value"></output>
      <input id="dive-slider" type="range" min="0" max="${MAX_DIVE_DEG}" step="5" value="0" /></label>
    <label class="field-label">Bearing <output class="bearing-value"></output>
      <input id="bearing-slider" type="range" min="${-MAX_BEARING_DEG}" max="${MAX_BEARING_DEG}" step="${BEARING_STEP_DEG}" value="0" /></label>
  `;
  host.append(section);
  const dive = section.querySelector<HTMLInputElement>('#dive-slider')!;
  const bearing = section.querySelector<HTMLInputElement>('#bearing-slider')!;
  const diveOut = section.querySelector<HTMLOutputElement>('.dive-value')!;
  const bearingOut = section.querySelector<HTMLOutputElement>('.bearing-value')!;

  const read = (): Approach => clampApproach({ diveDeg: Number(dive.value), bearingDeg: Number(bearing.value) });
  const show = () => {
    const a = read();
    diveOut.textContent = a.diveDeg === 0 ? 'level' : a.diveDeg === 90 ? '90° (straight down)' : `${a.diveDeg}°`;
    bearingOut.textContent = a.bearingDeg === 0 ? 'head on' : `${Math.abs(a.bearingDeg)}° ${a.bearingDeg > 0 ? 'left' : 'right'}`;
  };
  for (const input of [dive, bearing]) {
    input.addEventListener('input', () => {
      show();
      onChange(read());
    });
  }
  show();

  return {
    set(a) {
      const c = clampApproach(a);
      dive.value = String(c.diveDeg);
      bearing.value = String(c.bearingDeg);
      show();
    },
    get: read,
  };
}

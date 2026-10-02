/** How the next Fire is laid out: one shot, a group fired one after another, or a burst on one timeline. */
export type FireMode = 'single' | 'group' | 'burst';

export interface FirePlan {
  /** Aim point on the target face relative to its centre, in metres (y up, z across). */
  aimY: number;
  aimZ: number;
  mode: FireMode;
  /** Rounds per group or burst. */
  count: number;
  /** Radius of the random spread around the aim point, in metres. */
  spreadM: number;
  /** Burst cyclic rate, rounds per minute. */
  rpm: number;
}

export interface ShotsPanel {
  plan(): FirePlan;
  /** Keeps the aim point on the face of the current target. */
  setLimits(halfY: number, halfZ: number): void;
  setSession(summary: { shots: number; energyJ: number; groupM: number } | null): void;
}

const AIM_STEP_M = 0.01;
const AIM_MARGIN_M = 0.01;

/**
 * Aim and multiple-shot controls (#22): nudge the aim point across the target
 * face, pick single, group or burst fire, and see the running totals of the
 * shots fired since the last Reset.
 */
export function mountShotsPanel(root: HTMLElement): ShotsPanel {
  const panel = document.createElement('section');
  panel.className = 'panel shots-panel';
  panel.innerHTML = `
    <div class="shots-top">
      <div class="aim-pad" role="group" aria-label="Aim">
        <button type="button" data-dy="1" data-dz="0" class="up" title="Aim up 1 cm">↑</button>
        <button type="button" data-dy="0" data-dz="-1" class="left" title="Aim left 1 cm">←</button>
        <button type="button" data-centre="1" class="centre" title="Aim at the centre">●</button>
        <button type="button" data-dy="0" data-dz="1" class="right" title="Aim right 1 cm">→</button>
        <button type="button" data-dy="-1" data-dz="0" class="down" title="Aim down 1 cm">↓</button>
      </div>
      <div class="shots-side">
        <span class="field-label">Aim <output class="aim-value"></output></span>
        <div class="fire-modes" role="group" aria-label="Fire mode">
          <button type="button" data-mode="single" class="active">Single</button>
          <button type="button" data-mode="group">Group</button>
          <button type="button" data-mode="burst">Burst</button>
        </div>
      </div>
    </div>
    <div class="multi-options" hidden>
      <label class="field-label">Rounds <output class="rounds-value"></output>
        <input id="rounds-slider" type="range" min="2" max="10" step="1" value="5" /></label>
      <label class="field-label">Spread <output class="spread-value"></output>
        <input id="spread-slider" type="range" min="0" max="0.08" step="0.005" value="0.02" /></label>
      <label class="field-label burst-options" hidden>Rate <output class="rpm-value"></output>
        <input id="rpm-slider" type="range" min="300" max="1200" step="50" value="750" /></label>
    </div>
    <p class="session-summary">No shots yet. Each Fire adds to the damage until you press Reset.</p>
  `;
  root.append(panel);

  const q = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
  const plan: FirePlan = { aimY: 0, aimZ: 0, mode: 'single', count: 5, spreadM: 0.02, rpm: 750 };
  let limits = { y: 0.05, z: 0.05 };

  const showAim = () => {
    const part = (v: number, pos: string, neg: string) =>
      Math.abs(v) < 1e-6 ? '' : `${(Math.abs(v) * 100).toFixed(0)} cm ${v > 0 ? pos : neg}`;
    const text = [part(plan.aimY, 'up', 'down'), part(plan.aimZ, 'right', 'left')].filter(Boolean).join(', ');
    q<HTMLOutputElement>('.aim-value').textContent = text || 'centre';
  };
  const clampAim = () => {
    plan.aimY = Math.max(-limits.y, Math.min(limits.y, plan.aimY));
    plan.aimZ = Math.max(-limits.z, Math.min(limits.z, plan.aimZ));
    showAim();
  };
  for (const button of panel.querySelectorAll<HTMLButtonElement>('.aim-pad button')) {
    button.addEventListener('click', () => {
      if (button.dataset.centre) {
        plan.aimY = 0;
        plan.aimZ = 0;
      } else {
        plan.aimY += Number(button.dataset.dy) * AIM_STEP_M;
        plan.aimZ += Number(button.dataset.dz) * AIM_STEP_M;
      }
      clampAim();
    });
  }

  const modeButtons = [...panel.querySelectorAll<HTMLButtonElement>('.fire-modes button')];
  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      plan.mode = button.dataset.mode as FireMode;
      for (const b of modeButtons) b.classList.toggle('active', b === button);
      q('.multi-options').hidden = plan.mode === 'single';
      q('.burst-options').hidden = plan.mode !== 'burst';
    });
  }

  const slider = (id: string, out: string, apply: (v: number) => string) => {
    const input = q<HTMLInputElement>(`#${id}`);
    const update = () => (q<HTMLOutputElement>(out).textContent = apply(Number(input.value)));
    input.addEventListener('input', update);
    update();
  };
  slider('rounds-slider', '.rounds-value', (v) => String((plan.count = v)));
  slider('spread-slider', '.spread-value', (v) => `${((plan.spreadM = v) * 100).toFixed(1)} cm`);
  slider('rpm-slider', '.rpm-value', (v) => `${(plan.rpm = v)} rpm`);
  showAim();

  return {
    plan: () => ({ ...plan }),
    setLimits(halfY, halfZ) {
      limits = { y: Math.max(0, halfY - AIM_MARGIN_M), z: Math.max(0, halfZ - AIM_MARGIN_M) };
      clampAim();
    },
    setSession(summary) {
      q('.session-summary').textContent = summary
        ? `${summary.shots} shot${summary.shots === 1 ? '' : 's'} · ${Math.round(summary.energyJ).toLocaleString('en-US')} J delivered` +
          (summary.shots > 1 ? ` · group ${(summary.groupM * 100).toFixed(1)} cm` : '')
        : 'No shots yet. Each Fire adds to the damage until you press Reset.';
    },
  };
}

import {
  bulletMassKg,
  fpsFromMs,
  getBullet,
  gramsFromGrains,
  muzzleEnergyJ,
  type BulletSpec,
  type SimulatorId,
} from '../data/bullets';
import { AIRFRAMES, WARHEADS, missileSpec } from '../data/missiles';
import { MODES, roundsForMode } from '../data/modes';
import { createBulletPreview } from './bulletPreview';

export interface BulletSelectorOptions {
  initialId: string;
  mode?: SimulatorId;
  onChange(spec: BulletSpec): void;
}

/**
 * The round picker: a dropdown of the catalogue, a true-scale model preview and
 * a data card with the round's real-world numbers. In the Missile simulator the
 * picker is an airframe plus a warhead head.
 */
export function mountBulletSelector(root: HTMLElement, options: BulletSelectorOptions): void {
  const mode = options.mode ?? 'bullet';
  const missile = mode === 'missile';
  const panel = document.createElement('section');
  panel.className = 'panel bullet-panel';
  panel.innerHTML = `
    <label class="field-label" for="bullet-select">${MODES[mode].pickerLabel}</label>
    <select id="bullet-select"></select>
    ${missile ? '<label class="field-label" for="warhead-select">Warhead</label><select id="warhead-select"></select>' : ''}
    <canvas class="bullet-preview" aria-label="Selected projectile at true scale"></canvas>
    <p class="scale-note">True scale, ruler in mm</p>
    <dl class="bullet-data"></dl>
    <p class="bullet-description"></p>
  `;
  root.append(panel);

  const select = panel.querySelector<HTMLSelectElement>('#bullet-select')!;
  const warheadSelect = panel.querySelector<HTMLSelectElement>('#warhead-select');
  const data = panel.querySelector<HTMLDListElement>('.bullet-data')!;
  const description = panel.querySelector<HTMLParagraphElement>('.bullet-description')!;
  const preview = createBulletPreview(panel.querySelector<HTMLCanvasElement>('.bullet-preview')!);

  if (missile) {
    for (const a of AIRFRAMES) select.append(new Option(a.name, a.id));
    for (const w of WARHEADS) warheadSelect!.append(new Option(w.name, w.id));
  } else {
    // Rounds with a group (artillery) are listed under its heading.
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const bullet of roundsForMode(mode)) {
      const option = new Option(`${bullet.name} ${bullet.type}`, bullet.id);
      if (!bullet.group) {
        select.append(option);
        continue;
      }
      let group = groups.get(bullet.group);
      if (!group) {
        group = document.createElement('optgroup');
        group.label = bullet.group;
        groups.set(bullet.group, group);
        select.append(group);
      }
      group.append(option);
    }
  }

  const current = (): BulletSpec => (missile ? missileSpec(select.value, warheadSelect!.value) : getBullet(select.value));

  const show = (spec: BulletSpec) => {
    const grams = gramsFromGrains(spec.massGrains);
    const perPellet = spec.pellets ? ' each' : '';
    const heavy = grams >= 200;
    const massText = heavy ? `${(grams / 1000).toFixed(grams >= 10000 ? 0 : 1)} kg` : `${spec.massGrains.toLocaleString('en-US')} gr · ${grams.toFixed(2)} g${perPellet}`;
    const rows: [string, string][] = [
      ['Caliber', `${spec.caliberMm.toFixed(spec.caliberMm >= 30 ? 0 : 2)} mm`],
      ['Type', spec.type],
      ['Mass', massText],
    ];
    if (spec.behaviour !== 'charge') {
      rows.push(['Velocity', `${spec.muzzleVelocityMs} m/s · ${Math.round(fpsFromMs(spec.muzzleVelocityMs)).toLocaleString('en-US')} ft/s`]);
      rows.push(['Energy', formatEnergy(muzzleEnergyJ(spec))]);
    }
    if (spec.blast && spec.blast.yieldKg > 0) rows.push(['Explosive', `${spec.blast.yieldKg < 1 ? spec.blast.yieldKg.toFixed(2) : spec.blast.yieldKg.toFixed(1)} kg TNT eq.`]);
    if (spec.standoffM) rows.push(['Stand-off', `${spec.standoffM.toFixed(1)} m`]);
    if (spec.pellets) rows.push(['Pellets', `${spec.pellets} × ${(bulletMassKg(spec) * 1000).toFixed(2)} g`]);
    data.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    description.textContent = spec.description;
    panel.classList.toggle('fun', !!spec.fun);
    preview.show(spec);
  };

  const changed = () => {
    const spec = current();
    show(spec);
    options.onChange(spec);
  };
  select.addEventListener('change', changed);
  warheadSelect?.addEventListener('change', changed);

  if (missile) {
    const [, airframe, head] = options.initialId.split(':');
    select.value = airframe;
    warheadSelect!.value = head;
  } else {
    select.value = options.initialId;
  }
  show(current());
}

function formatEnergy(j: number): string {
  return j >= 1e6 ? `${(j / 1e6).toFixed(1)} MJ` : `${Math.round(j).toLocaleString('en-US')} J`;
}

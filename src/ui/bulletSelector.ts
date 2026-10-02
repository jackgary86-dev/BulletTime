import {
  BULLETS,
  bulletMassKg,
  fpsFromMs,
  getBullet,
  gramsFromGrains,
  muzzleEnergyJ,
  type BulletSpec,
} from '../data/bullets';
import { createBulletPreview } from './bulletPreview';

export interface BulletSelectorOptions {
  initialId: string;
  onChange(spec: BulletSpec): void;
}

/**
 * The round picker: a dropdown of the catalogue, a true-scale model preview and
 * a data card with the round's real-world numbers.
 */
export function mountBulletSelector(root: HTMLElement, options: BulletSelectorOptions): void {
  const panel = document.createElement('section');
  panel.className = 'panel bullet-panel';
  panel.innerHTML = `
    <label class="field-label" for="bullet-select">Round</label>
    <select id="bullet-select"></select>
    <canvas class="bullet-preview" aria-label="Selected projectile at true scale"></canvas>
    <p class="scale-note">True scale, ruler in mm</p>
    <dl class="bullet-data"></dl>
    <p class="bullet-description"></p>
  `;
  root.append(panel);

  const select = panel.querySelector<HTMLSelectElement>('#bullet-select')!;
  const data = panel.querySelector<HTMLDListElement>('.bullet-data')!;
  const description = panel.querySelector<HTMLParagraphElement>('.bullet-description')!;
  const preview = createBulletPreview(panel.querySelector<HTMLCanvasElement>('.bullet-preview')!);

  for (const bullet of BULLETS) {
    const option = document.createElement('option');
    option.value = bullet.id;
    option.textContent = `${bullet.name} ${bullet.type}`;
    select.append(option);
  }

  const show = (spec: BulletSpec) => {
    const grams = gramsFromGrains(spec.massGrains);
    const perPellet = spec.pellets ? ' each' : '';
    const rows: [string, string][] = [
      ['Caliber', `${spec.caliberMm.toFixed(2)} mm`],
      ['Type', spec.type],
      ['Mass', `${spec.massGrains} gr · ${grams.toFixed(2)} g${perPellet}`],
      ['Velocity', `${spec.muzzleVelocityMs} m/s · ${Math.round(fpsFromMs(spec.muzzleVelocityMs)).toLocaleString('en-US')} ft/s`],
      ['Energy', `${Math.round(muzzleEnergyJ(spec)).toLocaleString('en-US')} J`],
    ];
    if (spec.pellets) rows.push(['Pellets', `${spec.pellets} × ${(bulletMassKg(spec) * 1000).toFixed(2)} g`]);
    data.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    description.textContent = spec.description;
    panel.classList.toggle('fun', !!spec.fun);
    preview.show(spec);
  };

  select.addEventListener('change', () => {
    const spec = getBullet(select.value);
    show(spec);
    options.onChange(spec);
  });

  select.value = options.initialId;
  show(getBullet(options.initialId));
}

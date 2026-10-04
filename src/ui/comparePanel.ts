import { getBullet, type BulletSpec, type SimulatorId } from '../data/bullets';
import { MISSILES } from '../data/missiles';
import { roundsForMode } from '../data/modes';
import { MEDIA, getMedium, mediumListedIn } from '../data/media';
import { STACK_PRESETS, presetLayers, presetListedIn } from '../data/stacks';
import type { TargetSetup } from './stackEditor';

export interface ComparePanelOptions {
  onToggle(on: boolean): void;
  /** Shot B's round or target changed. */
  onChange(spec: BulletSpec, setup: TargetSetup): void;
}

export interface ComparePanel {
  readonly on: boolean;
  readonly spec: BulletSpec;
  readonly setup: TargetSetup;
}

/**
 * Comparison mode (#14): a toggle and shot B's round and target. Shot A is the
 * main setup on the left; B plays on the right, on the same clock.
 */
export function mountComparePanel(root: HTMLElement, initial: { bulletId: string; mediumId: string; thicknessM?: number; mode?: SimulatorId }, options: ComparePanelOptions): ComparePanel {
  const panel = document.createElement('section');
  panel.className = 'panel compare-panel';
  panel.innerHTML = `
    <button type="button" class="compare-toggle" aria-pressed="false" title="Fire two setups side by side and scrub them together">Compare</button>
    <div class="compare-b" hidden>
      <span class="field-label">B (right)</span>
      <select class="compare-bullet" aria-label="Shot B round"></select>
      <select class="compare-target" aria-label="Shot B target"></select>
    </div>
  `;
  root.append(panel);

  const toggle = panel.querySelector<HTMLButtonElement>('.compare-toggle')!;
  const fields = panel.querySelector<HTMLElement>('.compare-b')!;
  const bulletSelect = panel.querySelector<HTMLSelectElement>('.compare-bullet')!;
  const targetSelect = panel.querySelector<HTMLSelectElement>('.compare-target')!;

  // Shot B picks from the same simulator as shot A; missiles are every airframe with every warhead.
  const rounds = initial.mode === 'missile' ? MISSILES : roundsForMode(initial.mode ?? 'bullet');
  for (const b of rounds) bulletSelect.append(new Option(`${b.name} ${b.type}`, b.id));
  const materials = document.createElement('optgroup');
  materials.label = 'Materials';
  for (const m of MEDIA.filter((m) => mediumListedIn(m, initial.mode ?? 'bullet'))) materials.append(new Option(m.name, `medium:${m.id}`));
  const stacks = document.createElement('optgroup');
  stacks.label = 'Layered targets';
  for (const p of STACK_PRESETS.filter((p) => presetListedIn(p, initial.mode ?? 'bullet'))) stacks.append(new Option(p.name, `preset:${p.id}`));
  targetSelect.append(materials, stacks);
  bulletSelect.value = initial.bulletId;
  targetSelect.value = `medium:${initial.mediumId}`;

  const state = {
    on: false,
    spec: getBullet(initial.bulletId),
    setup: setupFor(targetSelect.value),
  };
  // Shot B starts on the same thickness as shot A when the mode starts on a particular one (#245).
  if (initial.thicknessM !== undefined) state.setup.layers[0].thickness = initial.thicknessM;

  toggle.addEventListener('click', () => {
    state.on = !state.on;
    toggle.classList.toggle('active', state.on);
    toggle.setAttribute('aria-pressed', String(state.on));
    fields.hidden = !state.on;
    options.onToggle(state.on);
  });
  bulletSelect.addEventListener('change', () => {
    state.spec = getBullet(bulletSelect.value);
    options.onChange(state.spec, state.setup);
  });
  targetSelect.addEventListener('change', () => {
    state.setup = setupFor(targetSelect.value);
    options.onChange(state.spec, state.setup);
  });
  return state;
}

function setupFor(value: string): TargetSetup {
  const [kind, id] = value.split(':');
  if (kind === 'preset') return { layers: presetLayers(STACK_PRESETS.find((p) => p.id === id)!), angleDeg: 0 };
  const medium = getMedium(id);
  return { layers: [{ medium, thickness: medium.thickness.default, gapM: 0 }], angleDeg: 0 };
}

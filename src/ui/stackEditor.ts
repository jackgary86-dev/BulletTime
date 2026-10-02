import { MAX_IMPACT_ANGLE_DEG, MEDIA, getMedium } from '../data/media';
import { MAX_GAP_M, MAX_STACK_LAYERS, STACK_PRESETS, presetLayers, type StackLayer } from '../data/stacks';

export interface TargetSetup {
  /** Front to back along the shot line. */
  layers: StackLayer[];
  /** Impact angle in degrees from head-on, for the whole stack (0 unless every layer allows it). */
  angleDeg: number;
}

export interface StackEditorOptions {
  initialId: string;
  onChange(setup: TargetSetup): void;
}

/**
 * The target panel (#24): a stack of up to four layers, front to back. Pick a
 * layer to edit its medium, thickness and the air gap in front of it; add,
 * remove or reorder layers; or start from a barrier-test preset.
 */
export function mountStackEditor(root: HTMLElement, options: StackEditorOptions): TargetSetup {
  const panel = document.createElement('section');
  panel.className = 'panel medium-panel';
  panel.innerHTML = `
    <label class="field-label" for="preset-select">Target</label>
    <select id="preset-select"><option value="">Single material</option></select>
    <div class="stack-chips" role="tablist" aria-label="Layers, front to back"></div>
    <select id="medium-select" aria-label="Layer material"></select>
    <label class="field-label" for="thickness-slider">Thickness <output class="thickness-value"></output></label>
    <input id="thickness-slider" type="range" />
    <div class="gap-row">
      <label class="field-label" for="gap-slider">Air gap in front <output class="gap-value"></output></label>
      <input id="gap-slider" type="range" min="0" max="${MAX_GAP_M}" step="0.005" />
    </div>
    <div class="layer-actions">
      <button type="button" class="move-front" title="Move this layer toward the shooter">◀ Front</button>
      <button type="button" class="move-back" title="Move this layer away from the shooter">Back ▶</button>
      <button type="button" class="remove-layer">Remove</button>
    </div>
    <label class="field-label angle-label" for="angle-slider">Impact angle <output class="angle-value"></output></label>
    <input id="angle-slider" type="range" min="0" max="${MAX_IMPACT_ANGLE_DEG}" step="1" value="0" />
    <p class="medium-description"></p>
  `;
  root.append(panel);

  const q = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
  const preset = q<HTMLSelectElement>('#preset-select');
  const chips = q<HTMLDivElement>('.stack-chips');
  const select = q<HTMLSelectElement>('#medium-select');
  const thicknessSlider = q<HTMLInputElement>('#thickness-slider');
  const gapSlider = q<HTMLInputElement>('#gap-slider');
  const angleSlider = q<HTMLInputElement>('#angle-slider');

  for (const p of STACK_PRESETS) preset.append(new Option(p.name, p.id));
  for (const medium of MEDIA) select.append(new Option(medium.name, medium.id));

  const initial = getMedium(options.initialId);
  const setup: TargetSetup = { layers: [{ medium: initial, thickness: initial.thickness.default, gapM: 0 }], angleDeg: 0 };
  let selected = 0;

  const angleAllowed = () => setup.layers.every((l) => l.medium.angleAdjustable);
  const changed = () => {
    render();
    options.onChange(setup);
  };

  function render() {
    const layer = setup.layers[selected];
    chips.innerHTML = '';
    setup.layers.forEach((l, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `chip${i === selected ? ' active' : ''}`;
      chip.textContent = `${i + 1} · ${shortName(l.medium.name)}`;
      chip.addEventListener('click', () => {
        selected = i;
        render();
      });
      chips.append(chip);
    });
    if (setup.layers.length < MAX_STACK_LAYERS) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'chip add';
      add.textContent = '+';
      add.title = 'Add a layer behind the last one';
      add.addEventListener('click', () => {
        const medium = getMedium('gel10');
        setup.layers.push({ medium, thickness: medium.thickness.default, gapM: 0.1 });
        selected = setup.layers.length - 1;
        preset.value = '';
        changed();
      });
      chips.append(add);
    }

    select.value = layer.medium.id;
    const { min, max } = layer.medium.thickness;
    thicknessSlider.min = String(min);
    thicknessSlider.max = String(max);
    thicknessSlider.step = String((max - min) / 200);
    thicknessSlider.value = String(layer.thickness);
    q('.thickness-value').textContent = formatLength(layer.thickness);
    q('.gap-row').hidden = selected === 0;
    gapSlider.value = String(layer.gapM);
    q('.gap-value').textContent = formatLength(layer.gapM);
    q('.layer-actions').hidden = setup.layers.length < 2;
    q<HTMLButtonElement>('.move-front').disabled = selected === 0;
    q<HTMLButtonElement>('.move-back').disabled = selected === setup.layers.length - 1;

    const allowed = angleAllowed();
    if (!allowed) setup.angleDeg = 0;
    angleSlider.disabled = !allowed;
    angleSlider.value = String(setup.angleDeg);
    q('.angle-label').classList.toggle('disabled', !allowed);
    q('.angle-value').textContent = allowed ? `${setup.angleDeg}°` : 'n/a';
    q('.medium-description').textContent = layer.medium.description;
    // A stack's table of layers needs the room; single materials keep their description.
    q('.medium-description').hidden = setup.layers.length > 1;
  }

  preset.addEventListener('change', () => {
    const p = STACK_PRESETS.find((x) => x.id === preset.value);
    setup.layers = p ? presetLayers(p) : [{ ...setup.layers[selected], gapM: 0 }];
    selected = 0;
    changed();
  });
  select.addEventListener('change', () => {
    const medium = getMedium(select.value);
    setup.layers[selected] = { ...setup.layers[selected], medium, thickness: medium.thickness.default };
    changed();
  });
  thicknessSlider.addEventListener('input', () => {
    setup.layers[selected].thickness = Number(thicknessSlider.value);
    changed();
  });
  gapSlider.addEventListener('input', () => {
    setup.layers[selected].gapM = Number(gapSlider.value);
    changed();
  });
  angleSlider.addEventListener('input', () => {
    setup.angleDeg = Number(angleSlider.value);
    changed();
  });
  const move = (by: number) => {
    const to = selected + by;
    const layers = setup.layers;
    [layers[selected], layers[to]] = [layers[to], layers[selected]];
    // The front layer never has a gap in front of it.
    if (layers[0].gapM !== 0) {
      const gap = layers[0].gapM;
      layers[0].gapM = 0;
      if (layers[1]) layers[1].gapM = layers[1].gapM || gap;
    }
    selected = to;
    preset.value = '';
    changed();
  };
  q('.move-front').addEventListener('click', () => move(-1));
  q('.move-back').addEventListener('click', () => move(1));
  q('.remove-layer').addEventListener('click', () => {
    setup.layers.splice(selected, 1);
    setup.layers[0].gapM = 0;
    selected = Math.min(selected, setup.layers.length - 1);
    preset.value = '';
    changed();
  });

  render();
  return setup;
}

function shortName(name: string): string {
  return name.replace(/\s*\(.*\)$/, '').replace('Ballistic gelatin', 'Gel');
}

function formatLength(metres: number): string {
  return metres < 0.03 ? `${(metres * 1000).toFixed(1)} mm` : `${(metres * 100).toFixed(1)} cm`;
}

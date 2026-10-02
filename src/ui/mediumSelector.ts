import { MAX_IMPACT_ANGLE_DEG, MEDIA, getMedium, type MediumSpec } from '../data/media';

export interface TargetSetup {
  medium: MediumSpec;
  /** Thickness along the shot line, in metres. */
  thickness: number;
  /** Impact angle in degrees from head-on (0 when the medium doesn't support it). */
  angleDeg: number;
}

export interface MediumSelectorOptions {
  initialId: string;
  onChange(setup: TargetSetup): void;
}

/** The target picker: medium dropdown, thickness slider and impact-angle slider. */
export function mountMediumSelector(root: HTMLElement, options: MediumSelectorOptions): TargetSetup {
  const panel = document.createElement('section');
  panel.className = 'panel medium-panel';
  panel.innerHTML = `
    <label class="field-label" for="medium-select">Target</label>
    <select id="medium-select"></select>
    <label class="field-label" for="thickness-slider">Thickness <output class="thickness-value"></output></label>
    <input id="thickness-slider" type="range" />
    <label class="field-label angle-label" for="angle-slider">Impact angle <output class="angle-value"></output></label>
    <input id="angle-slider" type="range" min="0" max="${MAX_IMPACT_ANGLE_DEG}" step="1" value="0" />
    <p class="medium-description"></p>
  `;
  root.append(panel);

  const select = panel.querySelector<HTMLSelectElement>('#medium-select')!;
  const thicknessSlider = panel.querySelector<HTMLInputElement>('#thickness-slider')!;
  const thicknessValue = panel.querySelector<HTMLOutputElement>('.thickness-value')!;
  const angleSlider = panel.querySelector<HTMLInputElement>('#angle-slider')!;
  const angleValue = panel.querySelector<HTMLOutputElement>('.angle-value')!;
  const angleLabel = panel.querySelector<HTMLLabelElement>('.angle-label')!;
  const description = panel.querySelector<HTMLParagraphElement>('.medium-description')!;

  for (const medium of MEDIA) {
    const option = document.createElement('option');
    option.value = medium.id;
    option.textContent = medium.name;
    select.append(option);
  }

  const setup: TargetSetup = { medium: getMedium(options.initialId), thickness: 0, angleDeg: 0 };

  const readSliders = () => {
    setup.thickness = Number(thicknessSlider.value);
    setup.angleDeg = setup.medium.angleAdjustable ? Number(angleSlider.value) : 0;
    thicknessValue.textContent = formatLength(setup.thickness);
    angleValue.textContent = setup.medium.angleAdjustable ? `${setup.angleDeg}°` : 'n/a';
  };

  const selectMedium = (medium: MediumSpec) => {
    setup.medium = medium;
    const { min, max, default: initial } = medium.thickness;
    thicknessSlider.min = String(min);
    thicknessSlider.max = String(max);
    // About 200 slider positions across the range, whatever its scale.
    thicknessSlider.step = String((max - min) / 200);
    thicknessSlider.value = String(initial);
    angleSlider.disabled = !medium.angleAdjustable;
    angleLabel.classList.toggle('disabled', !medium.angleAdjustable);
    description.textContent = medium.description;
    readSliders();
  };

  select.addEventListener('change', () => {
    selectMedium(getMedium(select.value));
    options.onChange(setup);
  });
  for (const slider of [thicknessSlider, angleSlider]) {
    slider.addEventListener('input', () => {
      readSliders();
      options.onChange(setup);
    });
  }

  select.value = options.initialId;
  selectMedium(setup.medium);
  return setup;
}

function formatLength(metres: number): string {
  return metres < 0.03 ? `${(metres * 1000).toFixed(1)} mm` : `${(metres * 100).toFixed(1)} cm`;
}

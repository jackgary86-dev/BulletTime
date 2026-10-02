import { CAMERA_MODES, type CameraMode } from '../scene/cameraDirector';
import { qualityLevels, type QualityLevel } from '../scene/quality';
import type { LightingMode } from '../scene/studio';
import { formatTime } from './format';
import { CAMERA_ICONS, LIGHTING_ICONS } from './icons';

/** Slow-motion presets, as simulated seconds per real second. */
export const RATE_PRESETS = [
  { label: '1×', rate: 1 },
  { label: '1/100', rate: 1 / 100 },
  { label: '1/1,000', rate: 1 / 1000 },
  { label: '1/10,000', rate: 1 / 10_000 },
  { label: '1/100,000', rate: 1 / 100_000 },
] as const;

const MIN_EXPONENT = -5; // 1/100,000×

export interface ControlsPanel {
  /** Updates the live readout of simulated time and bullet speed. */
  setReadout(timeS: number, speed: number): void;
  /** Highlights the active camera preset (e.g. after a drag switches to orbit). */
  setCameraMode(mode: CameraMode): void;
  /** Enables Replay once there is a shot to replay. */
  setHasShot(hasShot: boolean): void;
}

export interface ControlsOptions {
  initialRate: number;
  initialCamera: CameraMode;
  initialQuality: QualityLevel;
  onFire(): void;
  onReplay(): void;
  onReset(): void;
  onRateChange(rate: number): void;
  onCameraChange(mode: CameraMode): void;
  onLightingChange(mode: LightingMode): void;
  onQualityChange(level: QualityLevel): void;
}

/**
 * The shot panel: Fire, Replay and Reset, camera presets, slow-motion presets,
 * a logarithmic rate slider and a small readout of simulated time and speed.
 */
export function mountControls(root: HTMLElement, options: ControlsOptions): ControlsPanel {
  const panel = document.createElement('section');
  panel.className = 'panel controls';
  panel.innerHTML = `
    <button class="fire" type="button">Fire</button>
    <div class="shot-actions">
      <button type="button" class="replay" disabled>Replay</button>
      <button type="button" class="reset">Reset</button>
    </div>
    <span class="field-label">Camera</span>
    <div class="camera-modes" role="group" aria-label="Camera presets"></div>
    <div class="view-options">
      <div>
        <span class="field-label">Lighting</span>
        <div class="lighting-modes" role="group" aria-label="Lighting">
          <button type="button" class="active" data-mode="lab">${LIGHTING_ICONS.lab}<span>Lab</span></button>
          <button type="button" data-mode="highspeed">${LIGHTING_ICONS.highspeed}<span>High-speed</span></button>
        </div>
      </div>
      <div>
        <label class="field-label" for="quality-select">Quality</label>
        <select id="quality-select" title="Lower quality uses fewer particles, no glow and no shadows, for smoother playback">
          ${qualityLevels().map(({ level, label }) => `<option value="${level}">${label}</option>`).join('')}
        </select>
      </div>
    </div>
    <label class="field-label" for="rate-slider">Slow motion <output class="rate-value"></output></label>
    <div class="presets" role="group" aria-label="Slow-motion presets"></div>
    <input id="rate-slider" type="range" min="${MIN_EXPONENT}" max="0" step="0.01" />
    <dl class="readout">
      <div><dt>Sim time</dt><dd class="readout-time">0 µs</dd></div>
      <div><dt>Velocity</dt><dd class="readout-speed">0 m/s</dd></div>
    </dl>
  `;
  root.append(panel);

  const fire = panel.querySelector<HTMLButtonElement>('.fire')!;
  const slider = panel.querySelector<HTMLInputElement>('#rate-slider')!;
  const rateValue = panel.querySelector<HTMLOutputElement>('.rate-value')!;
  const presets = panel.querySelector<HTMLDivElement>('.presets')!;
  const timeOut = panel.querySelector<HTMLElement>('.readout-time')!;
  const speedOut = panel.querySelector<HTMLElement>('.readout-speed')!;

  const replay = panel.querySelector<HTMLButtonElement>('.replay')!;
  replay.addEventListener('click', () => options.onReplay());
  panel.querySelector('.reset')!.addEventListener('click', () => options.onReset());

  const cameraRow = panel.querySelector<HTMLDivElement>('.camera-modes')!;
  const cameraButtons = CAMERA_MODES.map(({ mode, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `${CAMERA_ICONS[mode]}<span>${label}</span>`;
    button.addEventListener('click', () => options.onCameraChange(mode));
    cameraRow.append(button);
    return { button, mode };
  });
  const setCameraMode = (mode: CameraMode) => {
    for (const b of cameraButtons) b.button.classList.toggle('active', b.mode === mode);
  };
  setCameraMode(options.initialCamera);

  const lightingButtons = [...panel.querySelectorAll<HTMLButtonElement>('.lighting-modes button')];
  for (const button of lightingButtons) {
    button.addEventListener('click', () => {
      for (const b of lightingButtons) b.classList.toggle('active', b === button);
      options.onLightingChange(button.dataset.mode as LightingMode);
    });
  }

  const quality = panel.querySelector<HTMLSelectElement>('#quality-select')!;
  quality.value = options.initialQuality;
  quality.addEventListener('change', () => options.onQualityChange(quality.value as QualityLevel));

  const presetButtons = RATE_PRESETS.map((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset.label;
    button.addEventListener('click', () => setRate(preset.rate));
    presets.append(button);
    return { button, rate: preset.rate };
  });

  function setRate(rate: number) {
    slider.value = String(Math.log10(rate));
    rateValue.textContent = formatRate(rate);
    for (const { button, rate: presetRate } of presetButtons) {
      button.classList.toggle('active', Math.abs(Math.log10(presetRate) - Math.log10(rate)) < 0.01);
    }
    options.onRateChange(rate);
  }

  slider.addEventListener('input', () => setRate(10 ** Number(slider.value)));
  fire.addEventListener('click', () => options.onFire());
  setRate(options.initialRate);

  return {
    setReadout(timeS, speed) {
      timeOut.textContent = formatTime(timeS);
      speedOut.textContent = `${speed.toFixed(0)} m/s`;
    },
    setCameraMode,
    setHasShot(hasShot) {
      replay.disabled = !hasShot;
    },
  };
}

function formatRate(rate: number): string {
  if (rate >= 0.999) return '1×';
  return `1/${Math.round(1 / rate).toLocaleString('en-US')}×`;
}

import { frameAt, type ArmorShot, type ArmorTimeline } from '../armor/model';
import { PLATE_MATERIALS, getPlateMaterial, DEFAULT_PLATE_MATERIAL_ID, type PlateMaterialId } from '../armor/materials';
import { MAX_CALIBRE_MM, MIN_CALIBRE_MM, MUNITION_FAMILIES, getFamily, impactState, type MunitionFamilyId } from '../armor/munitions';
import { OVERLAYS, drawSection, type OverlayId } from '../armor/sectionDraw';
import { sectionLayout, sectionShapes } from '../armor/section';
import { simulateArmor } from '../armor/simulate';
import { familyDiagram } from './armorDiagrams';

/**
 * The Armor lab screen (#168, #157): pick a munition family and calibre, a
 * plate material, thickness and angle, press Fire and watch the cut-away
 * cross-section play out, with the results and a short classroom explainer.
 * It is a teaching model of what happens at the plate, not of how anything is
 * built; the About note applies.
 */

const PLATE_MIN_MM = 10;
const PLATE_MAX_MM = 300;
const OBLIQUITY_MAX_DEG = 75;
/** How long a whole timeline takes to play at 1x, in real seconds. */
const PLAY_SECONDS = 8;
const SPEEDS = [
  { label: '1×', factor: 1 },
  { label: '¼×', factor: 0.25 },
  { label: '1/10×', factor: 0.1 },
];

export interface ArmorLabHandle {
  /** Fires the current setup and returns the timeline, or null when the family has no model yet. */
  fire(): ArmorTimeline | null;
  /** Sets the controls (any subset) and fires. */
  preset(p: ArmorPreset): ArmorTimeline | null;
  dispose(): void;
}

export interface ArmorPreset {
  family?: MunitionFamilyId;
  calibreMm?: number;
  velocity?: number;
  material?: PlateMaterialId;
  thicknessMm?: number;
  obliquityDeg?: number;
  overlay?: OverlayId;
}

const mm = (m: number) => `${(m * 1000).toFixed(m < 0.01 ? 1 : 0)} mm`;
const joules = (j: number) => (j >= 1e6 ? `${(j / 1e6).toFixed(2)} MJ` : j >= 1e3 ? `${(j / 1e3).toFixed(1)} kJ` : `${Math.round(j)} J`);
const kg = (m: number) => (m < 0.1 ? `${(m * 1000).toFixed(1)} g` : `${m.toFixed(2)} kg`);
const us = (s: number) => `${(s * 1e6).toFixed(s < 1e-4 ? 1 : 0)} µs`;

export function mountArmorLab(root: HTMLElement): ArmorLabHandle {
  const screen = document.createElement('div');
  screen.className = 'armor-lab';
  screen.innerHTML = `
    <header class="armor-head">
      <h1>BulletTime <span>Armor lab</span></h1>
      <p>A teaching cross-section of how munitions defeat metal plate. Simplified models, not engineering data.</p>
      <button type="button" class="armor-back">Simulators</button>
    </header>
    <section class="armor-controls panel">
      <label class="field-label" for="armor-family">Munition</label>
      <select id="armor-family"></select>
      <label class="field-label" for="armor-calibre">Calibre <output class="armor-calibre-out"></output></label>
      <input id="armor-calibre" type="range" min="${MIN_CALIBRE_MM}" max="${MAX_CALIBRE_MM}" step="1" />
      <label class="field-label" for="armor-velocity">Impact velocity <output class="armor-velocity-out"></output></label>
      <input id="armor-velocity" type="range" step="10" />
      <label class="field-label" for="armor-material">Plate</label>
      <select id="armor-material"></select>
      <label class="field-label" for="armor-thickness">Thickness <output class="armor-thickness-out"></output></label>
      <input id="armor-thickness" type="range" min="${PLATE_MIN_MM}" max="${PLATE_MAX_MM}" step="5" />
      <label class="field-label" for="armor-obliquity">Plate angle <output class="armor-obliquity-out"></output></label>
      <input id="armor-obliquity" type="range" min="0" max="${OBLIQUITY_MAX_DEG}" step="1" />
      <button type="button" class="armor-fire">Fire</button>
      <p class="armor-material-note"></p>
    </section>
    <section class="armor-stage">
      <div class="armor-hud"><span class="armor-hud-time"></span><span class="armor-hud-depth"></span><span class="armor-hud-speed"></span></div>
      <canvas class="armor-canvas" aria-label="Cut-away cross-section of the plate"></canvas>
      <p class="armor-caption" aria-live="polite"></p>
      <p class="armor-notice" hidden></p>
      <div class="armor-overlays" role="group" aria-label="Field overlay"></div>
      <div class="armor-playback">
        <button type="button" class="armor-play" aria-label="Play or pause">Pause</button>
        <input class="armor-scrub" type="range" min="0" max="1000" value="0" aria-label="Time" />
        <select class="armor-speed" aria-label="Playback speed"></select>
      </div>
    </section>
    <aside class="armor-side">
      <section class="panel armor-results"></section>
      <section class="panel armor-explainer"></section>
    </aside>
  `;
  root.append(screen);

  const q = <T extends HTMLElement>(sel: string) => screen.querySelector<T>(sel)!;
  const familySel = q<HTMLSelectElement>('#armor-family');
  const calibre = q<HTMLInputElement>('#armor-calibre');
  const velocity = q<HTMLInputElement>('#armor-velocity');
  const materialSel = q<HTMLSelectElement>('#armor-material');
  const thickness = q<HTMLInputElement>('#armor-thickness');
  const obliquity = q<HTMLInputElement>('#armor-obliquity');
  const canvas = q<HTMLCanvasElement>('.armor-canvas');
  const caption = q('.armor-caption');
  const notice = q('.armor-notice');
  const scrub = q<HTMLInputElement>('.armor-scrub');
  const playBtn = q<HTMLButtonElement>('.armor-play');
  const speedSel = q<HTMLSelectElement>('.armor-speed');
  const overlayBox = q('.armor-overlays');
  const resultsBox = q('.armor-results');
  const explainerBox = q('.armor-explainer');
  const ctx = canvas.getContext('2d')!;

  for (const f of MUNITION_FAMILIES) familySel.append(new Option(f.name, f.id));
  for (const m of PLATE_MATERIALS) materialSel.append(new Option(m.name, m.id));
  SPEEDS.forEach((s, i) => speedSel.append(new Option(s.label, String(i))));

  let overlay: OverlayId = 'energy';
  OVERLAYS.forEach((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = o.label;
    b.title = o.hint;
    b.dataset.overlay = o.id;
    b.disabled = !o.ready;
    b.addEventListener('click', () => {
      overlay = o.id;
      syncOverlays();
      redraw();
    });
    overlayBox.append(b);
  });
  const syncOverlays = () => overlayBox.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('active', b.dataset.overlay === overlay));

  let timeline: ArmorTimeline | null = null;
  let t = 0;
  let playing = true;
  let last = performance.now();
  let raf = 0;

  const syncControls = () => {
    const family = getFamily(familySel.value as MunitionFamilyId);
    velocity.min = String(family.velocity.min);
    velocity.max = String(family.velocity.max);
    if (!velocity.value || Number(velocity.value) < family.velocity.min || Number(velocity.value) > family.velocity.max) velocity.value = String(family.velocity.default);
    q('.armor-calibre-out').textContent = `${calibre.value} mm`;
    q('.armor-velocity-out').textContent = `${velocity.value} m/s`;
    q('.armor-thickness-out').textContent = `${thickness.value} mm`;
    q('.armor-obliquity-out').textContent = `${obliquity.value}°`;
    q('.armor-material-note').textContent = getPlateMaterial(materialSel.value as PlateMaterialId).description;
    explainerBox.innerHTML = `<h2>${family.name}</h2><p>${family.explainer}</p>${familyDiagram(family.id)}`;
  };

  const shot = (): ArmorShot => ({
    impact: impactState(familySel.value as MunitionFamilyId, Number(calibre.value), Number(velocity.value)),
    material: getPlateMaterial(materialSel.value as PlateMaterialId),
    thicknessM: Number(thickness.value) / 1000,
    obliquityDeg: Number(obliquity.value),
  });

  const fire = (): ArmorTimeline | null => {
    try {
      timeline = simulateArmor(shot());
      notice.hidden = true;
    } catch (e) {
      timeline = null;
      notice.hidden = false;
      notice.textContent = `${e instanceof Error ? e.message : String(e)}. Pick another munition for now.`;
    }
    t = 0;
    playing = true;
    renderResults();
    redraw();
    return timeline;
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(10, Math.round(rect.width * dpr));
    canvas.height = Math.max(10, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  };

  const redraw = () => {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.width;
    const h = rect.height || canvas.height;
    playBtn.textContent = playing ? 'Pause' : t >= (timeline?.duration ?? 0) ? 'Replay' : 'Play';
    if (!timeline) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    const frame = frameAt(timeline, t);
    const layout = sectionLayout(timeline, w, h);
    const shapes = sectionShapes(timeline, frame, layout);
    const impact = timeline.shot.impact;
    drawSection(ctx, shapes, { plateColor: timeline.shot.material.color, penetratorMaterial: impact.material, overlay, jet: impact.family === 'heat' });
    q('.armor-hud-time').textContent = `t = ${us(t)}`;
    q('.armor-hud-depth').textContent = `depth ${mm(frame.depth)} of ${mm(timeline.result.losThicknessM)}`;
    q('.armor-hud-speed').textContent = `${Math.round(frame.speed)} m/s`;
    scrub.value = String(Math.round((t / timeline.duration) * 1000));
    const reached = timeline.events.filter((e) => e.t <= t);
    caption.textContent = reached.length ? reached[reached.length - 1].label : '';
    resultsBox.querySelectorAll<HTMLElement>('[data-event]').forEach((li) => li.classList.toggle('reached', Number(li.dataset.event) <= t));
  };

  const renderResults = () => {
    if (!timeline) {
      resultsBox.innerHTML = '<h2>Results</h2><p>No model for this munition yet.</p>';
      return;
    }
    const r = timeline.result;
    const rows: [string, string][] = [
      ['Mechanism', r.mechanism],
      ['Outcome', r.perforated ? 'Perforated' : 'Stopped'],
      ['Penetration', `${mm(r.penetrationM)} of ${mm(r.losThicknessM)} line-of-sight`],
      ['Residual velocity', r.perforated ? `${Math.round(r.residualVelocity)} m/s` : '—'],
      ['Residual mass', r.perforated ? kg(r.residualMassKg) : '—'],
      ['Impact energy', joules(r.impactEnergyJ)],
      ['Absorbed by the plate', joules(r.energy.plateWorkJ)],
      ['In ejected metal', joules(r.energy.ejectaJ)],
      ['Carried through', joules(r.residualEnergyJ)],
    ];
    if (r.shattered) rows.push(['Penetrator', `Shattered into ${r.fragments} pieces`]);
    if (r.plug) rows.push(['Plug', `${kg(r.plug.massKg)} at ${Math.round(r.plug.velocity)} m/s`]);
    const debris = (r as unknown as { debris?: { halfAngleDeg: number } }).debris;
    if (debris) rows.push(['Debris behind the plate', `a cone of ${debris.halfAngleDeg.toFixed(0)}° half-angle`]);
    if ((r as unknown as { failedToFuze?: boolean }).failedToFuze) rows.push(['Fuzing', 'Too oblique: skidded off']);
    resultsBox.innerHTML = `
      <h2>Results</h2>
      <dl class="readout">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <h3>What happened</h3>
      <ol class="armor-events">${timeline.events.map((e) => `<li data-event="${e.t}"><time>${us(e.t)}</time> ${e.label}</li>`).join('')}</ol>`;
  };

  const step = (now: number) => {
    raf = requestAnimationFrame(step);
    const dt = (now - last) / 1000;
    last = now;
    if (!playing || !timeline) return;
    const factor = SPEEDS[Number(speedSel.value)].factor;
    t += (dt * factor * timeline.duration) / PLAY_SECONDS;
    if (t >= timeline.duration) {
      t = timeline.duration;
      playing = false;
    }
    redraw();
  };

  const onInput = () => {
    syncControls();
  };
  for (const el of [calibre, velocity, thickness, obliquity, materialSel]) el.addEventListener('input', onInput);
  familySel.addEventListener('input', () => {
    velocity.value = '';
    syncControls();
  });
  q('.armor-fire').addEventListener('click', fire);
  playBtn.addEventListener('click', () => {
    if (!timeline) return;
    if (t >= timeline.duration) t = 0;
    playing = !playing;
    redraw();
  });
  scrub.addEventListener('input', () => {
    if (!timeline) return;
    playing = false;
    t = (Number(scrub.value) / 1000) * timeline.duration;
    redraw();
  });
  q('.armor-back').addEventListener('click', () => location.assign(location.pathname));
  window.addEventListener('resize', resize);

  calibre.value = '120';
  thickness.value = '120';
  obliquity.value = '0';
  familySel.value = 'apfsds';
  materialSel.value = DEFAULT_PLATE_MATERIAL_ID;
  syncControls();
  syncOverlays();
  resize();
  fire();
  raf = requestAnimationFrame(step);

  return {
    fire,
    preset(p) {
      if (p.family) familySel.value = p.family;
      if (p.family) velocity.value = '';
      if (p.calibreMm !== undefined) calibre.value = String(p.calibreMm);
      if (p.velocity !== undefined) velocity.value = String(p.velocity);
      if (p.material) materialSel.value = p.material;
      if (p.thicknessMm !== undefined) thickness.value = String(p.thicknessMm);
      if (p.obliquityDeg !== undefined) obliquity.value = String(p.obliquityDeg);
      if (p.overlay) {
        overlay = p.overlay;
        syncOverlays();
      }
      syncControls();
      return fire();
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      screen.remove();
    },
  };
}

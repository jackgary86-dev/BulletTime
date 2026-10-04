import type { ArmorTimeline } from '../armor/model';
import { PLATE_MATERIALS, getPlateMaterial, DEFAULT_PLATE_MATERIAL_ID, type PlateMaterialId } from '../armor/materials';
import { MAX_CALIBRE_MM, MIN_CALIBRE_MM, MUNITION_FAMILIES, getFamily, impactState, type MunitionFamilyId } from '../armor/munitions';
import { OVERLAYS, drawSection, type OverlayId } from '../armor/sectionDraw';
import { dimensionLine, fragmentShapes, roomShapes } from '../armor/section';
import { MAX_LAYERS, STACK_PRESETS, simulateStack, type PlateLayer, type StackTimeline } from '../armor/stack';
import { activeStage, extendedFrame, stackDimensions, stackLayout, stackShapes } from '../armor/stackView';
import { mountView3d, type View3d } from '../armor/view3d';
import { playbackAt } from '../armor/playback';
import { energyBalance } from '../armor/fields';
import { buildOverlay, niceScaleLength, scaleLabel } from '../armor/fieldOverlay';
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
const OBLIQUITY_MAX_DEG = 85;
/** How long a whole timeline takes to play at 1x, in real seconds. */
const PLAY_SECONDS = 8;
/** A timeline with an aftermath (thrown pieces coming to rest) plays this much longer. */
const AFTERMATH_PLAY_FACTOR = 1.6;
const SPEEDS = [
  { label: '1×', factor: 1 },
  { label: '¼×', factor: 0.25 },
  { label: '1/10×', factor: 0.1 },
];

export interface ArmorLabHandle {
  /** Fires the current setup and returns the first plate's timeline, or null when the family has no model yet. */
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
  /** A stack arrangement by id (`STACK_PRESETS`), applied to the plate controls before firing. */
  arrangement?: string;
}

const mm = (m: number) => `${(m * 1000).toFixed(m < 0.01 ? 1 : 0)} mm`;
const joules = (j: number) => (j >= 1e6 ? `${(j / 1e6).toFixed(2)} MJ` : j >= 1e3 ? `${(j / 1e3).toFixed(1)} kJ` : `${Math.round(j)} J`);
const kg = (m: number) => (m < 0.1 ? `${(m * 1000).toFixed(1)} g` : `${m.toFixed(2)} kg`);
const us = (s: number) => `${(s * 1e6).toFixed(s < 1e-4 ? 1 : 0)} µs`;
const clock = (s: number) => (s < 1e-3 ? us(s) : s < 1 ? `${(s * 1e3).toFixed(s < 1e-2 ? 2 : 1)} ms` : `${s.toFixed(2)} s`);

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
      <label class="field-label" for="armor-material">Plate 1 (front)</label>
      <select id="armor-material"></select>
      <label class="field-label" for="armor-thickness">Thickness <output class="armor-thickness-out"></output></label>
      <input id="armor-thickness" type="range" min="${PLATE_MIN_MM}" max="${PLATE_MAX_MM}" step="5" />
      <label class="field-label" for="armor-obliquity">Plate angle <output class="armor-obliquity-out"></output></label>
      <input id="armor-obliquity" type="range" min="0" max="${OBLIQUITY_MAX_DEG}" step="1" />
      <label class="field-label" for="armor-arrangement">Arrangement</label>
      <select id="armor-arrangement"></select>
      <div class="armor-layers"></div>
      <button type="button" class="armor-add-plate">Add a plate behind</button>
      <p class="armor-arrangement-note"></p>
      <button type="button" class="armor-fire">Fire</button>
      <p class="armor-material-note"></p>
    </section>
    <section class="armor-stage">
      <div class="armor-hud"><span class="armor-hud-time"></span><span class="armor-hud-depth"></span><span class="armor-hud-speed"></span></div>
      <canvas class="armor-canvas" aria-label="Cut-away cross-section of the plate"></canvas>
      <canvas class="armor-canvas-3d" aria-label="Sectioned plate on the test bench" hidden></canvas>
      <div class="armor-view" role="group" aria-label="View">
        <button type="button" data-view="2d" class="active">2D section</button>
        <button type="button" data-view="3d">3D view</button>
      </div>
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
  const arrangementSel = q<HTMLSelectElement>('#armor-arrangement');
  const layersBox = q('.armor-layers');
  const addPlate = q<HTMLButtonElement>('.armor-add-plate');
  const obliquity = q<HTMLInputElement>('#armor-obliquity');
  const canvas = q<HTMLCanvasElement>('.armor-canvas');
  const canvas3d = q<HTMLCanvasElement>('.armor-canvas-3d');
  const viewBox = q('.armor-view');
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
  for (const p of STACK_PRESETS) arrangementSel.append(new Option(p.name, p.id));
  arrangementSel.append(new Option('Custom', 'custom'));

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

  let stack: StackTimeline | null = null;
  /** The 2D section or the 3D bench (#172); both play the same clock. The 3D view is built the first time it is shown. */
  let view: '2d' | '3d' = '2d';
  let view3d: View3d | null = null;
  const syncView = () => {
    viewBox.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    canvas.hidden = view === '3d';
    canvas3d.hidden = view === '2d';
    if (view === '3d') {
      if (!view3d) {
        try {
          view3d = mountView3d(canvas3d);
          view3d.setStack(stack);
        } catch (e) {
          // No WebGL: stay on the section.
          view = '2d';
          notice.hidden = false;
          notice.textContent = `The 3D view needs WebGL (${e instanceof Error ? e.message : String(e)}).`;
          syncView();
          return;
        }
      }
      view3d.resize();
    }
    redraw();
  };
  viewBox.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.view as '2d' | '3d';
      syncView();
    }),
  );
  /** Plates 2 to 4: the rows under the front plate's controls. */
  interface LayerRow {
    materialId: PlateMaterialId;
    thicknessMm: number;
    gapMm: number;
  }
  let rows: LayerRow[] = [];
  /** The front plate as the user set it, for the presets that build round it. */
  let mainRef = { materialId: DEFAULT_PLATE_MATERIAL_ID as PlateMaterialId, thicknessMm: 120 };
  /** Playhead, 0 to 1 (see `playbackAt`). */
  let u = 0;
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

  const layers = (): PlateLayer[] => [
    { material: getPlateMaterial(materialSel.value as PlateMaterialId), thicknessM: Number(thickness.value) / 1000, gapBeforeM: 0 },
    ...rows.map((r) => ({ material: getPlateMaterial(r.materialId), thicknessM: r.thicknessMm / 1000, gapBeforeM: r.gapMm / 1000 })),
  ];

  const syncArrangementNote = () => {
    const preset = STACK_PRESETS.find((p) => p.id === arrangementSel.value);
    q('.armor-arrangement-note').textContent = preset ? preset.description : 'Your own stack: up to four plates, each with its own material, thickness and the air gap in front of it.';
    addPlate.disabled = rows.length + 1 >= MAX_LAYERS;
  };

  const renderRows = () => {
    layersBox.innerHTML = '';
    rows.forEach((row, i) => {
      const el = document.createElement('div');
      el.className = 'armor-layer';
      el.innerHTML = `
        <span class="armor-layer-title">Plate ${i + 2}</span>
        <label>Gap <input type="number" class="armor-layer-gap" min="0" max="1500" step="10" value="${row.gapMm}" /> mm</label>
        <select class="armor-layer-material" aria-label="Plate ${i + 2} material"></select>
        <label>Thickness <input type="number" class="armor-layer-thickness" min="${PLATE_MIN_MM}" max="${PLATE_MAX_MM}" step="5" value="${row.thicknessMm}" /> mm</label>
        <button type="button" class="armor-layer-remove" aria-label="Remove plate ${i + 2}">Remove</button>`;
      const sel = el.querySelector<HTMLSelectElement>('.armor-layer-material')!;
      for (const m of PLATE_MATERIALS) sel.append(new Option(m.name, m.id));
      sel.value = row.materialId;
      const clampNum = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Number(v) || 0));
      sel.addEventListener('input', () => {
        row.materialId = sel.value as PlateMaterialId;
        custom();
      });
      el.querySelector('.armor-layer-gap')!.addEventListener('input', (e) => {
        row.gapMm = clampNum((e.target as HTMLInputElement).value, 0, 1500);
        custom();
      });
      el.querySelector('.armor-layer-thickness')!.addEventListener('input', (e) => {
        row.thicknessMm = clampNum((e.target as HTMLInputElement).value, PLATE_MIN_MM, PLATE_MAX_MM);
        custom();
      });
      el.querySelector('.armor-layer-remove')!.addEventListener('click', () => {
        rows.splice(i, 1);
        renderRows();
        custom();
      });
      layersBox.append(el);
    });
    syncArrangementNote();
  };

  /** The user changed a plate by hand: the arrangement is now their own. */
  const custom = () => {
    arrangementSel.value = rows.length === 0 ? 'single' : 'custom';
    if (rows.length === 0) mainRef = { materialId: materialSel.value as PlateMaterialId, thicknessMm: Number(thickness.value) };
    syncArrangementNote();
  };

  const applyArrangement = (id: string) => {
    const preset = STACK_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const built = preset.build(getPlateMaterial(mainRef.materialId), mainRef.thicknessMm / 1000, {
      spaced: getPlateMaterial('mild-steel'),
      soft: getPlateMaterial('mild-steel'),
      hard: getPlateMaterial('rha'),
    });
    materialSel.value = built[0].material.id;
    thickness.value = String(Math.round(built[0].thicknessM * 1000));
    rows = built.slice(1).map((l) => ({ materialId: l.material.id, thicknessMm: Math.round(l.thicknessM * 1000), gapMm: Math.round(l.gapBeforeM * 1000) }));
    arrangementSel.value = id;
    renderRows();
    syncControls();
  };

  const fire = (): ArmorTimeline | null => {
    try {
      stack = simulateStack({
        impact: impactState(familySel.value as MunitionFamilyId, Number(calibre.value), Number(velocity.value)),
        layers: layers(),
        obliquityDeg: Number(obliquity.value),
      });
      notice.hidden = true;
    } catch (e) {
      stack = null;
      notice.hidden = false;
      notice.textContent = `${e instanceof Error ? e.message : String(e)}. Pick another munition for now.`;
    }
    u = 0;
    playing = true;
    view3d?.setStack(stack);
    renderResults();
    redraw();
    return stack ? stack.stages[0].timeline : null;
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(10, Math.round(rect.width * dpr));
    canvas.height = Math.max(10, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view3d?.resize();
    redraw();
  };

  const scaleBar = (pxPerM: number) => {
    const length = niceScaleLength(pxPerM, 140);
    return { px: length * pxPerM, label: scaleLabel(length) };
  };

  const redraw = () => {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.width;
    const h = rect.height || canvas.height;
    playBtn.textContent = playing ? 'Pause' : u >= 1 ? 'Replay' : 'Play';
    if (!stack) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    const pb = playbackAt(stack, u);
    if (view === '3d' && view3d) {
      view3d.render(pb.t, pb.fragmentT, overlay);
      syncHud(pb);
      return;
    }
    const layout = stackLayout(stack, w, h);
    const parts = stackShapes(stack, pb.t, pb.fragmentT, layout);
    const multi = stack.stages.length > 1;
    const lastIdx = stack.stages.length - 1;
    const dims = multi ? stackDimensions(stack, layout) : undefined;
    const fieldOverlay = overlay === 'temperature' || overlay === 'stress' || overlay === 'pressure' ? overlay : null;
    stack.stages.forEach((st, i) => {
      const stageLayout = layout.stages[i];
      const localFragmentT = pb.fragmentT - st.offsetT;
      const impact = st.shot.impact;
      let room = i === stack!.fragmentStage ? roomShapes(st.timeline, stageLayout) : null;
      // The left box of a later plate is the gap in front of it: keep its wall off the plate before.
      if (room && i > 0) room = { ...room, leftX: Math.max(room.leftX, layout.stages[i - 1].rearX) };
      drawSection(
        ctx,
        parts[i].shapes,
        { plateColor: st.layer.material.color, penetratorMaterial: impact.material, overlay, jet: impact.family === 'heat', continued: i > 0 },
        {
          dimension: multi ? undefined : dimensionLine(st.timeline, stageLayout),
          dimensions: i === lastIdx ? dims : undefined,
          room,
          fragments: i === stack!.fragmentStage ? fragmentShapes(st.timeline, localFragmentT, stageLayout) : [],
          field: fieldOverlay ? buildOverlay(st.timeline, Math.max(0, localFragmentT), fieldOverlay, stageLayout) : null,
          legend: i === lastIdx,
          energy: !multi ? energyBalance(st.timeline, pb.fragmentT) : null,
          scaleBar: i === lastIdx ? scaleBar(layout.pxPerM) : null,
        },
      );
    });
    syncHud(pb);
  };

  /** The time, depth and speed readouts, the caption and the event list, for either view. */
  const syncHud = (pb: ReturnType<typeof playbackAt>) => {
    if (!stack) return;
    const active = activeStage(stack, pb.t);
    const stage = stack.stages[active];
    const frame = extendedFrame(stage, pb.t - stage.offsetT);
    const platePrefix = stack.stages.length > 1 ? `plate ${active + 1}: ` : '';
    q('.armor-hud-time').textContent = `t = ${clock(pb.fragmentT)}`;
    q('.armor-hud-depth').textContent = `${platePrefix}depth ${mm(frame.depth)} of ${mm(stage.timeline.result.losThicknessM)}`;
    q('.armor-hud-speed').textContent = `${Math.round(frame.speed)} m/s`;
    scrub.value = String(Math.round(u * 1000));
    const reached = stack.events.filter((e) => e.t <= pb.fragmentT);
    caption.textContent = reached.length ? reached[reached.length - 1].label : '';
    resultsBox.querySelectorAll<HTMLElement>('[data-event]').forEach((li) => li.classList.toggle('reached', Number(li.dataset.event) <= pb.fragmentT));
  };

  const stackRows = (st: StackTimeline): [string, string][] => {
    const r = st.result;
    const rows: [string, string][] = [
      ['Outcome', r.perforated ? `Through all ${st.plates.length} plates` : `Stopped at plate ${(r.stoppedAt ?? 0) + 1}`],
      ['Plates defeated', `${r.platesDefeated} of ${st.plates.length}`],
    ];
    for (const p of st.plates) {
      const title = `Plate ${p.index + 1}: ${p.materialName.split(' (')[0]} ${mm(p.thicknessM)}`;
      if (!p.engaged) {
        rows.push([title, 'not reached']);
        continue;
      }
      const out = p.perforated ? `through at ${Math.round(p.residualVelocity)} m/s${p.residualLengthM > 0 ? `, ${mm(p.residualLengthM)} of it left` : ''}` : p.mechanism === 'Ricochet' ? 'glanced off' : 'stopped';
      rows.push([title, `${p.mechanism}; arrives at ${Math.round(p.entrySpeed)} m/s; dug ${mm(p.penetrationM)} of ${mm(p.losThicknessM)}; ${out}`]);
    }
    rows.push(['Impact energy', joules(r.impactEnergyJ)], ['Carried through the stack', r.perforated ? joules(r.residualEnergyJ) : '—']);
    return rows;
  };

  const renderResults = () => {
    if (!stack) {
      resultsBox.innerHTML = '<h2>Results</h2><p>No model for this munition yet.</p>';
      return;
    }
    const timeline = stack.stages[0].timeline;
    const r = timeline.result;
    const rows: [string, string][] = [
      ['Mechanism', r.mechanism],
      ['Outcome', r.perforated ? 'Perforated' : r.ricochet ? 'Glanced off' : 'Stopped'],
      ['Penetration', `${mm(r.penetrationM)} of ${mm(r.losThicknessM)} line-of-sight`],
      ['Residual velocity', r.perforated ? `${Math.round(r.residualVelocity)} m/s` : '—'],
      ['Residual mass', r.perforated ? kg(r.residualMassKg) : '—'],
      ['Impact energy', joules(r.impactEnergyJ)],
      ['Absorbed by the plate', joules(r.energy.plateWorkJ)],
      ['In ejected metal', joules(r.energy.ejectaJ)],
      [r.ricochet ? 'Carried away by the ricochet' : 'Carried through', joules(r.residualEnergyJ)],
    ];
    if (r.shattered) rows.push(['Penetrator', `Shattered into ${r.fragments} pieces`]);
    if (r.plug) rows.push(['Plug', `${kg(r.plug.massKg)} at ${Math.round(r.plug.velocity)} m/s`]);
    if (r.ricochet) rows.push(['Ricochet', `leaves at ${r.ricochet.exitAngleDeg.toFixed(0)}° to the face, ${Math.round(r.ricochet.exitSpeed)} m/s; critical slope ${r.ricochet.criticalDeg.toFixed(0)}°`]);
    const debris = (r as unknown as { debris?: { halfAngleDeg: number } }).debris;
    if (debris) rows.push(['Debris behind the plate', `a cone of ${debris.halfAngleDeg.toFixed(0)}° half-angle`]);
    if ((r as unknown as { failedToFuze?: boolean }).failedToFuze) rows.push(['Fuzing', 'Too oblique: skidded off']);
    const shown = stack.stages.length > 1 ? stackRows(stack) : rows;
    resultsBox.innerHTML = `
      <h2>Results</h2>
      <dl class="readout"${stack.stages.length > 1 ? ' style="grid-template-columns: 1fr"' : ''}>${shown.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <h3>What happened</h3>
      <ol class="armor-events">${stack.events.map((e) => `<li data-event="${e.t}"><time>${us(e.t)}</time> ${e.label}</li>`).join('')}</ol>`;
  };

  const step = (now: number) => {
    raf = requestAnimationFrame(step);
    const dt = (now - last) / 1000;
    last = now;
    if (!playing || !stack) return;
    const factor = SPEEDS[Number(speedSel.value)].factor;
    u += (dt * factor) / (PLAY_SECONDS * (stack.fragments ? AFTERMATH_PLAY_FACTOR : 1) * (stack.stages.length > 1 ? 1.3 : 1));
    if (u >= 1) {
      u = 1;
      playing = false;
    }
    redraw();
  };

  const onInput = () => {
    syncControls();
  };
  for (const el of [calibre, velocity, obliquity]) el.addEventListener('input', onInput);
  for (const el of [thickness, materialSel]) {
    el.addEventListener('input', () => {
      custom();
      onInput();
    });
  }
  arrangementSel.addEventListener('input', () => {
    if (arrangementSel.value === 'custom') return;
    applyArrangement(arrangementSel.value);
  });
  addPlate.addEventListener('click', () => {
    if (rows.length + 1 >= MAX_LAYERS) return;
    rows.push({ materialId: 'rha', thicknessMm: 40, gapMm: 100 });
    renderRows();
    custom();
  });
  familySel.addEventListener('input', () => {
    velocity.value = '';
    syncControls();
  });
  q('.armor-fire').addEventListener('click', fire);
  playBtn.addEventListener('click', () => {
    if (!stack) return;
    if (u >= 1) u = 0;
    playing = !playing;
    redraw();
  });
  scrub.addEventListener('input', () => {
    if (!stack) return;
    playing = false;
    u = Number(scrub.value) / 1000;
    redraw();
  });
  q('.armor-back').addEventListener('click', () => location.assign(location.pathname));
  window.addEventListener('resize', resize);

  calibre.value = '120';
  thickness.value = '120';
  obliquity.value = '0';
  familySel.value = 'apfsds';
  materialSel.value = DEFAULT_PLATE_MATERIAL_ID;
  arrangementSel.value = 'single';
  renderRows();
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
      if (p.material || p.thicknessMm !== undefined) mainRef = { materialId: materialSel.value as PlateMaterialId, thicknessMm: Number(thickness.value) };
      if (p.obliquityDeg !== undefined) obliquity.value = String(p.obliquityDeg);
      if (p.overlay) {
        overlay = p.overlay;
        syncOverlays();
      }
      syncControls();
      if (p.arrangement) applyArrangement(p.arrangement);
      return fire();
    },
    dispose() {
      cancelAnimationFrame(raf);
      view3d?.dispose();
      window.removeEventListener('resize', resize);
      screen.remove();
    },
  };
}

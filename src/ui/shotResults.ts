import type { StackLayer } from '../data/stacks';
import type { OrganicResult } from '../fx/bloodPackEffect';
import type { TargetLayer } from '../sim/engine';
import { sampleTrack } from '../sim/sample';
import type { ShotSummary, Timeline, Track, Vec3 } from '../sim/types';

export interface ShotResults {
  /** Shows the last shot's numbers and velocity chart, plus per-layer (stacks) and blood-pack (organic) details. */
  show(timeline: Timeline, stack: StackLayer[], layers: TargetLayer[], organic: OrganicResult | null): void;
  hide(): void;
  /** Names the shot in the title (comparison mode), or null for the plain title. */
  setLabel(label: string | null): void;
  setFolded(folded: boolean): void;
  /** Moves the chart's live marker to the last shot's bullet at sim time `t`. */
  update(t: number): void;
}

const FT_PER_M = 3.28084;
const FT_LB_PER_J = 0.737562;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Chart geometry, in SVG user units. */
const CHART = { width: 220, height: 104, left: 30, right: 6, top: 6, bottom: 16 };
/** The chart polyline never needs more points than this. */
const MAX_CHART_POINTS = 160;

/**
 * The results panel (#13): what the last shot did (impact speed and energy,
 * penetration, exit speed, the bullet's final state, peak cavity, energy left
 * in the target) and a velocity-vs-depth chart with gridlines and a marker
 * that follows the bullet during playback. Layer and blood-pack
 * tables (#24, #19) sit under a Details toggle, and the whole panel folds
 * down to one line so it never has to cover the target.
 */
export function mountShotResults(root: HTMLElement, className = ''): ShotResults {
  const panel = document.createElement('section');
  panel.className = `panel shot-results ${className}`.trim();
  panel.hidden = true;
  panel.innerHTML = `
    <div class="results-head">
      <span class="field-label results-title">Results</span>
      <span class="results-line"></span>
      <button type="button" class="results-details" aria-expanded="false">Details</button>
      <button type="button" class="results-fold" aria-expanded="true" title="Fold the results panel">▾</button>
    </div>
    <div class="results-body">
      <div class="results-main">
        <dl class="readout results-readout"></dl>
        <figure class="results-chart">
          <svg viewBox="0 0 ${CHART.width} ${CHART.height}" role="img" aria-label="Velocity against depth"></svg>
          <p class="results-chart-empty" hidden></p>
        </figure>
      </div>
      <div class="results-extra" hidden></div>
    </div>
  `;
  root.append(panel);

  const q = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
  const body = q('.results-body');
  const extra = q('.results-extra');
  const fold = q<HTMLButtonElement>('.results-fold');
  const details = q<HTMLButtonElement>('.results-details');
  let folded = false;
  let showDetails = false;
  let label: string | null = null;
  const svg = panel.querySelector<SVGSVGElement>('.results-chart svg')!;
  const empty = q('.results-chart-empty');
  /** Live marker state for the shot on the chart. */
  let marker: SVGCircleElement | null = null;
  let track: Track | null = null;
  let impactPos: Vec3 | null = null;
  let impactTime = Infinity;
  let toX = (_depth: number) => 0;
  let toY = (_speed: number) => 0;
  let maxDepth = 0;

  const layout = () => {
    body.hidden = folded;
    q('.results-line').hidden = !folded;
    fold.textContent = folded ? '▴' : '▾';
    fold.setAttribute('aria-expanded', String(!folded));
    extra.hidden = !showDetails || !extra.innerHTML;
    details.hidden = folded || !extra.innerHTML;
    details.classList.toggle('active', showDetails);
    details.setAttribute('aria-expanded', String(showDetails));
  };
  fold.addEventListener('click', () => {
    folded = !folded;
    layout();
  });
  details.addEventListener('click', () => {
    showDetails = !showDetails;
    layout();
  });

  return {
    show(timeline, stack, layers, organic) {
      const shot = timeline.shots.at(-1)!;
      const s = shot.summary;
      const title = timeline.shots.length > 1 ? `Results · shot ${timeline.shots.length}` : 'Results';
      q('.results-title').textContent = label ?? title;
      q('.results-title').title = label ?? '';
      const hasCavity = layers.some((l) => l.medium.behaviour === 'gel' || l.medium.behaviour === 'water');
      q('.results-readout').innerHTML = readout(s, hasCavity)
        .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
        .join('');
      q('.results-line').textContent = `${Math.round(s.impactSpeed)} m/s · ${formatEnergy(s.impactEnergyJ)} · ${outcomeLine(s)}`;
      const impact = timeline.events.find((e) => e.type === 'impact' && e.trackId === shot.primaryId);
      impactPos = impact?.pos ?? null;
      impactTime = impact?.t ?? Infinity;
      track = timeline.tracks[shot.primaryId];
      marker = drawChart(s, stack, layers);
      const parts: string[] = [];
      if (stack.length > 1) parts.push(layerTable(timeline, stack, layers));
      if (organic) parts.push(organicTable(organic));
      extra.innerHTML = parts.join('');
      panel.hidden = false;
      layout();
    },
    hide() {
      panel.hidden = true;
    },
    setLabel(text) {
      label = text;
    },
    setFolded(value) {
      folded = value;
      layout();
    },
    update(t) {
      if (!marker || !impactPos || !track || panel.hidden || folded) return;
      const k = t >= impactTime ? sampleTrack(track, Math.min(t, track.keyframes.at(-1)!.t)) : null;
      marker.style.display = k ? '' : 'none';
      if (!k) return;
      const depth = Math.min(maxDepth, Math.hypot(k.pos.x - impactPos.x, k.pos.y - impactPos.y, k.pos.z - impactPos.z));
      marker.setAttribute('cx', toX(depth).toFixed(1));
      marker.setAttribute('cy', toY(k.speed).toFixed(1));
    },
  };

  /** Draws speed against depth with the stack's layers shaded behind it; returns the live marker, or null with no curve. */
  function drawChart(s: ShotSummary, stack: StackLayer[], layers: TargetLayer[]): SVGCircleElement | null {
    svg.replaceChildren();
    if (s.velocityVsDepth.length < 2) {
      svg.style.display = 'none';
      empty.hidden = false;
      empty.textContent = s.ricocheted
        ? 'Ricocheted off the face: no penetration.'
        : s.finalState === 'detonated'
          ? 'Detonated on contact: no penetration.'
          : 'Stopped at the surface.';
      return null;
    }
    svg.style.display = '';
    empty.hidden = true;

    const points = [{ depth: 0, speed: s.impactSpeed }, ...s.velocityVsDepth];
    if (s.passedThrough) points.push({ depth: Math.max(points.at(-1)!.depth, s.penetrationM), speed: s.exitSpeed });
    maxDepth = niceCeil(points.at(-1)!.depth);
    const maxSpeed = niceCeil(s.impactSpeed);
    const plotW = CHART.width - CHART.left - CHART.right;
    const plotH = CHART.height - CHART.top - CHART.bottom;
    toX = (d) => CHART.left + (d / maxDepth) * plotW;
    toY = (v) => CHART.top + (1 - v / maxSpeed) * plotH;

    // Layer bands along the path (head-on depth; close enough for a sketch of where the speed went).
    if (stack.length > 1) {
      for (const l of layers) {
        const x0 = Math.min(l.offset, maxDepth);
        const x1 = Math.min(l.offset + l.thickness, maxDepth);
        if (x1 <= x0) continue;
        const band = el('rect', { x: toX(x0), y: CHART.top, width: toX(x1) - toX(x0), height: plotH, class: 'band' });
        band.classList.toggle('alt', (l.stack ?? 0) % 2 === 1);
        svg.append(band);
      }
    }
    // Gridlines at quarters, labelled at 0, half and full scale.
    for (let i = 0; i <= 4; i++) {
      const y = toY((maxSpeed * i) / 4);
      const x = toX((maxDepth * i) / 4);
      svg.append(
        el('line', { x1: CHART.left, x2: CHART.width - CHART.right, y1: y, y2: y, class: i === 0 ? 'axis' : 'grid' }),
        el('line', { x1: x, x2: x, y1: CHART.top, y2: CHART.top + plotH, class: i === 0 ? 'axis' : 'grid' }),
      );
      if (i % 2 === 0) {
        svg.append(
          text(String(Math.round((maxSpeed * i) / 4)), CHART.left - 3, y + 3, 'end'),
          text(i === 0 ? '0' : formatDepth((maxDepth * i) / 4), x, CHART.height - 4, i === 0 ? 'start' : i === 4 ? 'end' : 'middle'),
        );
      }
    }
    svg.append(text('m/s', CHART.left + 3, CHART.top + 8, 'start'));

    const stride = Math.max(1, Math.ceil(points.length / MAX_CHART_POINTS));
    const sampled = points.filter((_, i) => i % stride === 0 || i === points.length - 1);
    svg.append(el('polyline', { points: sampled.map((p) => `${toX(p.depth).toFixed(1)},${toY(p.speed).toFixed(1)}`).join(' '), class: 'speed' }));

    const dot = el('circle', { r: 3, class: 'marker', cx: toX(0), cy: toY(s.impactSpeed) }) as SVGCircleElement;
    dot.style.display = 'none';
    svg.append(dot);
    return dot;
  }
}

/** Rounds up to 1, 2, 2.5 or 5 × a power of ten, for tidy axis limits. */
function niceCeil(x: number): number {
  if (x <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 2.5, 5]) if (m * p >= x) return m * p;
  return 10 * p;
}

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function text(content: string, x: number, y: number, anchor: 'start' | 'middle' | 'end'): SVGElement {
  const node = el('text', { x, y, 'text-anchor': anchor });
  node.textContent = content;
  return node;
}

function readout(s: ShotSummary, hasCavity: boolean): [string, string][] {
  const rows: [string, string][] = [
    ['Impact velocity', `${Math.round(s.impactSpeed)} m/s<small>${Math.round(s.impactSpeed * FT_PER_M).toLocaleString('en-US')} ft/s</small>`],
    ['Kinetic energy', `${Math.round(s.impactEnergyJ).toLocaleString('en-US')} J<small>${Math.round(s.impactEnergyJ * FT_LB_PER_J).toLocaleString('en-US')} ft-lb</small>`],
    ['Penetration', s.ricocheted ? 'None' : formatDepth(s.penetrationM)],
    ['Passed through', s.passedThrough ? 'Yes' : 'No'],
    ['Exit velocity', s.passedThrough ? `${Math.round(s.exitSpeed)} m/s` : '—'],
    ['Bullet', finalState(s)],
    // Rounding in the step-by-step physics can nudge the tally past what arrived; it can't exceed it.
    ['Energy deposited', formatEnergy(Math.min(s.energyDepositedJ, s.impactEnergyJ))],
  ];
  // The temporary cavity only means something in gel and water.
  if (hasCavity) rows.push(['Max temp. cavity', s.maxCavityDiameter > 0 ? formatDepth(s.maxCavityDiameter) : '—']);
  return rows;
}

function finalState(s: ShotSummary): string {
  const mm = `${(s.finalDiameter * 1000).toFixed(1)} mm`;
  switch (s.finalState) {
    case 'intact':
      return 'Intact';
    case 'expanded':
      return `Expanded to ${mm}`;
    case 'deformed':
      return `Flattened to ${mm}`;
    case 'fragmented':
      return s.fragments ? `Fragmented (${s.fragments} pieces)` : 'Fragmented';
    case 'splashed':
      return s.fragments ? `Splashed (${s.fragments} pieces)` : 'Splashed';
    case 'ricocheted':
      return 'Ricocheted';
    case 'detonated':
      return s.fragments ? `Detonated (${s.fragments} fragments)` : 'Detonated';
  }
}

function outcomeLine(s: ShotSummary): string {
  if (s.ricocheted) return 'ricocheted';
  return s.passedThrough ? `through, ${Math.round(s.exitSpeed)} m/s out` : `stopped at ${formatDepth(s.penetrationM)}`;
}

function formatDepth(m: number): string {
  return m < 0.01 ? `${(m * 1000).toFixed(1)} mm` : `${(m * 100).toFixed(1)} cm`;
}

function formatEnergy(j: number): string {
  return `${Math.round(j).toLocaleString('en-US')} J`;
}

function layerTable(timeline: Timeline, stack: StackLayer[], layers: TargetLayer[]): string {
  const shot = timeline.shots.at(-1)!;
  const track = timeline.tracks[shot.primaryId];
  const events = timeline.events.filter((e) => e.trackId === shot.primaryId && e.layer !== undefined);
  const entryOf = (i: number) => events.find((e) => layers[e.layer!]?.stack === i && (e.type === 'impact' || e.type === 'enter'));
  const rows = stack.map((l, i) => {
    const mine = events.filter((e) => layers[e.layer!]?.stack === i);
    const entry = entryOf(i);
    // Layers that touch (the dummy's anatomy) hand the bullet straight on without an exit event.
    const exit = mine.filter((e) => e.type === 'exit').at(-1) ?? (entry ? entryOf(i + 1) : undefined);
    const ricochet = mine.find((e) => e.type === 'ricochet');
    let outcome: string;
    if (!entry && !ricochet) outcome = 'not reached';
    else if (ricochet && !entry) outcome = 'ricocheted';
    else if (exit) outcome = `${Math.round(exit.speed)} m/s out`;
    else outcome = 'stopped';
    const vIn = entry?.speed ?? 0;
    const vOut = exit?.speed ?? 0;
    const energy = entry ? 0.5 * track.massKg * (vIn ** 2 - vOut ** 2) : 0;
    return `<tr><th>${i + 1}. ${escape(l.medium.name)}</th><td>${entry ? `${Math.round(vIn)} m/s in` : '–'}</td><td>${outcome}</td><td>${entry ? `${Math.round(energy).toLocaleString('en-US')} J` : '–'}</td></tr>`;
  });
  return `<span class="field-label">Through the layers (last shot)</span><table class="layer-table">${rows.join('')}</table>`;
}

function organicTable(r: OrganicResult): string {
  const cells = [
    ['Packs hit', r.hit],
    ['Burst by cavity', r.burstByCavity],
    ['Intact', r.packs - r.hit - r.burstByCavity],
    ...(r.bone ? [['Spine', r.boneStruck ? 'Struck' : 'Missed']] : []),
  ];
  return `<span class="field-label">Blood packs</span><dl class="readout">${cells
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('')}</dl>`;
}

function escape(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

import type { StackLayer } from '../data/stacks';
import type { OrganicResult } from '../fx/bloodPackEffect';
import type { TargetLayer } from '../sim/engine';
import type { ShotSummary, Timeline } from '../sim/types';

export interface ShotResults {
  /** Shows the last shot's numbers and velocity chart, plus per-layer (stacks) and blood-pack (organic) details. */
  show(timeline: Timeline, stack: StackLayer[], layers: TargetLayer[], organic: OrganicResult | null): void;
  hide(): void;
  /** Names the shot in the title (comparison mode), or null for the plain title. */
  setLabel(label: string | null): void;
  setFolded(folded: boolean): void;
}

const FT_PER_M = 3.28084;
const FT_LB_PER_J = 0.737562;

/**
 * The results panel (#13): what the last shot did (impact speed and energy,
 * penetration, exit speed, the bullet's final state, peak cavity, energy left
 * in the target) and a small velocity-vs-depth chart. Layer and blood-pack
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
        <figure class="results-chart" aria-label="Velocity against depth"></figure>
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
      q('.results-readout').innerHTML = readout(s)
        .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
        .join('');
      q('.results-line').textContent = `${Math.round(s.impactSpeed)} m/s · ${formatEnergy(s.impactEnergyJ)} · ${outcomeLine(s)}`;
      q('.results-chart').innerHTML = chart(s, stack, layers);
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
  };
}

function readout(s: ShotSummary): [string, string][] {
  const rows: [string, string][] = [
    ['Impact', `${Math.round(s.impactSpeed)} m/s<small>${Math.round(s.impactSpeed * FT_PER_M).toLocaleString('en-US')} ft/s</small>`],
    ['Energy', `${Math.round(s.impactEnergyJ).toLocaleString('en-US')} J<small>${Math.round(s.impactEnergyJ * FT_LB_PER_J).toLocaleString('en-US')} ft-lb</small>`],
    ['Penetration', s.ricocheted ? 'none' : formatDepth(s.penetrationM)],
    ['Exit', s.passedThrough ? `${Math.round(s.exitSpeed)} m/s` : s.ricocheted ? 'ricochet' : 'stopped'],
    ['Bullet', finalState(s)],
    // Rounding in the step-by-step physics can nudge the tally past what arrived; it can't exceed it.
    ['Into target', formatEnergy(Math.min(s.energyDepositedJ, s.impactEnergyJ))],
  ];
  if (s.maxCavityDiameter > 0) rows.push(['Max cavity', formatDepth(s.maxCavityDiameter)]);
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
      return s.fragments ? `Fragmented (${s.fragments})` : 'Fragmented';
    case 'splashed':
      return 'Disintegrated';
    case 'ricocheted':
      return 'Ricocheted';
    case 'detonated':
      return 'Detonated';
  }
}

function outcomeLine(s: ShotSummary): string {
  if (s.ricocheted) return 'ricocheted';
  return s.passedThrough ? `through, ${Math.round(s.exitSpeed)} m/s out` : `stopped at ${formatDepth(s.penetrationM)}`;
}

/** Speed against depth as a small SVG line chart, with the stack's layers shaded behind it. */
function chart(s: ShotSummary, stack: StackLayer[], layers: TargetLayer[]): string {
  const W = 200;
  const H = 96;
  const pad = { l: 30, r: 6, t: 6, b: 18 };
  const points = [...s.velocityVsDepth];
  if (!points.length || points[0].depth > 0) points.unshift({ depth: 0, speed: s.impactSpeed });
  const end = s.passedThrough ? { depth: points.at(-1)!.depth, speed: s.exitSpeed } : { depth: s.penetrationM, speed: 0 };
  if (!s.ricocheted && end.depth >= points.at(-1)!.depth) points.push(end);
  const maxDepth = Math.max(0.01, ...points.map((p) => p.depth));
  const maxSpeed = Math.max(1, s.impactSpeed);
  const x = (d: number) => pad.l + (d / maxDepth) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / maxSpeed) * (H - pad.t - pad.b);

  // Layer bands along the path (head-on depth; close enough for a sketch of where the speed went).
  const bands = layers
    .map((l) => {
      const x0 = Math.min(l.offset, maxDepth);
      const x1 = Math.min(l.offset + l.thickness, maxDepth);
      if (x1 <= x0) return '';
      const shade = (l.stack ?? 0) % 2 === 0 ? 0.07 : 0.13;
      return `<rect x="${x(x0).toFixed(1)}" y="${pad.t}" width="${(x(x1) - x(x0)).toFixed(1)}" height="${H - pad.t - pad.b}" fill="rgba(255,255,255,${shade})"/>`;
    })
    .join('');
  const line = points.map((p) => `${x(p.depth).toFixed(1)},${y(p.speed).toFixed(1)}`).join(' ');
  const depthLabel = formatDepth(maxDepth);
  return `<svg viewBox="0 0 ${W} ${H}" role="img">
    ${stack.length ? bands : ''}
    <line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" class="axis"/>
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H - pad.b}" class="axis"/>
    <polyline points="${line}" class="speed"/>
    <text x="${pad.l - 3}" y="${pad.t + 7}" text-anchor="end">${Math.round(maxSpeed)}</text>
    <text x="${pad.l - 3}" y="${H - pad.b}" text-anchor="end">0</text>
    <text x="${pad.l}" y="${H - 5}">0</text>
    <text x="${W - pad.r}" y="${H - 5}" text-anchor="end">${depthLabel}</text>
    <text x="${(pad.l + W) / 2}" y="${H - 5}" text-anchor="middle">m/s vs depth</text>
  </svg>`;
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
    else if (ricochet) outcome = 'ricocheted';
    else if (exit) outcome = `${Math.round(exit.speed)} m/s out`;
    else outcome = 'stopped';
    const vIn = entry?.speed ?? 0;
    // A glancing round keeps the speed it bounced off with (#131).
    const vOut = (ricochet ?? exit)?.speed ?? 0;
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

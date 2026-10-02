import type { StackLayer } from '../data/stacks';
import type { OrganicResult } from '../fx/bloodPackEffect';
import type { TargetLayer } from '../sim/engine';
import type { Timeline } from '../sim/types';

export interface ShotResults {
  /** Shows the last Fire's per-layer results (for stacks) and blood-pack results (for organic targets). */
  show(timeline: Timeline, stack: StackLayer[], layers: TargetLayer[], organic: OrganicResult | null): void;
  hide(): void;
}

/**
 * A strip above the timeline with what the last shot did in each layer of a
 * stack (#24) — speed in and out, energy left there — and, for organic
 * targets, the blood packs and bone (#19).
 */
export function mountShotResults(root: HTMLElement): ShotResults {
  const panel = document.createElement('section');
  panel.className = 'panel shot-results';
  panel.hidden = true;
  root.append(panel);

  return {
    show(timeline, stack, layers, organic) {
      const parts: string[] = [];
      if (stack.length > 1) parts.push(layerTable(timeline, stack, layers));
      if (organic) parts.push(organicTable(organic));
      panel.innerHTML = parts.join('');
      panel.hidden = parts.length === 0;
    },
    hide() {
      panel.hidden = true;
    },
  };
}

function layerTable(timeline: Timeline, stack: StackLayer[], layers: TargetLayer[]): string {
  const shot = timeline.shots.at(-1)!;
  const track = timeline.tracks[shot.primaryId];
  const events = timeline.events.filter((e) => e.trackId === shot.primaryId && e.layer !== undefined);
  const rows = stack.map((l, i) => {
    const mine = events.filter((e) => layers[e.layer!]?.stack === i);
    const entry = mine.find((e) => e.type === 'impact' || e.type === 'enter');
    const exit = mine.filter((e) => e.type === 'exit').at(-1);
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

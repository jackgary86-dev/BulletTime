import type { BuildingSpec } from '../data/buildings';
import { MAX_WITNESS_BLOCKS, WITNESS_BLOCK, type WitnessBlock, type WitnessResult } from '../sim/witness';

export interface WitnessPanel {
  /** Shows the plan for `building` (its room `roomM` deep), or hides the section when null. */
  setBuilding(building: BuildingSpec | null, roomM: number): void;
  /** The blocks as the lane keeps them (clamped into the room). */
  setBlocks(blocks: readonly WitnessBlock[]): void;
  showResults(results: readonly WitnessResult[] | null): void;
}

export interface WitnessPanelOptions {
  onChange(blocks: WitnessBlock[]): void;
  /** Look from the back of the room toward the breach. */
  onInsideView(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const PLAN_W = 240;
const PLAN_H = 150;

/**
 * Witness targets (#249): a top-down plan of the building's room behind the
 * struck wall. Click the floor to stand a gel block there (up to six), click
 * a block to take it away. Under the plan, each block's result: how many
 * pieces reached it, its deepest track and widest cavity, and the blast there.
 */
export function mountWitnessPanel(host: HTMLElement, options: WitnessPanelOptions): WitnessPanel {
  const section = document.createElement('section');
  section.className = 'witness-section';
  section.hidden = true;
  section.innerHTML = `
    <h3 class="field-label">Witness gel blocks <output class="witness-count"></output></h3>
    <p class="witness-hint">Click the room to stand a 40 cm gel block there; click a block to remove it.</p>
    <svg class="witness-plan" viewBox="0 0 ${PLAN_W} ${PLAN_H}" role="img" aria-label="Plan of the room behind the struck wall"></svg>
    <button type="button" class="witness-inside">View from inside</button>
    <ol class="witness-results"></ol>
  `;
  host.append(section);
  const svg = section.querySelector<SVGSVGElement>('.witness-plan')!;
  const count = section.querySelector<HTMLOutputElement>('.witness-count')!;
  const list = section.querySelector<HTMLOListElement>('.witness-results')!;
  section.querySelector('.witness-inside')!.addEventListener('click', () => options.onInsideView());

  let building: BuildingSpec | null = null;
  let roomM = 1;
  let blocks: WitnessBlock[] = [];
  let results: readonly WitnessResult[] | null = null;

  // The plan: the shot comes from the left through the struck wall; the room runs right to the far wall, across is up and down.
  const scale = () => Math.min((PLAN_W - 30) / roomM, (PLAN_H - 20) / (building?.widthM ?? 1));
  const toPlan = (distM: number, lateralM: number) => ({ x: 20 + distM * scale(), y: PLAN_H / 2 - lateralM * scale() });
  const fromPlan = (x: number, y: number) => ({ distM: (x - 20) / scale(), lateralM: (PLAN_H / 2 - y) / scale() });

  const el = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };

  const draw = () => {
    svg.replaceChildren();
    if (!building) return;
    const s = scale();
    const halfW = (building.widthM / 2) * s;
    svg.append(
      el('rect', { x: 20, y: PLAN_H / 2 - halfW, width: roomM * s, height: halfW * 2, class: 'witness-room' }),
      el('rect', { x: 14, y: PLAN_H / 2 - halfW, width: 6, height: halfW * 2, class: 'witness-wall' }),
      el('line', { x1: 0, y1: PLAN_H / 2, x2: 20 + roomM * s, y2: PLAN_H / 2, class: 'witness-shotline' }),
    );
    blocks.forEach((b, i) => {
      const p = toPlan(b.distM, b.lateralM + WITNESS_BLOCK.faceM / 2);
      const hit = (results?.[i]?.pieces.length ?? 0) > 0;
      const rect = el('rect', { x: p.x, y: p.y, width: WITNESS_BLOCK.depthM * s, height: WITNESS_BLOCK.faceM * s, class: hit ? 'witness-block hit' : 'witness-block', 'data-index': i });
      const label = el('text', { x: p.x + (WITNESS_BLOCK.depthM * s) / 2, y: p.y - 2, class: 'witness-label' });
      label.textContent = String(i + 1);
      svg.append(rect, label);
    });
    count.textContent = `${blocks.length} / ${MAX_WITNESS_BLOCKS}`;
  };

  const renderResults = () => {
    list.replaceChildren();
    if (!results) return;
    results.forEach((r, i) => {
      const li = document.createElement('li');
      const where = `${r.block.distM.toFixed(1)} m in, ${r.block.lateralM >= 0 ? '+' : ''}${r.block.lateralM.toFixed(1)} m across`;
      const what = r.pieces.length
        ? `${r.pieces.length} piece${r.pieces.length === 1 ? '' : 's'}, deepest ${(r.deepestM * 100).toFixed(1)} cm, widest cavity ${(r.widestCavityM * 100).toFixed(1)} cm`
        : 'nothing reached it';
      const blast = r.blastKPa > 0 ? `; blast ${r.blastKPa.toFixed(r.blastKPa < 10 ? 1 : 0)} kPa${r.blastFelt ? ' (felt)' : ''}` : '';
      li.textContent = `${i + 1}. ${where}: ${what}${blast}`;
      list.append(li);
    });
  };

  svg.addEventListener('click', (e) => {
    if (!building) return;
    const target = e.target as Element;
    const index = target.getAttribute('data-index');
    if (index !== null) {
      blocks = blocks.filter((_, i) => i !== Number(index));
    } else {
      if (blocks.length >= MAX_WITNESS_BLOCKS) return;
      const box = svg.getBoundingClientRect();
      const x = ((e.clientX - box.left) / box.width) * PLAN_W;
      const y = ((e.clientY - box.top) / box.height) * PLAN_H;
      const at = fromPlan(x, y);
      // Clicks put the block's middle under the pointer.
      blocks = [...blocks, { distM: at.distM - WITNESS_BLOCK.depthM / 2, lateralM: at.lateralM }];
    }
    results = null;
    options.onChange(blocks);
  });

  return {
    setBuilding(b, room) {
      building = b;
      roomM = Math.max(0.5, room);
      section.hidden = !b;
      draw();
    },
    setBlocks(next) {
      blocks = [...next];
      draw();
      renderResults();
    },
    showResults(next) {
      results = next;
      draw();
      renderResults();
    },
  };
}

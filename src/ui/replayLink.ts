/**
 * Replay deep link (#230): open the Bullet lab with a round and a material already chosen, fire, and park the
 * replay at a moment after first contact, so a tile of the material reference sheet can be compared with the live
 * render side by side. Example:
 *
 *   /?mode=bullet&bullet=308-sp&medium=steel-mild&thickness=0.003&at=60us
 *
 * `at` is the time after the first impact: seconds (`0.0006`), microseconds (`60us`) or milliseconds (`1.2ms`).
 * On the proving ground, `preset` picks a target preset (a mock building, #246) and `witness` stands gel witness
 * blocks in its room (#249) as `distance:across` pairs in metres, e.g. `witness=0.3:0,1.5:-0.6`. In the Missile lab,
 * `dive` and `bearing` (degrees) set the approach (#250).
 */
import type { Approach } from '../sim/approach';
import type { WitnessBlock } from '../sim/witness';

export interface ReplayLink {
  /** Seconds after the first impact. */
  atS: number;
  bullet?: string;
  medium?: string;
  /** Thickness of the first layer, metres. */
  thicknessM?: number;
  /** A target preset id (#246). */
  preset?: string;
  /** Gel witness blocks in a building's room (#249). */
  witness?: WitnessBlock[];
  /** The missile's dive and bearing (#250). */
  approach?: Approach;
}

/** `0.3:0,1.5:-0.6` for these blocks. */
export function formatWitness(blocks: readonly WitnessBlock[]): string {
  return blocks.map((b) => `${+b.distM.toFixed(2)}:${+b.lateralM.toFixed(2)}`).join(',');
}

/** The approach from `dive` and `bearing` (degrees); undefined when neither is a number. */
export function parseApproach(dive: string | null, bearing: string | null): Approach | undefined {
  const d = dive === null ? NaN : Number(dive);
  const b = bearing === null ? NaN : Number(bearing);
  if (!Number.isFinite(d) && !Number.isFinite(b)) return undefined;
  return { diveDeg: Number.isFinite(d) ? d : 0, bearingDeg: Number.isFinite(b) ? b : 0 };
}

/** `dive=70&bearing=-15` for an approach. */
export function formatApproach(a: Approach): string {
  return `dive=${a.diveDeg}&bearing=${a.bearingDeg}`;
}

/** Blocks from `0.3:0,1.5:-0.6`; pairs that do not parse are dropped. */
export function parseWitness(text: string | null): WitnessBlock[] | undefined {
  if (!text) return undefined;
  const blocks = text
    .split(',')
    .map((pair) => pair.split(':').map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))
    .map(([distM, lateralM]) => ({ distM, lateralM }));
  return blocks.length ? blocks : undefined;
}

const TIME = /^(\d+(?:\.\d+)?(?:e-?\d+)?)\s*(us|µs|ms|s)?$/i;
const UNIT_S: Record<string, number> = { us: 1e-6, µs: 1e-6, ms: 1e-3, s: 1 };

/** Seconds from `60us`, `1.2ms`, `0.0006` or `0.5s`; null for anything else. */
export function parseReplayTime(text: string): number | null {
  const m = TIME.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * UNIT_S[(m[2] ?? 's').toLowerCase()];
}

/** The link in a query string, or null when it has no valid `at`. */
export function parseReplayLink(search: string): ReplayLink | null {
  const params = new URLSearchParams(search);
  const at = params.get('at');
  const atS = at === null ? null : parseReplayTime(at);
  if (atS === null) return null;
  const thickness = Number(params.get('thickness'));
  return {
    atS,
    bullet: params.get('bullet') || undefined,
    medium: params.get('medium') || undefined,
    thicknessM: params.get('thickness') && Number.isFinite(thickness) && thickness > 0 ? thickness : undefined,
    preset: params.get('preset') || undefined,
    witness: parseWitness(params.get('witness')),
    approach: parseApproach(params.get('dive'), params.get('bearing')),
  };
}

/**
 * Sets the pickers the way a person would, so the panels show what is being fired. Values the mode does not list
 * (a gel block in the Missile lab, #245) are left alone, and named in the result so the page can say so.
 */
export function applyReplayLink(root: ParentNode, link: ReplayLink): string[] {
  const ignored: string[] = [];
  const choose = (selector: string, value: string | undefined) => {
    const select = root.querySelector<HTMLSelectElement>(selector);
    if (value === undefined) return;
    if (!select || ![...select.options].some((o) => o.value === value)) {
      ignored.push(value);
      return;
    }
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  choose('#bullet-select', link.bullet);
  choose('#preset-select', link.preset);
  choose('#medium-select', link.medium);
  // A material this mode does not offer keeps its own thickness out of the way too.
  if (link.medium !== undefined && ignored.includes(link.medium)) return ignored;
  const slider = root.querySelector<HTMLInputElement>('#thickness-slider');
  if (slider && link.thicknessM !== undefined) {
    // Keep it inside what the material allows.
    const clamped = Math.min(Number(slider.max), Math.max(Number(slider.min), link.thicknessM));
    slider.value = String(clamped);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return ignored;
}

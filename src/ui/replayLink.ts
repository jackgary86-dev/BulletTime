/**
 * Replay deep link (#230): open the Bullet lab with a round and a material already chosen, fire, and park the
 * replay at a moment after first contact, so a tile of the material reference sheet can be compared with the live
 * render side by side. Example:
 *
 *   /?mode=bullet&bullet=308-sp&medium=steel-mild&thickness=0.003&at=60us
 *
 * `at` is the time after the first impact: seconds (`0.0006`), microseconds (`60us`) or milliseconds (`1.2ms`).
 */
export interface ReplayLink {
  /** Seconds after the first impact. */
  atS: number;
  bullet?: string;
  medium?: string;
  /** Thickness of the first layer, metres. */
  thicknessM?: number;
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
  };
}

/** Sets the pickers the way a person would, so the panels show what is being fired. Unknown values are left alone. */
export function applyReplayLink(root: ParentNode, link: ReplayLink): void {
  const choose = (selector: string, value: string | undefined) => {
    const select = root.querySelector<HTMLSelectElement>(selector);
    if (!select || value === undefined || ![...select.options].some((o) => o.value === value)) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  choose('#bullet-select', link.bullet);
  choose('#medium-select', link.medium);
  const slider = root.querySelector<HTMLInputElement>('#thickness-slider');
  if (slider && link.thicknessM !== undefined) {
    // Keep it inside what the material allows.
    const clamped = Math.min(Number(slider.max), Math.max(Number(slider.min), link.thicknessM));
    slider.value = String(clamped);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

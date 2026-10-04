import type { MunitionFamilyId } from '../armor/munitions';

/**
 * Small labelled diagrams for the explainer panel (#168): one per munition
 * family, drawn as inline SVG on the same side-on cut-away as the lab itself.
 * They sketch the mechanism only, with no dimensions.
 */

const PLATE = '<rect x="95" y="8" width="38" height="84" fill="#6e7680" stroke="#e6e9ee" stroke-width="1"/>';
const label = (x: number, y: number, text: string, anchor = 'start') => `<text x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`;

const DIAGRAMS: Record<MunitionFamilyId, string> = {
  'ap-shot': `${PLATE}
    <path d="M95 36 Q108 50 95 64 L133 64 L133 36 Z" fill="#07080a"/>
    <rect x="30" y="38" width="40" height="24" rx="6" fill="#c4ccd8"/>
    <rect x="140" y="40" width="14" height="20" rx="4" fill="#6e7680"/>
    ${label(30, 30, 'solid shot')}${label(95, 104, 'plate pushed aside', 'middle')}${label(147, 36, 'plug', 'middle')}`,
  apfsds: `${PLATE}
    <path d="M95 40 L118 36 L118 64 L95 60 Z" fill="#07080a"/>
    <rect x="30" y="47" width="55" height="6" fill="#8a8f99"/><path d="M85 47 L100 42 L100 58 L85 53 Z" fill="#8a8f99"/>
    ${label(30, 38, 'long rod')}${label(104, 30, 'eroded head flows back')}${label(95, 104, 'crater about 2x the rod width', 'middle')}`,
  heat: `${PLATE}
    <path d="M95 46 L125 49 L125 51 L95 54 Z" fill="#07080a"/>
    <path d="M20 50 L90 50" stroke="#e39a55" stroke-width="2.5"/><path d="M20 50 L90 50" stroke="#ffb060" stroke-width="1" stroke-opacity="0.8"/>
    <path d="M135 50 L168 30 M135 50 L172 50 M135 50 L168 70" stroke="#e39a55" stroke-opacity="0.6" stroke-width="1.5"/>
    ${label(20, 42, 'copper jet')}${label(95, 104, 'narrow, deep hole', 'middle')}${label(172, 24, 'debris', 'end')}`,
  hesh: `${PLATE}
    <ellipse cx="90" cy="50" rx="6" ry="20" fill="#e39a55"/>
    <path d="M97 50 L120 50" stroke="#ffb060" stroke-width="1" stroke-dasharray="3 2"/>
    <path d="M133 36 Q124 50 133 64 L144 64 Q140 50 144 36 Z" fill="#a0a8b2" stroke="#e6e9ee" stroke-width="0.8"/>
    ${label(60, 30, 'squashed head')}${label(110, 104, 'pulse reflects as tension', 'middle')}${label(160, 36, 'scab', 'middle')}`,
  'he-frag': `${PLATE}
    <circle cx="60" cy="30" r="3" fill="#c4ccd8"/><circle cx="52" cy="48" r="2.5" fill="#c4ccd8"/><circle cx="64" cy="66" r="3" fill="#c4ccd8"/><circle cx="76" cy="56" r="2" fill="#c4ccd8"/>
    <path d="M95 30 Q101 31 95 33 M95 62 Q100 64 95 66" stroke="#07080a" stroke-width="3" fill="none"/>
    <path d="M70 38 L88 22" stroke="#c4ccd8" stroke-width="1.2" stroke-dasharray="2 2"/>
    ${label(20, 24, 'many small fragments')}${label(95, 104, 'pits and dents only', 'middle')}`,
};

/** A labelled SVG sketch of how a family defeats (or fails to defeat) the plate. */
export function familyDiagram(id: MunitionFamilyId): string {
  return `<svg class="armor-diagram" viewBox="0 0 180 110" role="img" aria-label="Sketch of the mechanism" xmlns="http://www.w3.org/2000/svg" font-size="7" fill="#c9ced6">${DIAGRAMS[id]}</svg>`;
}

/**
 * Armor lab (#167): the geometry of the cut-away cross-section. The plate is
 * drawn sectioned along the shot line, the way a test sample is sawn open: the
 * projectile comes from the left, the plate's front face is a vertical edge,
 * and the penetration crater, the rear bulge and the penetrator itself are
 * outlines in screen pixels. Obliquity is unfolded: the plate is drawn at its
 * line-of-sight thickness, so the picture is the path the penetrator digs.
 *
 * This module is pure (no canvas, no DOM): it turns an `ArmorTimeline` and a
 * `ArmorFrame` into the shapes to paint, so the layout and the outlines can be
 * unit-tested. `sectionDraw.ts` paints them.
 */

import type { ArmorFrame, ArmorTimeline } from './model';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How metres map to pixels for a timeline on a canvas of a given size. */
export interface SectionLayout {
  width: number;
  height: number;
  /** Pixels per metre. */
  pxPerM: number;
  /** x pixel of the plate's front face, and of its rear face. */
  frontX: number;
  rearX: number;
  /** y pixel of the shot line (the section's axis). */
  axisY: number;
  /** The sawn face of the plate, full height of the view. */
  plate: Rect;
}

/** Everything to paint for one frame. */
export interface SectionShapes {
  layout: SectionLayout;
  /** The crater, as a closed outline (mirrored about the axis); empty before anything is dug. */
  crater: Point[];
  /** Whether the crater is open at the rear face (the plate is perforated). */
  throughHole: boolean;
  /** The dome pushed out of the rear face, as a closed outline; empty when flat. */
  bulge: Point[];
  /** The penetrator's body: nose position, length and diameter in pixels. */
  penetrator: { noseX: number; tailX: number; radiusPx: number };
  /** Cumulative energy deposited, as a share (0 to 1) of the impact energy, for the heat glow. */
  heat: number;
  /** How far the crater has progressed through the plate, 0 to 1 (by depth over line-of-sight thickness). */
  progress: number;
}

/** Fraction of the view kept clear to the left and right of the plate. */
export const VIEW_MARGIN = 0.7;
/** Smallest view width in metres, so a thin plate is not drawn as a sliver. */
export const MIN_VIEW_M = 0.12;

/** The penetrator's diameter at impact, m (the jet's width, the shot's or rod's own, or a fragment's). */
export function penetratorDiameter(timeline: ArmorTimeline): number {
  const impact = timeline.shot.impact;
  switch (impact.family) {
    case 'heat':
      return impact.jetDiameter;
    default:
      return impact.diameter;
  }
}

/**
 * Fits the plate and some air either side into a canvas. The view is as wide
 * as the plate plus a margin of `VIEW_MARGIN` plate thicknesses either side
 * (never less than `MIN_VIEW_M`), and the plate takes the whole height.
 */
export function sectionLayout(timeline: ArmorTimeline, width: number, height: number): SectionLayout {
  const tLos = timeline.result.losThicknessM;
  const margin = Math.max(VIEW_MARGIN * tLos, (MIN_VIEW_M - tLos) / 2, 0.03);
  const viewM = tLos + 2 * margin;
  const pxPerM = width / viewM;
  const frontX = margin * pxPerM;
  const rearX = frontX + tLos * pxPerM;
  return {
    width,
    height,
    pxPerM,
    frontX,
    rearX,
    axisY: height / 2,
    plate: { x: frontX, y: 0, width: rearX - frontX, height },
  };
}

/** The shapes for one frame of a timeline. */
export function sectionShapes(timeline: ArmorTimeline, frame: ArmorFrame, layout: SectionLayout): SectionShapes {
  const { pxPerM, frontX, rearX, axisY } = layout;
  const tLos = timeline.result.losThicknessM;
  const depth = Math.min(frame.depth, tLos);
  const through = timeline.result.perforated && frame.depth >= tLos - 1e-9;

  // The crater: radius at CRATER_PROFILE_SAMPLES depths from the face, or a cylinder with a rounded bottom.
  const crater: Point[] = [];
  if (depth > 0) {
    const profile = frame.craterProfile && frame.craterProfile.length > 1 ? frame.craterProfile : null;
    const n = profile ? profile.length : 12;
    const top: Point[] = [];
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      const radius = profile ? profile[i] : frame.craterRadius;
      top.push({ x: frontX + depth * s * pxPerM, y: axisY - radius * pxPerM });
    }
    const last = top[top.length - 1];
    const r = axisY - last.y;
    // A rounded nose to the crater while it is still digging; open at the rear once through.
    const nose: Point[] = [];
    if (!through) {
      for (let k = 1; k <= 5; k++) {
        const a = (k / 6) * (Math.PI / 2);
        nose.push({ x: last.x + Math.sin(a) * r * 0.6, y: axisY - Math.cos(a) * r });
      }
      nose.push({ x: last.x + r * 0.6, y: axisY });
    }
    const bottom = top.map((p) => ({ x: p.x, y: 2 * axisY - p.y })).reverse();
    const noseBottom = nose.map((p) => ({ x: p.x, y: 2 * axisY - p.y })).reverse();
    crater.push(...top, ...nose, ...noseBottom, ...bottom);
  }

  // The rear bulge: a dome on the rear face, as wide as four crater radii.
  const bulge: Point[] = [];
  if (frame.rearBulge > 1e-6 && !through) {
    const half = Math.max(frame.craterRadius * 4, frame.rearBulge * 3) * pxPerM;
    const h = frame.rearBulge * pxPerM;
    for (let i = 0; i <= 12; i++) {
      const s = -1 + (2 * i) / 12;
      bulge.push({ x: rearX + h * (1 - s * s), y: axisY + s * half });
    }
  }

  // The penetrator: nose at the crater bottom (or beyond the rear face once through), body behind it.
  const noseX = frontX + frame.travel * pxPerM;
  const length = Math.max(0, frame.penetratorLength) * pxPerM;
  const radiusPx = Math.max(1.2, (penetratorDiameter(timeline) / 2) * pxPerM);

  const total = timeline.result.impactEnergyJ;
  return {
    layout,
    crater,
    throughHole: through,
    bulge,
    penetrator: { noseX, tailX: noseX - length, radiusPx },
    heat: total > 0 ? Math.min(1, Math.max(0, frame.energyDepositedJ / total)) : 0,
    progress: tLos > 0 ? Math.min(1, depth / tLos) : 0,
  };
}

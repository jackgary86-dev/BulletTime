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

import { viewMargin, type ArmorFrame, type ArmorTimeline, type FragmentKind } from './model';
import { ROOM_HALF_HEIGHT_FACTOR, fragmentStateAt } from './fragments';

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
  penetrator: { noseX: number; tailX: number; radiusPx: number; /** The fragment tracks have taken it over, so it is not drawn. */ hidden: boolean };
  /** Cumulative energy deposited, as a share (0 to 1) of the impact energy, for the heat glow. */
  heat: number;
  /** How far the crater has progressed through the plate, 0 to 1 (by depth over line-of-sight thickness). */
  progress: number;
}

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
 * as the plate plus the air either side (`viewMargin`, never less than
 * `MIN_VIEW_M` wide in all), and the plate takes the whole height. When the
 * canvas is too flat to show the floor and ceiling of the fragment room, the
 * view is scaled down to fit them, with the plate kept in the middle.
 */
export function sectionLayout(timeline: ArmorTimeline, width: number, height: number): SectionLayout {
  const tLos = timeline.result.losThicknessM;
  const margin = viewMargin(tLos);
  const viewM = tLos + 2 * margin;
  const roomHeightM = 2 * ROOM_HALF_HEIGHT_FACTOR * margin;
  const pxPerM = Math.min(width / viewM, height / roomHeightM);
  const frontX = (width - tLos * pxPerM) / 2;
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
export function sectionShapes(timeline: ArmorTimeline, frame: ArmorFrame, layout: SectionLayout, fragmentT = frame.t): SectionShapes {
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

  const handoff = timeline.fragments ? timeline.fragments.handoffS : null;
  const total = timeline.result.impactEnergyJ;
  return {
    layout,
    crater,
    throughHole: through,
    bulge,
    penetrator: { noseX, tailX: noseX - length, radiusPx, hidden: handoff !== null && fragmentT >= handoff },
    heat: total > 0 ? Math.min(1, Math.max(0, frame.energyDepositedJ / total)) : 0,
    progress: tLos > 0 ? Math.min(1, depth / tLos) : 0,
  };
}

/** A piece thrown from the plate, in pixels. */
export interface DrawnFragment {
  kind: FragmentKind;
  x: number;
  y: number;
  /** Tilt, radians (screen y points down, so this is already flipped). */
  angle: number;
  lengthPx: number;
  widthPx: number;
  hot: boolean;
  resting: boolean;
}

/** The test room the pieces fly about in, in pixels: the floor, the ceiling and the two outer walls. */
export interface RoomShapes {
  floorY: number;
  ceilingY: number;
  leftX: number;
  rightX: number;
}

/** The room in pixels, or null when the timeline throws nothing. */
export function roomShapes(timeline: ArmorTimeline, layout: SectionLayout): RoomShapes | null {
  const field = timeline.fragments;
  if (!field) return null;
  const { room } = field;
  return {
    floorY: layout.axisY - room.floorY * layout.pxPerM,
    ceilingY: layout.axisY - room.ceilingY * layout.pxPerM,
    leftX: layout.frontX + room.leftX * layout.pxPerM,
    rightX: layout.frontX + room.rightX * layout.pxPerM,
  };
}

/** Smallest a piece is drawn, px, so a speck is still seen. */
export const MIN_FRAGMENT_PX = 2.5;

/** The pieces in flight at `fragmentT` seconds after impact, in pixels. Pieces not yet thrown are left out. */
export function fragmentShapes(timeline: ArmorTimeline, fragmentT: number, layout: SectionLayout): DrawnFragment[] {
  const field = timeline.fragments;
  if (!field) return [];
  const out: DrawnFragment[] = [];
  for (const track of field.tracks) {
    if (fragmentT < track.t0) continue;
    const s = fragmentStateAt(track, fragmentT);
    out.push({
      kind: track.kind,
      x: layout.frontX + s.x * layout.pxPerM,
      y: layout.axisY - s.y * layout.pxPerM,
      angle: -s.angle,
      lengthPx: Math.max(MIN_FRAGMENT_PX, track.lengthM * layout.pxPerM),
      widthPx: Math.max(MIN_FRAGMENT_PX * 0.7, track.widthM * layout.pxPerM),
      hot: track.hot && fragmentT - track.t0 < 0.02,
      resting: s.resting,
    });
  }
  return out;
}

/** The dimension line along the plate: where it runs and what it says. */
export interface DimensionLine {
  x0: number;
  x1: number;
  y: number;
  label: string;
}

/** Distance of the dimension line above the bottom of the view, px. */
const DIMENSION_FROM_BOTTOM = 58;

const mmText = (m: number) => `${(m * 1000).toFixed(m < 0.01 ? 1 : 0)} mm`;

/** Line-of-sight thickness along the plate, with the plate's own thickness and slope when it is sloped. */
export function dimensionLine(timeline: ArmorTimeline, layout: SectionLayout): DimensionLine {
  const { shot, result } = timeline;
  const sloped = shot.obliquityDeg > 0.05;
  const label = sloped
    ? `line of sight ${mmText(result.losThicknessM)}  (plate ${mmText(shot.thicknessM)} at ${shot.obliquityDeg.toFixed(0)}°)`
    : `plate ${mmText(result.losThicknessM)}`;
  // Low on the plate, clear of the time readout and the overlay buttons along the top.
  return { x0: layout.frontX, x1: layout.rearX, y: Math.max(22, layout.height - DIMENSION_FROM_BOTTOM), label };
}

/**
 * Armor lab (#167): paints the cut-away cross-section onto a 2D canvas from the
 * shapes `section.ts` works out. Nothing here is physics: the plate, the crater
 * outline, the rear bulge, the penetrator and a heat glow driven by the energy
 * deposited so far. Field overlays for temperature, stress and pressure (#166)
 * plug in through `OverlayId`; only the energy overlay exists until those
 * models land.
 */

import type { PenetratorMaterial } from './munitions';
import type { EnergyBalance } from './fields';
import { TEACHING_NOTE, legendTicks, palette, paletteColor, type FieldOverlay } from './fieldOverlay';
import type { DimensionLine, DrawnFragment, Point, RoomShapes, SectionShapes } from './section';

/** The field shown over the plate: 'energy' is the heat glow, the others are the field models (#166), painted from `FieldOverlay`. */
export type OverlayId = 'none' | 'energy' | 'temperature' | 'stress' | 'pressure';

export const OVERLAYS: { id: OverlayId; label: string; ready: boolean; hint: string }[] = [
  { id: 'none', label: 'Plain section', ready: true, hint: 'The sawn plate only.' },
  { id: 'energy', label: 'Energy', ready: true, hint: 'Heat from the energy deposited so far: brighter and wider as the impact does more work.' },
  { id: 'temperature', label: 'Temperature', ready: true, hint: 'Heat in the metal in °C: hot at the crater wall, a shear band round a plug, melting in a jet or rod interface.' },
  { id: 'stress', label: 'Stress', ready: true, hint: 'Von Mises stress over yield: highest at the penetrator nose, 1 or more is plastic flow.' },
  { id: 'pressure', label: 'Pressure wave', ready: true, hint: 'The compression front spreading at the speed of sound (red) and reflecting off the rear face as tension (blue).' },
];

/** Colour of the penetrator, by its material. */
const PENETRATOR_COLOR: Record<PenetratorMaterial, string> = {
  steel: '#c4ccd8',
  'tungsten-alloy': '#8a8f99',
  copper: '#e39a55',
};

/** Heat colour ramp for the energy overlay: dark red to white-hot. `v` is 0 to 1. */
export function heatColor(v: number, alpha = 1): string {
  const t = Math.min(1, Math.max(0, v));
  const r = 255;
  const g = Math.round(40 + 215 * t ** 1.6);
  const b = Math.round(20 + 200 * t ** 3);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface SectionStyle {
  /** The plate's colour (from the material catalogue). */
  plateColor: string;
  penetratorMaterial: PenetratorMaterial;
  overlay: OverlayId;
  /** Draw the thin jet as a bright line. */
  jet: boolean;
}

function path(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/** What is drawn around the section: the dimension line, and the room and pieces thrown from the plate (#165). */
export interface SectionExtras {
  dimension?: DimensionLine;
  room?: RoomShapes | null;
  fragments?: DrawnFragment[];
  /** A field (#166) painted over the sawn plate, with its legend. */
  field?: FieldOverlay | null;
  /** The energy account, drawn as a bar. */
  energy?: EnergyBalance | null;
  /** A scale bar: its length in pixels and its label. */
  scaleBar?: { px: number; label: string } | null;
}

/** Colour of each kind of thrown piece. */
const FRAGMENT_COLOR: Record<DrawnFragment['kind'], string> = {
  plug: '#9aa3ad',
  scab: '#b4bcc6',
  penetrator: '#c4ccd8',
  shard: '#d0d6de',
  jet: '#e39a55',
  spall: '#a8b0ba',
};

/** Paints one frame. The canvas is cleared first. */
export function drawSection(ctx: CanvasRenderingContext2D, shapes: SectionShapes, style: SectionStyle, extras: SectionExtras = {}): void {
  const { layout } = shapes;
  const { width, height, plate, axisY } = layout;
  ctx.clearRect(0, 0, width, height);

  // The lab behind the section.
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#12151a');
  bg.addColorStop(1, '#0a0b0e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(0, axisY);
  ctx.lineTo(width, axisY);
  ctx.stroke();
  ctx.setLineDash([]);

  // The test room the pieces fly about in: floor, ceiling and outer walls.
  if (extras.room) drawRoom(ctx, extras.room, width);

  // The sawn plate, with the diagonal hatching of a section drawing.
  ctx.save();
  ctx.beginPath();
  ctx.rect(plate.x, plate.y, plate.width, plate.height);
  ctx.clip();
  const body = ctx.createLinearGradient(plate.x, 0, plate.x + plate.width, 0);
  body.addColorStop(0, style.plateColor);
  body.addColorStop(1, shade(style.plateColor, 0.82));
  ctx.fillStyle = body;
  ctx.fillRect(plate.x, plate.y, plate.width, plate.height);
  ctx.strokeStyle = 'rgba(0,0,0,0.13)';
  ctx.lineWidth = 1;
  const step = 9;
  for (let k = -plate.height; k < plate.width + plate.height; k += step) {
    ctx.beginPath();
    ctx.moveTo(plate.x + k, plate.y + plate.height);
    ctx.lineTo(plate.x + k + plate.height, plate.y);
    ctx.stroke();
  }

  // A field painted on the cut face: the coarse grid upscaled over the plate.
  if (extras.field) drawField(ctx, extras.field, plate);

  // The heat glow centred on the digging end of the crater, wider and brighter with energy deposited.
  if (style.overlay === 'energy' && !extras.field && shapes.heat > 0) {
    const cx = shapes.penetrator.noseX < plate.x ? plate.x : Math.min(shapes.penetrator.noseX, plate.x + plate.width);
    const radius = Math.max(40, plate.width * 0.9 * (0.35 + 0.65 * shapes.heat) + 30);
    const glow = ctx.createRadialGradient(cx, axisY, 0, cx, axisY, radius);
    glow.addColorStop(0, heatColor(1, 0.85 * shapes.heat + 0.1));
    glow.addColorStop(0.35, heatColor(0.55, 0.55 * shapes.heat));
    glow.addColorStop(1, heatColor(0.1, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(plate.x, plate.y, plate.width, plate.height);
  }
  ctx.restore();

  // The crater, cut out of the plate: dark inside, with a hot rim while it is still digging.
  if (shapes.crater.length) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    path(ctx, shapes.crater);
    ctx.fillStyle = '#07080a';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = style.overlay === 'energy' ? heatColor(0.4 + 0.6 * shapes.heat, 0.9) : 'rgba(255,255,255,0.35)';
    ctx.stroke();
    ctx.restore();
  }

  // The bulge pushed out of the rear face.
  if (shapes.bulge.length) {
    path(ctx, shapes.bulge);
    ctx.fillStyle = shade(style.plateColor, 0.9);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // The plate's faces.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(plate.x, 0);
  ctx.lineTo(plate.x, height);
  ctx.moveTo(plate.x + plate.width, 0);
  ctx.lineTo(plate.x + plate.width, height);
  ctx.stroke();

  // The penetrator (or a jet's tail), nose at the leading edge.
  const { noseX, tailX, radiusPx, hidden } = shapes.penetrator;
  if (!hidden && noseX - tailX > 0.5) {
    const color = PENETRATOR_COLOR[style.penetratorMaterial];
    if (style.jet) {
      ctx.save();
      ctx.shadowColor = '#ffb060';
      ctx.shadowBlur = 12;
      ctx.fillStyle = color;
      ctx.fillRect(tailX, axisY - Math.max(1.5, radiusPx), noseX - tailX, Math.max(3, radiusPx * 2));
      ctx.restore();
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tailX, axisY - radiusPx);
      ctx.lineTo(noseX - radiusPx * 0.6, axisY - radiusPx);
      ctx.quadraticCurveTo(noseX, axisY - radiusPx * 0.6, noseX, axisY);
      ctx.quadraticCurveTo(noseX, axisY + radiusPx * 0.6, noseX - radiusPx * 0.6, axisY + radiusPx);
      ctx.lineTo(tailX, axisY + radiusPx);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  if (extras.fragments) for (const f of extras.fragments) drawFragment(ctx, f);
  if (extras.dimension) drawDimension(ctx, extras.dimension);
  if (extras.field) drawLegend(ctx, extras.field, width, height);
  if (extras.energy) drawEnergyBar(ctx, extras.energy);
  if (extras.scaleBar) drawScaleBar(ctx, extras.scaleBar, height);
}

let overlayCanvas: HTMLCanvasElement | null = null;

/** Paints a field's RGBA grid over the plate, smoothed, clipped to the plate. */
function drawField(ctx: CanvasRenderingContext2D, field: FieldOverlay, plate: { x: number; y: number; width: number; height: number }): void {
  overlayCanvas ??= document.createElement('canvas');
  overlayCanvas.width = field.cols;
  overlayCanvas.height = field.rows;
  const octx = overlayCanvas.getContext('2d');
  if (!octx) return;
  octx.putImageData(new ImageData(new Uint8ClampedArray(field.rgba), field.cols, field.rows), 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(plate.x, plate.y, plate.width, plate.height);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(overlayCanvas, plate.x, plate.y, plate.width, plate.height);
  ctx.restore();
}

/** A colour bar down the right edge with ticks in real units, and the teaching-approximation note under it. */
function drawLegend(ctx: CanvasRenderingContext2D, field: FieldOverlay, width: number, height: number): void {
  const barW = 12;
  const barH = Math.min(150, height * 0.4);
  const x = width - barW - 70;
  const y = Math.max(96, height / 2 - barH / 2);
  ctx.save();
  const grad = ctx.createLinearGradient(0, y + barH, 0, y);
  const stops = palette(field.kind);
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const [r, g, b] = field.scale.diverging ? divergingStop(i / n) : paletteColor(stops, i / n);
    grad.addColorStop(i / n, `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, barW, barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, barW + 1, barH + 1);
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#e6e9ee';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 4;
  for (const tick of legendTicks(field.scale)) {
    const ty = y + barH * (1 - tick.position);
    ctx.fillRect(x + barW, ty - 0.5, 4, 1);
    ctx.fillText(tick.label, x + barW + 7, ty);
  }
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  ctx.fillText(field.scale.label, x + 70, y - 10);
  ctx.textAlign = 'left';
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(230,233,238,0.75)';
  ctx.fillText(TEACHING_NOTE, x - 70, y + barH + 16, 150);
  ctx.restore();
}

/** The legend bar's colours for a diverging scale: tension blue, dark centre, compression red. */
function divergingStop(v: number): [number, number, number] {
  const m = Math.abs(2 * v - 1);
  const base: [number, number, number] = v < 0.5 ? [66, 135, 245] : [245, 80, 60];
  const k = 0.35 + 0.65 * m;
  const c = 1 - m;
  return [base[0] * k * m + 24 * c, base[1] * k * m + 26 * c, base[2] * k * m + 32 * c];
}

/** Colours of the energy bar's segments, in order along it. */
export const ENERGY_SEGMENTS: { key: 'kineticJ' | 'heatJ' | 'plasticJ' | 'ejectaJ' | 'residualJ'; label: string; color: string }[] = [
  { key: 'kineticJ', label: 'kinetic', color: '#7fb4ff' },
  { key: 'heatJ', label: 'heat', color: '#ff8a3d' },
  { key: 'plasticJ', label: 'plastic', color: '#d4577a' },
  { key: 'ejectaJ', label: 'thrown metal', color: '#9aa3ad' },
  { key: 'residualJ', label: 'carried on', color: '#7ee0a0' },
];

/** The impact energy as a stacked bar: where it is right now. */
function drawEnergyBar(ctx: CanvasRenderingContext2D, e: EnergyBalance): void {
  if (!(e.impactJ > 0)) return;
  const x = 12;
  const y = 36;
  const w = 220;
  const h = 8;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x, y, w, h);
  let cursor = x;
  for (const seg of ENERGY_SEGMENTS) {
    const share = e[seg.key] / e.impactJ;
    if (share <= 0) continue;
    ctx.fillStyle = seg.color;
    ctx.fillRect(cursor, y, share * w, h);
    cursor += share * w;
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 3;
  let lx = x;
  for (const seg of ENERGY_SEGMENTS) {
    ctx.fillStyle = seg.color;
    ctx.fillRect(lx, y + h + 5, 7, 7);
    ctx.fillStyle = 'rgba(230,233,238,0.85)';
    ctx.fillText(seg.label, lx + 10, y + h + 4);
    lx += 10 + ctx.measureText(seg.label).width + 9;
  }
  ctx.restore();
}

/** A scale bar bottom left: a bar with end ticks and its length. */
function drawScaleBar(ctx: CanvasRenderingContext2D, bar: { px: number; label: string }, height: number): void {
  const x = 14;
  const y = height - 58;
  ctx.save();
  ctx.strokeStyle = '#e6e9ee';
  ctx.fillStyle = '#e6e9ee';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + bar.px, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + bar.px, y - 4);
  ctx.lineTo(x + bar.px, y + 4);
  ctx.stroke();
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 4;
  ctx.fillText(bar.label, x, y - 9);
  ctx.restore();
}


function drawRoom(ctx: CanvasRenderingContext2D, room: RoomShapes, width: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, room.floorY);
  ctx.lineTo(width, room.floorY);
  ctx.stroke();
  // The floor, hatched below the line, and the two outer walls.
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, room.floorY, width, 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(room.leftX, room.ceilingY);
  ctx.lineTo(room.leftX, room.floorY);
  ctx.moveTo(room.rightX, room.ceilingY);
  ctx.lineTo(room.rightX, room.floorY);
  ctx.moveTo(0, room.ceilingY);
  ctx.lineTo(width, room.ceilingY);
  ctx.stroke();
  ctx.restore();
}

function drawFragment(ctx: CanvasRenderingContext2D, f: DrawnFragment): void {
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.angle);
  if (f.hot) {
    ctx.shadowColor = '#ff9a40';
    ctx.shadowBlur = 10;
  }
  ctx.fillStyle = f.hot ? heatColor(0.7) : FRAGMENT_COLOR[f.kind];
  ctx.fillRect(-f.lengthPx / 2, -f.widthPx / 2, f.lengthPx, f.widthPx);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(-f.lengthPx / 2, -f.widthPx / 2, f.lengthPx, f.widthPx);
  ctx.restore();
}

/** The line-of-sight dimension along the top of the plate: arrowheads at both faces and a label above. */
function drawDimension(ctx: CanvasRenderingContext2D, d: DimensionLine): void {
  ctx.save();
  ctx.strokeStyle = '#e6e9ee';
  ctx.fillStyle = '#e6e9ee';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(d.x0, d.y);
  ctx.lineTo(d.x1, d.y);
  for (const [x, dir] of [[d.x0, 1], [d.x1, -1]] as const) {
    ctx.moveTo(x, d.y);
    ctx.lineTo(x + dir * 7, d.y - 3.5);
    ctx.moveTo(x, d.y);
    ctx.lineTo(x + dir * 7, d.y + 3.5);
    ctx.moveTo(x, d.y - 7);
    ctx.lineTo(x, d.y + 7);
  }
  ctx.stroke();
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 4;
  ctx.fillText(d.label, (d.x0 + d.x1) / 2, d.y - 9);
  ctx.restore();
}

/** Darkens a `#rrggbb` colour by a factor (1 keeps it). */
export function shade(hex: string, factor: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v * factor)));
  const r = c((n >> 16) & 255);
  const g = c((n >> 8) & 255);
  const b = c(n & 255);
  return `rgb(${r}, ${g}, ${b})`;
}

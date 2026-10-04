/**
 * Armor lab (#171): the geometry of a stack on the cross-section. The plates
 * sit side by side along the unfolded shot line with their air gaps drawn at
 * scale, each one laid out like the single plate of `section.ts` (so every
 * overlay, crater and fragment helper works per plate), and the round is drawn
 * wherever it is on the stack's clock: in a plate, or crossing a gap.
 *
 * Pure (no canvas): it turns a `StackTimeline` and a time into the shapes to
 * paint. A stack of one plate lays out exactly as `sectionLayout` does.
 */

import { ROOM_HALF_HEIGHT_FACTOR } from './fragments';
import { frameAt, viewMargin, type ArmorFrame } from './model';
import { sectionShapes, type DimensionLine, type SectionLayout, type SectionShapes } from './section';
import type { StackStage, StackTimeline } from './stack';

/** One layout per plate, sharing one scale and one shot line. */
export interface StackLayout {
  width: number;
  height: number;
  /** Pixels per metre, the same for every plate. */
  pxPerM: number;
  axisY: number;
  /** Where each stage's plate sits, in the stage's own `SectionLayout`. */
  stages: SectionLayout[];
}

/** Total path from the first plate's front face to the last plate's rear face, m. */
export function stackPathM(stack: StackTimeline): number {
  const last = stack.stages[stack.stages.length - 1];
  return last.startM + last.timeline.result.losThicknessM;
}

/**
 * Fits the plates, their gaps and some air either side into a canvas. The
 * scale is the width of the whole path plus the air either side, or smaller if
 * the canvas is too flat to show the floor and ceiling of the last plate's
 * fragment room; the stack is centred. Only the plates the round reached are
 * laid out (the others are never touched).
 */
export function stackLayout(stack: StackTimeline, width: number, height: number): StackLayout {
  const pathM = stackPathM(stack);
  const lastLos = stack.stages[stack.stages.length - 1].timeline.result.losThicknessM;
  const margin = viewMargin(pathM);
  const viewM = pathM + 2 * margin;
  const roomHeightM = 2 * ROOM_HALF_HEIGHT_FACTOR * viewMargin(lastLos);
  const pxPerM = Math.min(width / viewM, height / roomHeightM);
  const x0 = (width - pathM * pxPerM) / 2;
  const stages = stack.stages.map((stage): SectionLayout => {
    const frontX = x0 + stage.startM * pxPerM;
    const rearX = frontX + stage.timeline.result.losThicknessM * pxPerM;
    return { width, height, pxPerM, frontX, rearX, axisY: height / 2, plate: { x: frontX, y: 0, width: rearX - frontX, height } };
  });
  return { width, height, pxPerM, axisY: height / 2, stages };
}

/** The stage the round is at on the stack's clock: the last whose impact has started (the first before any has). */
export function activeStage(stack: StackTimeline, t: number): number {
  let active = 0;
  for (const s of stack.stages) if (s.offsetT <= t) active = s.index;
  return active;
}

/** A stage's frame at time `localT` (s since its own impact), carrying on past its last frame: a round still flying keeps moving at its last speed. */
export function extendedFrame(stage: StackStage, localT: number): ArmorFrame {
  const { frames, duration } = stage.timeline;
  const frame = frameAt(stage.timeline, Math.max(0, localT));
  if (localT <= duration) return frame;
  const last = frames[frames.length - 1];
  return { ...frame, t: localT, travel: last.travel + last.speed * (localT - duration) };
}

export interface StackStageShapes {
  index: number;
  /** Time since this plate's own impact, s (negative before the round gets there). */
  localT: number;
  frame: ArmorFrame;
  shapes: SectionShapes;
}

/**
 * The shapes for every plate at stack time `t`, with fragments timed at
 * `fragmentT` (the same clock, s). The penetrator is drawn only in the plate
 * the round is at (or crossing the gap in front of the next plate, never
 * past it).
 */
export function stackShapes(stack: StackTimeline, t: number, fragmentT: number, layout: StackLayout): StackStageShapes[] {
  const active = activeStage(stack, t);
  return stack.stages.map((stage) => {
    const localT = t - stage.offsetT;
    const stageLayout = layout.stages[stage.index];
    const frame = extendedFrame(stage, localT);
    const shapes = sectionShapes(stage.timeline, frame, stageLayout, fragmentT - stage.offsetT);
    if (stage.index !== active) shapes.penetrator.hidden = true;
    else {
      // The round never gets past the front of the next plate before that plate's own impact begins.
      const next = layout.stages[stage.index + 1];
      if (next && shapes.penetrator.noseX > next.frontX) {
        const length = shapes.penetrator.noseX - shapes.penetrator.tailX;
        shapes.penetrator.noseX = next.frontX;
        shapes.penetrator.tailX = next.frontX - length;
      }
    }
    return { index: stage.index, localT, frame, shapes };
  });
}

const mmText = (m: number) => `${(m * 1000).toFixed(m < 0.01 ? 1 : 0)} mm`;

/** Short plate thickness dimension lines for a stack's plates (just the line-of-sight thickness, no slope text), and the gaps between them. */
export function stackDimensions(stack: StackTimeline, layout: StackLayout): DimensionLine[] {
  const y = Math.max(22, layout.height - 58);
  const lines: DimensionLine[] = [];
  for (const stage of stack.stages) {
    const l = layout.stages[stage.index];
    if (stage.index > 0) {
      const prev = layout.stages[stage.index - 1];
      lines.push({ x0: prev.rearX, x1: l.frontX, y, label: `gap ${mmText(stage.gapLosM)}` });
    }
    lines.push({ x0: l.frontX, x1: l.rearX, y, label: mmText(stage.timeline.result.losThicknessM) });
  }
  return lines;
}

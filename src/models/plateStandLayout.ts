import { LARGE_PLATE_IDS } from '../data/media';
import type { Vec3 } from '../sim/types';

/**
 * Where the parts of a proving-ground plate stand go (#232, #234), as plain
 * boxes so the layout can be tested without three.js or a canvas. The frame
 * is a layer's local frame: the plate runs from x = 0 to its thickness, y = 0
 * is the shot line and the ground is at y = -shotY.
 *
 * The plate's foot is set in the slot of a cast concrete footing, its edges
 * ride in the channels of two H-section columns, and each column is held by a
 * raking brace down to a base plate on the ground beyond the edge. All of it
 * sits under the plate or beside it in its own plane, so spaced and bolted
 * plate stacks never meet each other's stands, and nothing stands on the shot
 * line behind the plate.
 */

/** Proving-ground plates: too heavy for a chain hanger, they stand in a footing. */
export function isLargePlate(spec: { id: string }): boolean {
  return (LARGE_PLATE_IDS as readonly string[]).includes(spec.id);
}

/** Sizes of the stand, m. */
export const PLATE_STAND = {
  /** How far the plate's foot is sunk into the footing's slot. */
  slotM: 0.15,
  footingH: 0.3,
  /** Footing reach past the plate on each face, and beyond the columns at each end. */
  footingLipM: 0.06,
  footingEndM: 0.3,
  /** H-column flange width, and how far the plate edge reaches into its channel. */
  columnM: 0.2,
  gripM: 0.03,
  /** Raking brace: where it meets the column (fraction of plate height) and how far out its foot lands. */
  braceAt: 0.7,
  braceReachM: 1.0,
} as const;

export type StandMaterial = 'concrete' | 'steel';

export type StandPart =
  | { kind: 'box'; material: StandMaterial; center: Vec3; size: Vec3 }
  /** A square-section member from `from` to `to`, `width` along x and `depth` across. */
  | { kind: 'brace'; from: Vec3; to: Vec3; width: number; depth: number }
  /** A half-ring lifting lug standing on the top edge. */
  | { kind: 'lug'; at: Vec3; radius: number };

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export function plateStandParts(plate: { heightM: number; widthM: number }, t: number, shotY: number): StandPart[] {
  const S = PLATE_STAND;
  const parts: StandPart[] = [];
  const steel = (center: Vec3, size: Vec3) => parts.push({ kind: 'box', material: 'steel', center, size });
  const floor = -shotY;
  const plateBottom = -plate.heightM / 2;
  const plateTop = plate.heightM / 2;
  const cx = t / 2;
  const edge = plate.widthM / 2;

  // The footing beam, its top a slot's depth above the plate's foot, and a steel shoe angle along each face.
  const footTop = Math.max(floor, plateBottom) + S.slotM;
  const footBottom = footTop - S.footingH;
  const colZ = edge + S.columnM / 2 - S.gripM;
  const outer = colZ + S.columnM / 2;
  parts.push({
    kind: 'box',
    material: 'concrete',
    center: v(cx, (footTop + footBottom) / 2, 0),
    size: v(t + 2 * S.footingLipM, S.footingH, 2 * (outer + S.footingEndM)),
  });
  for (const sx of [-1, 1]) steel(v(cx + sx * (t / 2 + 0.006), footTop + 0.04, 0), v(0.012, 0.08, plate.widthM));

  // The H-columns either side: two flanges on the plate's faces and a web beyond its edge.
  const colH = plateTop + 0.1 - footTop;
  const flangeD = t + 0.06;
  for (const sz of [-1, 1]) {
    const z = sz * colZ;
    const y = footTop + colH / 2;
    for (const sx of [-1, 1]) steel(v(cx + (sx * flangeD) / 2, y, z), v(0.02, colH, S.columnM));
    steel(v(cx, y, sz * (outer - 0.01)), v(flangeD, colH, 0.02));
    // A cap plate on top, and a base plate bolted to the footing.
    steel(v(cx, footTop + colH + 0.01, z), v(flangeD + 0.04, 0.02, S.columnM + 0.04));
    steel(v(cx, footTop + 0.0125, z), v(flangeD + 0.12, 0.025, S.columnM + 0.12));

    // The raking brace, in the plate's plane: from the column's outer face down to a base plate on the ground.
    const footZ = sz * (outer + S.braceReachM);
    parts.push({ kind: 'brace', from: v(cx, plateBottom + plate.heightM * S.braceAt, sz * (outer + 0.05)), to: v(cx, floor + 0.03, footZ), width: Math.min(0.12, flangeD), depth: 0.1 });
    steel(v(cx, floor + 0.015, footZ), v(0.3, 0.03, 0.3));
  }

  // Two lifting lugs on the top edge, as on any plate set by crane.
  for (const sz of [-1, 1]) parts.push({ kind: 'lug', at: v(cx, plateTop, sz * edge * 0.6), radius: 0.05 });
  return parts;
}

/** An axis-aligned box round a part: min and max corners. */
export function partBounds(p: StandPart): { min: Vec3; max: Vec3 } {
  if (p.kind === 'box') {
    return { min: v(p.center.x - p.size.x / 2, p.center.y - p.size.y / 2, p.center.z - p.size.z / 2), max: v(p.center.x + p.size.x / 2, p.center.y + p.size.y / 2, p.center.z + p.size.z / 2) };
  }
  if (p.kind === 'lug') {
    const r = p.radius + 0.015;
    return { min: v(p.at.x - 0.015, p.at.y - 0.015, p.at.z - r), max: v(p.at.x + 0.015, p.at.y + r, p.at.z + r) };
  }
  const h = Math.max(p.width, p.depth) / 2;
  return {
    min: v(Math.min(p.from.x, p.to.x) - h, Math.min(p.from.y, p.to.y) - h, Math.min(p.from.z, p.to.z) - h),
    max: v(Math.max(p.from.x, p.to.x) + h, Math.max(p.from.y, p.to.y) + h, Math.max(p.from.z, p.to.z) + h),
  };
}

/**
 * Plates bolted face to face (no gap) share one stand: for each layer, the
 * thickness its stand grips (the whole bolted block, on its first plate), or
 * null when it rides in the stand of the plate before it. Layers that are not
 * large plates keep their own thickness.
 */
export function plateStandSpans(layers: readonly { medium: { id: string }; thickness: number; gapM?: number }[]): (number | null)[] {
  const spans: (number | null)[] = layers.map((l) => l.thickness);
  let head = -1;
  layers.forEach((l, i) => {
    if (!isLargePlate(l.medium)) {
      head = -1;
      return;
    }
    if (head >= 0 && (l.gapM ?? 0) <= 1e-9) {
      spans[head] = (spans[head] ?? 0) + l.thickness;
      spans[i] = null;
    } else head = i;
  });
  return spans;
}

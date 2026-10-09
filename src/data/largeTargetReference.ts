import { getPlateMaterial, type PlateMaterialId } from '../armor/materials';

/**
 * Reference figures for the targets the Artillery and Missile modes shoot at (#262), the large-target
 * counterpart of concreteReference.ts. Each figure says what kind of number it is, so a reviewer never
 * mistakes a tuning constant for a measurement:
 *  - `published`: a rounded handbook or standard figure, with its source;
 *  - `model`: a constant tuned for the engine (`data/media.ts`), not a measurement;
 *  - `illustrative`: drawn for the look only, with no measured data behind it.
 * Nothing here is measured by this project.
 */
export type FigureStatus = 'published' | 'model' | 'illustrative';

export interface ReferenceFigure {
  name: string;
  value: number;
  unit: string;
  status: FigureStatus;
  source: string;
}

export interface LargeTargetReference {
  /** A medium id in `data/media.ts`. */
  mediumId: string;
  /** Plate catalogue entry the steel figures come from, for steel targets. */
  plateMaterial?: PlateMaterialId;
  figures: ReferenceFigure[];
  /** Replay link: fires the setup and parks the replay at a set time after contact (`CHECKLIST.md`). */
  replay: string;
}

const HANDBOOK = 'Handbook data (ASM / MatWeb), as in src/armor/materials.ts';

/** Steel figures come straight from the sourced Armor lab catalogue, so the two never disagree. */
function steelFigures(id: PlateMaterialId): ReferenceFigure[] {
  const m = getPlateMaterial(id);
  return [
    { name: 'Density', value: m.density, unit: 'kg/m³', status: 'published', source: HANDBOOK },
    { name: 'Yield strength', value: m.yieldPa, unit: 'Pa', status: 'published', source: HANDBOOK },
    { name: 'Brinell hardness', value: m.brinell, unit: 'HB', status: 'published', source: HANDBOOK },
    { name: 'Target resistance Rt', value: m.targetResistancePa, unit: 'Pa', status: 'published', source: 'Alekseevskii–Tate values in the open literature (Anderson & Walker; Zukas, Impact Dynamics), as in src/armor/materials.ts' },
  ];
}

export const LARGE_TARGET_REFERENCE: readonly LargeTargetReference[] = [
  {
    mediumId: 'rha-plate', plateMaterial: 'rha', replay: '?mode=artillery&bullet=76mm-ap&medium=rha-plate&at=1ms',
    figures: steelFigures('rha'),
  },
  {
    mediumId: 'mild-plate', plateMaterial: 'mild-steel', replay: '?mode=artillery&bullet=122mm-ap&medium=mild-plate&at=1ms',
    figures: steelFigures('mild-steel'),
  },
  {
    mediumId: 'cast-iron-plate', plateMaterial: 'cast-iron', replay: '?mode=artillery&bullet=76mm-ap&medium=cast-iron-plate&at=1ms',
    figures: steelFigures('cast-iron'),
  },
  {
    mediumId: 'ar500-plate', replay: '?mode=missile&medium=ar500-plate&at=1ms',
    figures: [
      { name: 'Density', value: 7850, unit: 'kg/m³', status: 'published', source: 'Steel density, as for RHA' },
      { name: 'Brinell hardness (nominal)', value: 500, unit: 'HB', status: 'published', source: 'The grade name: AR500 is rated about 500 HB' },
      { name: 'Resistance (engine constant)', value: 3.2e9, unit: 'Pa', status: 'model', source: 'resistancePa in data/media.ts, tuned, not measured' },
    ],
  },
  {
    mediumId: 'reinforced-concrete', replay: '?mode=artillery&bullet=122mm-ap&medium=reinforced-concrete&at=3ms',
    figures: [
      { name: 'Density', value: 2400, unit: 'kg/m³', status: 'published', source: 'Typical reinforced concrete, handbook value' },
      { name: 'Resistance (engine constant)', value: 750e6, unit: 'Pa', status: 'model', source: 'resistancePa in data/media.ts, tuned, not measured' },
      { name: 'Spall and scab shape', value: 0, unit: '', status: 'illustrative', source: 'Scaled from the bullet-scale panels in concreteReference.ts; no measurement at shell scale' },
    ],
  },
  {
    mediumId: 'packed-earth', replay: '?mode=artillery&bullet=122mm-ap&medium=packed-earth&at=3ms',
    figures: [
      { name: 'Density', value: 1800, unit: 'kg/m³', status: 'published', source: 'Typical compacted soil, handbook value' },
      { name: 'Resistance (engine constant)', value: 25e6, unit: 'Pa', status: 'model', source: 'resistancePa in data/media.ts, tuned, not measured' },
      { name: 'Soil column and crater', value: 0, unit: '', status: 'illustrative', source: 'Drawn for the look; no measured data' },
    ],
  },
  // Full-size proving-ground targets (#231). Armour steel figures are the sourced RHA ones; the engine constants are tuned.
  {
    mediumId: 'tank-hull', plateMaterial: 'rha', replay: '?mode=artillery&bullet=76mm-ap&medium=tank-hull&at=1ms',
    figures: [...steelFigures('rha'), { name: 'Hull side thickness', value: 0.07, unit: 'm', status: 'illustrative', source: 'The default thickness in data/media.ts, chosen so shells separate; not a real vehicle' }],
  },
  {
    mediumId: 'turret-roof', plateMaterial: 'rha', replay: '?mode=missile&medium=turret-roof&at=1ms',
    figures: [...steelFigures('rha'), { name: 'Roof thickness', value: 0.04, unit: 'm', status: 'illustrative', source: 'The default thickness in data/media.ts; not a real vehicle' }],
  },
  {
    mediumId: 'hull-floor', plateMaterial: 'rha', replay: '?mode=missile&medium=hull-floor&at=1ms',
    figures: [...steelFigures('rha'), { name: 'Floor thickness', value: 0.02, unit: 'm', status: 'illustrative', source: 'The default thickness in data/media.ts; not a real vehicle' }],
  },
  {
    mediumId: 'bunker-wall', replay: '?mode=artillery&bullet=122mm-ap&medium=bunker-wall&at=3ms',
    figures: [
      { name: 'Density', value: 2400, unit: 'kg/m³', status: 'published', source: 'Typical reinforced concrete, handbook value' },
      { name: 'Resistance (engine constant)', value: 750e6, unit: 'Pa', status: 'model', source: 'resistancePa in data/media.ts, tuned, not measured' },
      { name: 'Crater, spall and scab shape', value: 0, unit: '', status: 'illustrative', source: 'Scaled from the bullet-scale panels in concreteReference.ts; no measurement at shell scale' },
    ],
  },
  {
    mediumId: 'block-house-wall', replay: '?mode=artillery&bullet=122mm-ap&medium=block-house-wall&at=3ms',
    figures: [
      { name: 'Density', value: 2400, unit: 'kg/m³', status: 'published', source: 'Typical reinforced concrete, handbook value' },
      { name: 'Resistance (engine constant)', value: 750e6, unit: 'Pa', status: 'model', source: 'resistancePa in data/media.ts, tuned, not measured' },
    ],
  },
  {
    mediumId: 'brick-wall-full', replay: '?mode=artillery&bullet=122mm-ap&medium=brick-wall-full&at=3ms',
    figures: [
      { name: 'Density', value: 1900, unit: 'kg/m³', status: 'published', source: 'Typical fired clay brick masonry, handbook value' },
      { name: 'Resistance (engine constant)', value: 120e6, unit: 'Pa', status: 'model', source: 'resistancePa in data/media.ts, tuned, not measured' },
      { name: 'Breach spray of brick and mortar', value: 0, unit: '', status: 'illustrative', source: 'Drawn for the look; no measured data' },
    ],
  },
  {
    mediumId: 'earth-berm-full', replay: '?mode=artillery&bullet=122mm-ap&medium=earth-berm-full&at=3ms',
    figures: [
      { name: 'Density', value: 1800, unit: 'kg/m³', status: 'published', source: 'Typical compacted soil, handbook value' },
      { name: 'Resistance (engine constant)', value: 25e6, unit: 'Pa', status: 'model', source: 'resistancePa in data/media.ts, tuned, not measured' },
      { name: 'Soil column and crater', value: 0, unit: '', status: 'illustrative', source: 'Drawn for the look; no measured data' },
    ],
  },
];

/** The reference entry for a medium, or undefined if it has none. */
export function largeTargetReference(mediumId: string): LargeTargetReference | undefined {
  return LARGE_TARGET_REFERENCE.find((r) => r.mediumId === mediumId);
}

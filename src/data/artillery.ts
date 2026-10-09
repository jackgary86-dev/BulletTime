import type { BlastSpec, BulletSpec } from './bullets';

/**
 * The Artillery simulator's shells (#180): armour-piercing and penetrator rounds
 * only, grouped like the classes in the public artillery lists: autocannon,
 * anti-tank and field guns, and tank guns. Masses and speeds are rounded, typical
 * values for each calibre; the APHE fills and fragment counts are tuned for the
 * look and the physics, not taken from any specification. High-explosive, HEAT,
 * HESH and mortar shells are not in the catalogue.
 */
const GRAINS_PER_KG = 15432.36;
const gr = (kg: number): number => Math.round(kg * GRAINS_PER_KG);

type Kind = 'ap' | 'aphe' | 'apcr' | 'apds' | 'dart';

interface ShellRow {
  id: string;
  group: string;
  calibreMm: number;
  /** Public class name, e.g. "Anti-tank gun", never a specific weapon. */
  name: string;
  kind: Kind;
  lengthMm: number;
  /** Mass that strikes, in kg: for a sub-calibre round (APCR, APDS, APFSDS), its core, since the carrier or sabot falls away. */
  massKg: number;
  speedMs: number;
  /** Diameter of the hard core that does the work in a sub-calibre round (APCR, APDS, APFSDS), in mm. */
  coreMm?: number;
  /** TNT-equivalent filler of an APHE shell, in kg. */
  fillKg?: number;
}

const KIND_LABEL: Record<Kind, string> = { ap: 'AP', aphe: 'APHE', apcr: 'APCR (HVAP)', apds: 'APDS', dart: 'APFSDS' };

const KIND_TEXT: Record<Kind, string> = {
  ap: 'Solid armour-piercing shot: a dense steel core that defeats plate and walls without exploding.',
  aphe: 'Armour-piercing with a small explosive filler and a base fuze: it punches through the plate, then bursts behind it.',
  apcr: 'A light shell carrying a narrow tungsten-carbide core: fast off the gun, with all its punch on the core, but it slows quickly with range.',
  apds: 'A short tungsten core fired inside a full-calibre sabot that falls away at the muzzle: much faster and narrower than full-calibre shot.',
  dart: 'A long dense dart fired inside a discarding sabot. All its energy is on a few centimetres of frontage.',
};

function blastOf(row: ShellRow): BlastSpec | undefined {
  const fill = row.fillKg ?? 0;
  switch (row.kind) {
    case 'aphe':
      // A hard core with a small filler: it goes through, then bursts inside.
      return { yieldKg: fill, fragmentCount: 26, fragmentSpeedMs: 1000, delayM: Math.max(0.08, row.calibreMm / 400), fireball: 'standard' };
    default:
      return undefined;
  }
}

function shell(row: ShellRow): BulletSpec {
  const blast = blastOf(row);
  return {
    id: row.id,
    mode: 'artillery',
    group: row.group,
    name: `${row.calibreMm} mm ${row.name}`,
    type: KIND_LABEL[row.kind],
    description: KIND_TEXT[row.kind],
    // A sub-calibre round's core is much narrower than its gun.
    caliberMm: row.coreMm ?? (row.kind === 'dart' ? 32 : row.calibreMm),
    lengthMm: row.lengthMm,
    massGrains: gr(row.massKg),
    muzzleVelocityMs: row.speedMs,
    behaviour: row.kind === 'aphe' ? 'explosive' : 'intact',
    shape: row.kind === 'dart' ? 'dart' : 'cannonShell',
    noseDragFactor: 0.35,
    // Every shell here is a hard core: it keeps its frontage and does not tumble in armour.
    hardCore: true,
    blast,
  };
}

const ROWS: ShellRow[] = [
  // Autocannon
  { id: '20mm-ap', group: 'Autocannon', calibreMm: 20, name: 'autocannon', kind: 'ap', lengthMm: 85, massKg: 0.11, speedMs: 1000 },
  { id: '25mm-apds', group: 'Autocannon', calibreMm: 25, name: 'autocannon', kind: 'apds', coreMm: 15, lengthMm: 60, massKg: 0.07, speedMs: 1340 },
  { id: '30mm-ap', group: 'Autocannon', calibreMm: 30, name: 'autocannon', kind: 'ap', lengthMm: 130, massKg: 0.36, speedMs: 1000 },
  { id: '30mm-apfsds', group: 'Autocannon', calibreMm: 30, name: 'autocannon', kind: 'dart', coreMm: 14, lengthMm: 120, massKg: 0.24, speedMs: 1400 },
  // Anti-tank and field guns
  { id: '37mm-ap', group: 'Anti-tank and field guns', calibreMm: 37, name: 'anti-tank gun', kind: 'ap', lengthMm: 130, massKg: 0.65, speedMs: 800 },
  { id: '45mm-ap', group: 'Anti-tank and field guns', calibreMm: 45, name: 'anti-tank gun', kind: 'ap', lengthMm: 170, massKg: 1.4, speedMs: 760 },
  { id: '50mm-ap', group: 'Anti-tank and field guns', calibreMm: 50, name: 'anti-tank gun', kind: 'ap', lengthMm: 200, massKg: 2.1, speedMs: 835 },
  { id: '57mm-ap', group: 'Anti-tank and field guns', calibreMm: 57, name: 'anti-tank gun', kind: 'ap', lengthMm: 230, massKg: 2.8, speedMs: 1000 },
  { id: '57mm-apds', group: 'Anti-tank and field guns', calibreMm: 57, name: 'anti-tank gun', kind: 'apds', coreMm: 28, lengthMm: 120, massKg: 0.6, speedMs: 1200 },
  { id: '75mm-apcbc', group: 'Anti-tank and field guns', calibreMm: 75, name: 'anti-tank gun', kind: 'ap', lengthMm: 300, massKg: 6.8, speedMs: 790 },
  { id: '76mm-ap', group: 'Anti-tank and field guns', calibreMm: 76, name: 'anti-tank gun', kind: 'ap', lengthMm: 330, massKg: 7.7, speedMs: 880 },
  { id: '76mm-hvap', group: 'Anti-tank and field guns', calibreMm: 76, name: 'anti-tank gun', kind: 'apcr', coreMm: 38, lengthMm: 250, massKg: 1.6, speedMs: 1035 },
  { id: '76mm-aphe', group: 'Anti-tank and field guns', calibreMm: 76, name: 'anti-tank gun', kind: 'aphe', lengthMm: 330, massKg: 6.9, speedMs: 800, fillKg: 0.09 },
  { id: '88mm-ap', group: 'Anti-tank and field guns', calibreMm: 88, name: 'dual-purpose gun', kind: 'ap', lengthMm: 420, massKg: 10.2, speedMs: 1000 },
  { id: '88mm-apcr', group: 'Anti-tank and field guns', calibreMm: 88, name: 'dual-purpose gun', kind: 'apcr', coreMm: 40, lengthMm: 380, massKg: 2.0, speedMs: 1130 },
  { id: '88mm-aphe', group: 'Anti-tank and field guns', calibreMm: 88, name: 'dual-purpose gun', kind: 'aphe', lengthMm: 420, massKg: 10.2, speedMs: 800, fillKg: 0.15 },
  { id: '100mm-ap', group: 'Anti-tank and field guns', calibreMm: 100, name: 'field gun', kind: 'ap', lengthMm: 400, massKg: 15.9, speedMs: 895 },
  // Tank guns
  { id: '105mm-apds', group: 'Tank guns', calibreMm: 105, name: 'tank gun', kind: 'apds', coreMm: 54, lengthMm: 250, massKg: 2.5, speedMs: 1470 },
  { id: '105mm-apfsds', group: 'Tank guns', calibreMm: 105, name: 'tank gun', kind: 'dart', coreMm: 27, lengthMm: 550, massKg: 3.7, speedMs: 1500 },
  { id: '120mm-apfsds', group: 'Tank guns', calibreMm: 120, name: 'tank gun', kind: 'dart', lengthMm: 700, massKg: 4.0, speedMs: 1500 },
  { id: '122mm-ap', group: 'Tank guns', calibreMm: 122, name: 'heavy tank gun', kind: 'ap', lengthMm: 450, massKg: 25, speedMs: 800 },
  { id: '125mm-apfsds', group: 'Tank guns', calibreMm: 125, name: 'tank gun', kind: 'dart', coreMm: 30, lengthMm: 620, massKg: 4.9, speedMs: 1750 },
];

export const ARTILLERY: BulletSpec[] = ROWS.map(shell);

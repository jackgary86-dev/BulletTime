import type { BlastSpec, BulletSpec } from './bullets';

/**
 * The Artillery simulator's shells, 20 mm up to 240 mm (#180), grouped like the
 * classes in the public artillery lists: autocannon, anti-tank and field guns,
 * mortars, recoilless rifles, howitzers and tank guns. Masses and speeds are
 * rounded, typical values for each calibre; fills and fragment counts are tuned
 * for the look and the physics, not taken from any specification. The 20 mm HEI
 * shell is shared with the Bullet simulator.
 */
const GRAINS_PER_KG = 15432.36;
const gr = (kg: number): number => Math.round(kg * GRAINS_PER_KG);

type Kind = 'ap' | 'he' | 'heat' | 'hesh' | 'dart';

interface ShellRow {
  id: string;
  group: string;
  calibreMm: number;
  /** Public class name, e.g. "Anti-tank gun", never a specific weapon. */
  name: string;
  kind: Kind;
  lengthMm: number;
  massKg: number;
  speedMs: number;
  /** TNT-equivalent fill for explosive shells, in kg. */
  fillKg?: number;
}

const KIND_LABEL: Record<Kind, string> = { ap: 'AP', he: 'HE', heat: 'HEAT', hesh: 'HESH', dart: 'APFSDS' };

const KIND_TEXT: Record<Kind, string> = {
  ap: 'Solid armour-piercing shot: a dense steel core that defeats plate and walls without exploding.',
  he: 'High-explosive shell with a nose fuze. It bursts on the face and throws fragments.',
  heat: 'A shaped-charge shell. On contact the charge fires a narrow, very fast jet that bores through armour.',
  hesh: 'A squash-head shell: a plastic charge that spreads on the face, then fires and spalls the far side.',
  dart: 'A long dense dart fired inside a discarding sabot. All its energy is on a few centimetres of frontage.',
};

function blastOf(row: ShellRow): BlastSpec | undefined {
  const fill = row.fillKg ?? 0;
  switch (row.kind) {
    case 'he':
      return { yieldKg: fill, fragmentCount: Math.min(64, 30 + Math.round(row.calibreMm / 5)), fragmentSpeedMs: 1300 + Math.min(200, row.calibreMm), fireball: 'standard' };
    case 'heat':
      return { yieldKg: fill, fragmentCount: 12, fragmentSpeedMs: 1100, jet: { count: 6, speedMs: 7500, massFraction: Math.min(0.12, 0.04 + row.calibreMm / 1500) }, fireball: 'standard' };
    case 'hesh':
      // The far-face spall is thrown as a wide fan of fast fragments.
      return { yieldKg: fill, fragmentCount: 40, fragmentSpeedMs: 900, fragmentMassFraction: 0.3, fireball: 'standard' };
    default:
      return undefined;
  }
}

function shell(row: ShellRow): BulletSpec {
  const blast = blastOf(row);
  const kinetic = row.kind === 'ap' || row.kind === 'dart';
  return {
    id: row.id,
    mode: 'artillery',
    group: row.group,
    name: `${row.calibreMm} mm ${row.name}`,
    type: KIND_LABEL[row.kind],
    description: KIND_TEXT[row.kind],
    // A discarding-sabot dart is much narrower than its gun.
    caliberMm: row.kind === 'dart' ? 26 : row.calibreMm,
    lengthMm: row.lengthMm,
    massGrains: gr(row.massKg),
    muzzleVelocityMs: row.speedMs,
    behaviour: kinetic ? 'intact' : 'explosive',
    shape: row.kind === 'dart' ? 'dart' : 'cannonShell',
    noseDragFactor: kinetic ? 0.35 : 0.5,
    yawNeckM: kinetic ? 0.5 : undefined,
    blast,
  };
}

const ROWS: ShellRow[] = [
  // Autocannon (20 mm HEI is the Bullet simulator's, listed first below)
  { id: '23mm-he', group: 'Autocannon', calibreMm: 23, name: 'autocannon', kind: 'he', lengthMm: 115, massKg: 0.19, speedMs: 970, fillKg: 0.015 },
  { id: '30mm-ap', group: 'Autocannon', calibreMm: 30, name: 'autocannon', kind: 'ap', lengthMm: 130, massKg: 0.36, speedMs: 1000 },
  { id: '40mm-he', group: 'Autocannon', calibreMm: 40, name: 'autocannon', kind: 'he', lengthMm: 160, massKg: 0.9, speedMs: 1000, fillKg: 0.12 },
  // Anti-tank and field guns
  { id: '37mm-ap', group: 'Anti-tank and field guns', calibreMm: 37, name: 'anti-tank gun', kind: 'ap', lengthMm: 130, massKg: 0.65, speedMs: 800 },
  { id: '45mm-ap', group: 'Anti-tank and field guns', calibreMm: 45, name: 'anti-tank gun', kind: 'ap', lengthMm: 170, massKg: 1.4, speedMs: 760 },
  { id: '50mm-ap', group: 'Anti-tank and field guns', calibreMm: 50, name: 'anti-tank gun', kind: 'ap', lengthMm: 200, massKg: 2.1, speedMs: 835 },
  { id: '57mm-ap', group: 'Anti-tank and field guns', calibreMm: 57, name: 'anti-tank gun', kind: 'ap', lengthMm: 230, massKg: 2.8, speedMs: 1000 },
  { id: '76mm-he', group: 'Anti-tank and field guns', calibreMm: 76, name: 'field gun', kind: 'he', lengthMm: 320, massKg: 6.2, speedMs: 680, fillKg: 0.7 },
  { id: '76mm-ap', group: 'Anti-tank and field guns', calibreMm: 76, name: 'anti-tank gun', kind: 'ap', lengthMm: 330, massKg: 7.7, speedMs: 880 },
  { id: '87mm-he', group: 'Anti-tank and field guns', calibreMm: 87, name: 'field gun-howitzer', kind: 'he', lengthMm: 400, massKg: 11.3, speedMs: 530, fillKg: 0.9 },
  { id: '88mm-ap', group: 'Anti-tank and field guns', calibreMm: 88, name: 'dual-purpose gun', kind: 'ap', lengthMm: 380, massKg: 10, speedMs: 800 },
  { id: '88mm-he', group: 'Anti-tank and field guns', calibreMm: 88, name: 'dual-purpose gun', kind: 'he', lengthMm: 400, massKg: 9.2, speedMs: 800, fillKg: 0.95 },
  // Naval guns
  { id: '102mm-naval-he', group: 'Naval guns', calibreMm: 102, name: 'naval gun', kind: 'he', lengthMm: 440, massKg: 14, speedMs: 800, fillKg: 1.4 },
  { id: '127mm-naval-he', group: 'Naval guns', calibreMm: 127, name: 'naval gun', kind: 'he', lengthMm: 600, massKg: 25, speedMs: 810, fillKg: 3.5 },
  // Mortars
  { id: '60mm-mortar', group: 'Mortars', calibreMm: 60, name: 'mortar', kind: 'he', lengthMm: 240, massKg: 1.4, speedMs: 200, fillKg: 0.2 },
  { id: '82mm-mortar', group: 'Mortars', calibreMm: 82, name: 'mortar', kind: 'he', lengthMm: 330, massKg: 3.1, speedMs: 250, fillKg: 0.5 },
  { id: '120mm-mortar', group: 'Mortars', calibreMm: 120, name: 'mortar', kind: 'he', lengthMm: 500, massKg: 13, speedMs: 300, fillKg: 1.8 },
  { id: '240mm-mortar', group: 'Mortars', calibreMm: 240, name: 'heavy mortar', kind: 'he', lengthMm: 1000, massKg: 130, speedMs: 350, fillKg: 25 },
  // Recoilless rifles
  { id: '84mm-rr-heat', group: 'Recoilless rifles', calibreMm: 84, name: 'recoilless rifle', kind: 'heat', lengthMm: 400, massKg: 3, speedMs: 290, fillKg: 0.55 },
  { id: '90mm-rr-heat', group: 'Recoilless rifles', calibreMm: 90, name: 'recoilless rifle', kind: 'heat', lengthMm: 480, massKg: 3.5, speedMs: 300, fillKg: 0.7 },
  { id: '105mm-rr-heat', group: 'Recoilless rifles', calibreMm: 105, name: 'recoilless rifle', kind: 'heat', lengthMm: 650, massKg: 8.7, speedMs: 500, fillKg: 1.5 },
  { id: '120mm-rr-hesh', group: 'Recoilless rifles', calibreMm: 120, name: 'recoilless rifle', kind: 'hesh', lengthMm: 700, massKg: 12, speedMs: 500, fillKg: 3 },
  // Howitzers
  { id: '105mm-he', group: 'Howitzers', calibreMm: 105, name: 'howitzer', kind: 'he', lengthMm: 480, massKg: 15, speedMs: 470, fillKg: 2.1 },
  { id: '122mm-he', group: 'Howitzers', calibreMm: 122, name: 'howitzer', kind: 'he', lengthMm: 550, massKg: 21.8, speedMs: 515, fillKg: 3.6 },
  { id: '150mm-he', group: 'Howitzers', calibreMm: 150, name: 'heavy field howitzer', kind: 'he', lengthMm: 600, massKg: 43.5, speedMs: 520, fillKg: 5 },
  { id: '152mm-he', group: 'Howitzers', calibreMm: 152, name: 'howitzer', kind: 'he', lengthMm: 650, massKg: 43.6, speedMs: 650, fillKg: 6.9 },
  { id: '155mm-he', group: 'Howitzers', calibreMm: 155, name: 'howitzer', kind: 'he', lengthMm: 650, massKg: 43, speedMs: 800, fillKg: 8 },
  { id: '203mm-he', group: 'Howitzers', calibreMm: 203, name: 'heavy howitzer', kind: 'he', lengthMm: 850, massKg: 90, speedMs: 600, fillKg: 18 },
  { id: '240mm-he', group: 'Howitzers', calibreMm: 240, name: 'siege howitzer', kind: 'he', lengthMm: 1000, massKg: 160, speedMs: 650, fillKg: 30 },
  // Tank guns
  { id: '105mm-heat', group: 'Tank guns', calibreMm: 105, name: 'tank gun', kind: 'heat', lengthMm: 600, massKg: 10.5, speedMs: 1100, fillKg: 1.6 },
  { id: '120mm-apfsds', group: 'Tank guns', calibreMm: 120, name: 'tank gun', kind: 'dart', lengthMm: 700, massKg: 4.6, speedMs: 1650 },
];

export const ARTILLERY: BulletSpec[] = ROWS.map(shell);

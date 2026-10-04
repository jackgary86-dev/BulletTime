import type { BulletSpec } from './bullets';

/**
 * The Explosion simulator's test bed (#182): charges that detonate in the air
 * at a set stand-off from the material under test. Yields are TNT-equivalent
 * kilograms. Blast, fragments and fireball are tuned for the look and the
 * physics, and no construction detail is given: these are lab test articles.
 */
const GRAINS_PER_KG = 15432.36;
const gr = (kg: number): number => Math.round(kg * GRAINS_PER_KG);

const charge = (c: Partial<BulletSpec> & Pick<BulletSpec, 'id' | 'name' | 'type' | 'description' | 'caliberMm' | 'lengthMm' | 'massGrains' | 'standoffM' | 'blast'>): BulletSpec => ({
  mode: 'explosion',
  muzzleVelocityMs: 0,
  behaviour: 'charge',
  shape: 'charge',
  noseDragFactor: 1,
  ...c,
});

export const EXPLOSIVES: BulletSpec[] = [
  charge({
    id: 'charge-flash',
    name: 'Flash charge',
    type: '0.1 kg, uncased',
    description: 'A small bare charge: a bright flash and a sharp, short blast. No fragments.',
    caliberMm: 40,
    lengthMm: 60,
    massGrains: gr(0.12),
    standoffM: 0.8,
    blast: { yieldKg: 0.1, fireball: 'standard' },
  }),
  charge({
    id: 'charge-cased',
    name: 'Fragmentation charge',
    type: '0.4 kg, steel case',
    description: 'A cased charge: the steel body breaks into fragments that fly out with the blast.',
    caliberMm: 60,
    lengthMm: 90,
    massGrains: gr(0.9),
    standoffM: 1.0,
    blast: { yieldKg: 0.4, fragmentCount: 60, fragmentSpeedMs: 1400, fragmentMassFraction: 0.6, fireball: 'standard' },
  }),
  charge({
    id: 'charge-block',
    name: 'Demolition block',
    type: '1 kg',
    description: 'A plain block of plastic explosive. A strong blast wave with no case.',
    caliberMm: 50,
    lengthMm: 120,
    massGrains: gr(1),
    standoffM: 1.2,
    blast: { yieldKg: 1.3, fireball: 'standard' },
  }),
  charge({
    id: 'charge-satchel',
    name: 'Satchel charge',
    type: '5 kg',
    description: 'A large demolition charge. It shatters light materials and cracks heavy ones.',
    caliberMm: 120,
    lengthMm: 200,
    massGrains: gr(5),
    standoffM: 2.0,
    blast: { yieldKg: 6.5, fireball: 'standard' },
  }),
  charge({
    id: 'charge-shaped',
    name: 'Linear shaped charge',
    type: '2 kg cutting charge',
    description: 'A cutting charge with a copper liner: it sends a jet into the target instead of a wide blast.',
    caliberMm: 100,
    lengthMm: 130,
    massGrains: gr(2),
    standoffM: 0.5,
    blast: { yieldKg: 1.0, jet: { count: 6, speedMs: 7500, massFraction: 0.12 }, fireball: 'standard' },
  }),
  charge({
    id: 'charge-thermobaric',
    name: 'Thermobaric charge',
    type: '2 kg fuel-air',
    description: 'A fuel cloud that ignites: a huge slow fireball and a long, strong pressure pulse.',
    caliberMm: 100,
    lengthMm: 160,
    massGrains: gr(2),
    standoffM: 2.0,
    blast: { yieldKg: 3.5, fireball: 'thermobaric' },
  }),
  charge({
    id: 'charge-incendiary',
    name: 'Incendiary charge',
    type: '0.5 kg',
    description: 'A burning charge: lots of flame and sparks, almost no pressure.',
    caliberMm: 60,
    lengthMm: 100,
    massGrains: gr(0.5),
    standoffM: 0.8,
    blast: { yieldKg: 0.02, fireball: 'incendiary' },
  }),
];

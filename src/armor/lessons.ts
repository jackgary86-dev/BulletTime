import type { OverlayId } from './sectionDraw';
import type { PlateMaterialId } from './materials';
import { impactState, type MunitionFamilyId } from './munitions';
import { STACK_PRESETS, arrangementExtras, type StackShot } from './stack';
import { getPlateMaterial } from './materials';

/**
 * Classroom mode (#173): a guided tour of six comparisons. Each lesson has
 * two setups to fire one after the other, a caption that says what to look
 * for and a question for the students. The lab stays fully interactive at
 * every step: a setup only sets the controls and fires.
 *
 * Every lesson's claim is pinned by a test (`lessons.test.ts`), so a change
 * to a model that breaks a lesson's point fails the build.
 */

export interface LessonSetup {
  /** The button label, like "Full-bore shot". */
  label: string;
  family: MunitionFamilyId;
  calibreMm: number;
  material: PlateMaterialId;
  thicknessMm: number;
  obliquityDeg: number;
  /** A stack arrangement by id (`STACK_PRESETS`). */
  arrangement: string;
  overlay?: OverlayId;
}

export interface Lesson {
  id: string;
  title: string;
  /** What to watch for, in a sentence or two. */
  caption: string;
  /** One question to ask the class. */
  question: string;
  setups: [LessonSetup, LessonSetup];
}

const single = { obliquityDeg: 0, arrangement: 'single' } as const;

export const LESSONS: Lesson[] = [
  {
    id: 'shot-vs-rod',
    title: 'Full-bore shot vs long rod',
    caption: 'Both rounds are 120 mm and hit 200 mm of RHA square-on. The full-bore shot pushes the plate aside and stops; the long rod puts the same calibre’s energy on a far smaller area and erodes its way through.',
    question: 'Why does a thinner, lighter penetrator get further into the same plate?',
    setups: [
      { label: 'Full-bore shot', family: 'ap-shot', calibreMm: 120, material: 'rha', thicknessMm: 200, ...single },
      { label: 'APFSDS long rod', family: 'apfsds', calibreMm: 120, material: 'rha', thicknessMm: 200, ...single },
    ],
  },
  {
    id: 'slope',
    title: 'Square-on vs sloped plate',
    caption: 'The same 105 mm shot and the same 120 mm plate, first square-on, then sloped at 60°. Sloping doubles the path through the plate: the line-of-sight thickness is T / cos θ.',
    question: 'The plate weighs the same both times. Where did the extra protection come from?',
    setups: [
      { label: 'Plate at 0°', family: 'ap-shot', calibreMm: 105, material: 'rha', thicknessMm: 120, obliquityDeg: 0, arrangement: 'single' },
      { label: 'Plate at 60°', family: 'ap-shot', calibreMm: 105, material: 'rha', thicknessMm: 120, obliquityDeg: 60, arrangement: 'single' },
    ],
  },
  {
    id: 'heat-density',
    title: 'A jet in steel vs aluminium',
    caption: 'A 50 mm shaped-charge jet against 300 mm of RHA, then 300 mm of aluminium. A jet penetrates roughly in proportion to √(jet density / plate density), so light plate needs to be much thicker to stop it.',
    question: 'If aluminium is a third as dense as steel, how much thicker must it be to stop the same jet?',
    setups: [
      { label: 'RHA', family: 'heat', calibreMm: 50, material: 'rha', thicknessMm: 300, ...single },
      { label: 'Aluminium 5083', family: 'heat', calibreMm: 50, material: 'al-5083', thicknessMm: 300, ...single },
    ],
  },
  {
    id: 'hesh-thickness',
    title: 'Squash head on thin vs thick plate',
    caption: 'A 120 mm squash head never goes in: it sends a stress pulse through the plate. On 60 mm the pulse reflects off the back as tension strong enough to tear off a scab; on 150 mm it has weakened too much by the time it gets there. Watch the stress overlay.',
    question: 'Why is the damage on the side of the plate the round never touched?',
    setups: [
      { label: '60 mm RHA', family: 'hesh', calibreMm: 120, material: 'rha', thicknessMm: 60, ...single, overlay: 'stress' },
      { label: '150 mm RHA', family: 'hesh', calibreMm: 120, material: 'rha', thicknessMm: 150, ...single, overlay: 'stress' },
    ],
  },
  {
    id: 'ricochet',
    title: 'The ricochet threshold',
    caption: 'A 105 mm shot on 60 mm of RHA at 60°, then at 72°. Below its critical slope the shot bites in; above it the nose cannot dig in fast enough and the shot glances off, leaving only a gouge.',
    question: 'What would you change about the shot to make it bite at a steeper slope?',
    setups: [
      { label: 'At 60°', family: 'ap-shot', calibreMm: 105, material: 'rha', thicknessMm: 60, obliquityDeg: 60, arrangement: 'single' },
      { label: 'At 72°', family: 'ap-shot', calibreMm: 105, material: 'rha', thicknessMm: 60, obliquityDeg: 72, arrangement: 'single' },
    ],
  },
  {
    id: 'jet-gap',
    title: 'A jet across a gap',
    caption: 'The same 50 mm jet against 300 mm of RHA, first alone, then with a thin plate 300 mm in front of it. The jet forms at the thin plate; across the gap it stretches, breaks into particles and spreads, and digs far less into the main plate.',
    question: 'The thin plate is only 20 mm of mild steel. Why does it take away so much of the jet’s depth?',
    setups: [
      { label: 'Main plate alone', family: 'heat', calibreMm: 50, material: 'rha', thicknessMm: 300, ...single },
      { label: 'With a spaced plate', family: 'heat', calibreMm: 50, material: 'rha', thicknessMm: 300, obliquityDeg: 0, arrangement: 'spaced' },
    ],
  },
];

/** The stack a setup fires, built the way the lab's controls build it. */
export function lessonStack(setup: LessonSetup): StackShot {
  const preset = STACK_PRESETS.find((p) => p.id === setup.arrangement);
  if (!preset) throw new Error(`Unknown arrangement '${setup.arrangement}'`);
  return {
    impact: impactState(setup.family, setup.calibreMm),
    layers: preset.build(getPlateMaterial(setup.material), setup.thicknessMm / 1000, arrangementExtras()),
    obliquityDeg: setup.obliquityDeg,
  };
}

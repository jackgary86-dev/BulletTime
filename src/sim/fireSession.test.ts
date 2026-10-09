import { describe, expect, it } from 'vitest';
import { getMedium } from '../data/media';
import { STANDARD_RESOLUTION } from '../data/physics';
import { layersFor, simulate } from './engine';
import { fireSession, GROUP_GAP_S, type FireSessionInput } from './fireSession';
import { appendShot, priorDamage } from './session';
import { runFireSession } from './simClient';
import { bulletAt } from './testUtil';

const BULLET = '9mm-fmj';
const layers = layersFor(getMedium('gel10'), getMedium('gel10').thickness.default);
const round = (y: number) => ({ layers, impactPoint: { x: -0.2, y: 0.16 + y, z: 0 }, aim: { y, z: 0 } });
const input = (mode: FireSessionInput['mode']): FireSessionInput => ({
  bullet: bulletAt(BULLET),
  rounds: [round(0), round(0.02), round(-0.02)],
  angleDeg: 0,
  standOffM: 0.5,
  resolution: STANDARD_RESOLUTION,
  session: null,
  fireStart: 0,
  mode,
  rpm: 600,
});

describe('fire session (#333)', () => {
  it('matches firing the rounds one by one, as the lane did before the worker', () => {
    const i = input('group');
    let session = null as ReturnType<typeof fireSession> | null;
    let offset = 0;
    for (const r of i.rounds) {
      const part = simulate({ bullet: i.bullet, layers: r.layers, angleDeg: 0, impactPoint: r.impactPoint, standOffM: 0.5, damage: priorDamage(session), resolution: i.resolution });
      part.shots[0].aim = r.aim;
      session = appendShot(session, part, offset);
      offset += part.duration + GROUP_GAP_S;
    }
    expect(fireSession(i)).toEqual(session);
  });

  it('fires a burst on the beat of its rate', () => {
    const t = fireSession(input('burst'));
    expect(t.shots.map((s) => s.start)).toEqual([0, 0.1, 0.2].map((s) => expect.closeTo(s, 9)));
  });

  it('runs in place where there are no workers, with the same timeline', async () => {
    expect(await runFireSession(input('group'))).toEqual(fireSession(input('group')));
  });

  it('gives a timeline that survives the trip to and from a worker', () => {
    const t = fireSession(input('group'));
    expect(structuredClone(t)).toEqual(t);
  });
});

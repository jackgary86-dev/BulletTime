import { describe, expect, it } from 'vitest';
import { getRegion, regionLayers } from '../data/dummy';
import { STACK_PRESETS, presetLayers, stackDepth, stackOffsets } from '../data/stacks';
import { fire } from './testUtil';

describe('layered targets', () => {
  it('lays layers out front to back with their gaps', () => {
    const layers = presetLayers(STACK_PRESETS.find((p) => p.id === 'wall-gel')!);
    const offsets = stackOffsets(layers);
    expect(offsets[0]).toBe(0);
    for (let i = 1; i < layers.length; i++) expect(offsets[i]).toBeCloseTo(offsets[i - 1] + layers[i - 1].thickness + layers[i].gapM);
    expect(stackDepth(layers)).toBeCloseTo(offsets.at(-1)! + layers.at(-1)!.thickness);
  });

  it('a barrier in front of the gel costs penetration in the gel', () => {
    const bare = fire({ bullet: '9mm-jhp', thickness: 0.4 });
    const walled = fire({ bullet: '9mm-jhp', stack: presetLayers(STACK_PRESETS.find((p) => p.id === 'wood-gel')!) });
    const gelEntry = walled.events.find((e) => e.type === 'enter' && e.trackId === walled.shots[0].primaryId && e.layer === 1);
    expect(gelEntry).toBeDefined();
    expect(gelEntry!.speed).toBeLessThan(bare.summary.impactSpeed);
  });

  it.each(['head', 'chest', 'abdomen'] as const)('a 9mm reaches bone in the dummy %s', (id) => {
    const timeline = fire({ bullet: '9mm-fmj', stack: regionLayers(getRegion(id)) });
    const layers = getRegion(id).layers;
    const boneHit = timeline.events.some((e) => e.layer !== undefined && layers[e.layer]?.medium === 'bone-sim' && (e.type === 'enter' || e.type === 'impact'));
    expect(boneHit).toBe(true);
  });
});

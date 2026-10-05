import { describe, expect, it } from 'vitest';
import { formatApproach, formatWitness, parseReplayLink, parseReplayTime, parseWitness } from './replayLink';

describe('replay deep link (#230)', () => {
  it.each([
    ['60us', 60e-6],
    ['60µs', 60e-6],
    ['1.2ms', 1.2e-3],
    ['0.0006', 6e-4],
    ['0.5s', 0.5],
    ['2e-5', 2e-5],
    [' 40 us ', 40e-6],
  ])('reads %s as seconds', (text, seconds) => {
    expect(parseReplayTime(text)).toBeCloseTo(seconds, 12);
  });

  it.each(['', 'soon', '-5us', '5 minutes', 'us'])('rejects %j', (text) => {
    expect(parseReplayTime(text)).toBeNull();
  });

  it('needs an at time, and reads the round, material and thickness', () => {
    expect(parseReplayLink('?mode=bullet')).toBeNull();
    expect(parseReplayLink('?at=bad')).toBeNull();
    const link = parseReplayLink('?mode=bullet&bullet=308-sp&medium=steel-mild&thickness=0.003&at=60us')!;
    expect(link.atS).toBeCloseTo(60e-6, 12);
    expect(link).toMatchObject({ bullet: '308-sp', medium: 'steel-mild', thicknessM: 0.003 });
  });

  it('ignores a bad thickness', () => {
    expect(parseReplayLink('?at=1ms&thickness=abc')?.thicknessM).toBeUndefined();
    expect(parseReplayLink('?at=1ms&thickness=-1')?.thicknessM).toBeUndefined();
    expect(parseReplayLink('?at=1ms')?.bullet).toBeUndefined();
  });
});

describe('replay link: building preset and witness blocks (#249)', () => {
  it('carries the preset and the block layout, and round-trips the layout', () => {
    const link = parseReplayLink('?mode=missile&preset=building-block-house&witness=0.3:0,1.5:-0.6&at=1ms')!;
    expect(link.preset).toBe('building-block-house');
    expect(link.witness).toEqual([{ distM: 0.3, lateralM: 0 }, { distM: 1.5, lateralM: -0.6 }]);
    expect(parseWitness(formatWitness(link.witness!))).toEqual(link.witness);
  });

  it('drops pairs that do not parse, and leaves the layout out when none do', () => {
    expect(parseWitness('0.3:0,oops,1:x')).toEqual([{ distM: 0.3, lateralM: 0 }]);
    expect(parseWitness('nope')).toBeUndefined();
    expect(parseReplayLink('?at=1ms')!.witness).toBeUndefined();
  });
});

describe('replay link: missile approach (#250)', () => {
  it('carries the dive and bearing, and round-trips them', () => {
    const link = parseReplayLink('?mode=missile&preset=building-block-house&dive=70&bearing=-15&at=1ms')!;
    expect(link.approach).toEqual({ diveDeg: 70, bearingDeg: -15 });
    expect(parseReplayLink(`?${formatApproach(link.approach!)}&at=1ms`)!.approach).toEqual(link.approach);
    expect(parseReplayLink('?at=1ms')!.approach).toBeUndefined();
    expect(parseReplayLink('?dive=45&at=1ms')!.approach).toEqual({ diveDeg: 45, bearingDeg: 0 });
  });
});


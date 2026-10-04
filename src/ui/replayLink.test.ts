import { describe, expect, it } from 'vitest';
import { parseReplayLink, parseReplayTime } from './replayLink';

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

import { describe, expect, it } from 'vitest';
import { SOUNDS, getSound } from './sounds';

describe('sound list', () => {
  it('has unique ids and a label for every sound', () => {
    const ids = SOUNDS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SOUNDS) expect(s.label.trim()).not.toBe('');
  });

  it('looks sounds up by id', () => {
    expect(getSound('impact-steel').label).toBe('Steel plate ring');
    expect(() => getSound('nope')).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { cleanFrameAction } from './cleanFrame';

describe('clean frame keys (#239)', () => {
  it('toggles on H in either case and leaves on Escape only while clean', () => {
    expect(cleanFrameAction({ key: 'h' }, false)).toBe('toggle');
    expect(cleanFrameAction({ key: 'H' }, true)).toBe('toggle');
    expect(cleanFrameAction({ key: 'Escape' }, true)).toBe('exit');
    expect(cleanFrameAction({ key: 'Escape' }, false)).toBeNull();
  });

  it('ignores shortcuts and typing in fields', () => {
    expect(cleanFrameAction({ key: 'h', ctrlKey: true }, false)).toBeNull();
    expect(cleanFrameAction({ key: 'h', metaKey: true }, false)).toBeNull();
    expect(cleanFrameAction({ key: 'h', targetTag: 'INPUT' }, false)).toBeNull();
    expect(cleanFrameAction({ key: 'h', targetTag: 'select' }, false)).toBeNull();
    expect(cleanFrameAction({ key: 'h', targetTag: 'BUTTON' }, false)).toBe('toggle');
    expect(cleanFrameAction({ key: 'x' }, false)).toBeNull();
  });
});

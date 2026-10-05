import { describe, expect, it } from 'vitest';
import { getBullet } from '../data/bullets';
import { getMedium } from '../data/media';
import { FIRST_SHOT, shouldOpenWithShot } from './firstShot';

const store = (items: Record<string, string>) => ({ getItem: (k: string) => items[k] ?? null });

describe('first launch shot (#241)', () => {
  it('plays on a fresh profile with a plain address', () => {
    expect(shouldOpenWithShot(store({}), '')).toBe(true);
  });

  it('plays only once, unless the player asked for it every time', () => {
    expect(shouldOpenWithShot(store({ 'bullettime.firstShotSeen': '1' }), '')).toBe(false);
    expect(shouldOpenWithShot(store({ 'bullettime.firstShotSeen': '1', 'bullettime.openWithShot': '1' }), '')).toBe(true);
    expect(shouldOpenWithShot(store({ 'bullettime.openWithShot': '0' }), '')).toBe(true);
  });

  it('never overrides an address that asks for something', () => {
    for (const q of ['?mode=missile', '?mode=bullet&at=60us', '?at=1ms', '?still', '?clean', '?launcher']) {
      expect(shouldOpenWithShot(store({ 'bullettime.openWithShot': '1' }), q)).toBe(false);
    }
  });

  it('is skipped when storage is blocked, so it never plays on every launch', () => {
    expect(shouldOpenWithShot(null, '')).toBe(false);
  });

  it('is a real round and target', () => {
    expect(getBullet(FIRST_SHOT.bullet).id).toBe('308-sp');
    expect(getMedium(FIRST_SHOT.medium).id).toBe('gel10');
  });
});

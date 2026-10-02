import { describe, expect, it } from 'vitest';
import notices from '../../public/THIRD_PARTY_LICENSES.txt?raw';
import pkg from '../../package.json?raw';

describe('third-party notices', () => {
  it('names every runtime dependency', () => {
    const { dependencies } = JSON.parse(pkg) as { dependencies: Record<string, string> };
    for (const name of Object.keys(dependencies)) {
      // Font packages are listed by family (e.g. @fontsource/jetbrains-mono → "jetbrains mono").
      const label = name.replace(/^@fontsource\//, '').replace(/-/g, ' ');
      expect(notices.toLowerCase(), `${name} missing from THIRD_PARTY_LICENSES.txt`).toContain(label);
    }
  });

  it('carries the full three.js MIT notice', () => {
    expect(notices).toContain('three.js authors');
    expect(notices).toContain('The above copyright notice and this permission notice shall be included');
  });
});

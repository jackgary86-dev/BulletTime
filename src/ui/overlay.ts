import { mountSoundBoard } from './soundBoard';

/**
 * Mounts the heads-up overlay: the app title with About and Sounds windows, and a hint
 * about camera controls. The other panels mount themselves into the same root.
 */
export function mountOverlay(root: HTMLElement): void {
  root.innerHTML = `
    <header class="brand">
      <h1>BulletTime</h1>
      <p>Slow-motion bullet impact simulator <button type="button" class="about-open">About</button><button type="button" class="about-open sounds-open">Sounds</button></p>
    </header>
    <p class="hint">Drag to orbit · scroll to zoom · right-drag to pan</p>
    <dialog class="about" aria-labelledby="about-title">
      <h2 id="about-title">About BulletTime</h2>
      <p>
        BulletTime is an entertainment and education tool. It shows, in slow motion, roughly what
        happens when common rounds hit gel, water, wood, drywall, concrete, steel, sand, glass, ice
        and lab test targets.
      </p>
      <p>
        The physics is plausible and grounded in published reference numbers, such as typical
        penetration depths in 10% ballistic gelatin and factory muzzle velocities. It is a simplified
        model tuned to look and behave believably. It is <strong>not</strong> a validated engineering
        or forensic model, and its numbers should not be used for safety, legal, medical or
        purchasing decisions.
      </p>
      <p>
        Organic targets are lab simulants: gel, fake blood packs and synthetic bone, as used in
        television and lab tests.
      </p>
      <h3>Credits &amp; licenses</h3>
      <p class="about-credits">
        Built with <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> (MIT).
        Fonts: Inter, Barlow Condensed and JetBrains Mono (SIL Open Font License 1.1).
        <a href="${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt" target="_blank" rel="noopener">Full license texts</a>
      </p>
      <form method="dialog"><button type="submit">Close</button></form>
    </dialog>
  `;
  const dialog = root.querySelector<HTMLDialogElement>('.about')!;
  root.querySelector('.about-open')!.addEventListener('click', () => dialog.showModal());
  // Clicking the backdrop closes it too.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  mountSoundBoard(root, root.querySelector<HTMLElement>('.sounds-open')!);
}

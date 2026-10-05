import { reducedGore, setReducedGore } from '../data/content';
import { mountSoundBoard } from './soundBoard';
import { openWithShotAlways, setOpenWithShotAlways } from './firstShot';

/**
 * Mounts the heads-up overlay: the app title with About and Sounds windows, and a hint
 * about camera controls. The other panels mount themselves into the same root.
 */
export function mountOverlay(root: HTMLElement, simulator = 'Bullet'): void {
  root.innerHTML = `
    <header class="brand">
      <h1>BulletTime</h1>
      <p><span class="tagline">Slow-motion ${simulator.toLowerCase()} simulator </span><button type="button" class="about-open">About</button><button type="button" class="about-open sounds-open">Sounds</button><button type="button" class="about-open sound-mute-toggle" title="Mute or unmute shot sounds">Sound on</button><button type="button" class="about-open simulators-open" title="Back to the choice of simulators">Simulators</button></p>
    </header>
    <p class="hint">Drag to orbit · scroll to zoom · right-drag to pan</p>
    <dialog class="about" aria-labelledby="about-title">
      <h2 id="about-title">About BulletTime</h2>
      <p>
        BulletTime is an entertainment and education tool. It shows, in slow motion, roughly what
        happens when rounds, shells, missiles and explosive charges hit gel, water, wood, drywall,
        concrete, steel, sand, glass, ice and lab test targets, in four simulators: Bullet, Artillery,
        Missile and Explosion.
      </p>
      <p>
        The physics is plausible and grounded in published reference numbers, such as typical
        penetration depths in 10% ballistic gelatin and factory muzzle velocities. It is a simplified
        model tuned to look and behave believably. It is <strong>not</strong> a validated engineering
        or forensic model, and its numbers should not be used for safety, legal, medical or
        purchasing decisions.
      </p>
      <p>
        The Armor lab's equations, constants, sources and limits are written up in the
        <a href="https://github.com/jackgary86-dev/BulletTime/blob/main/docs/armor-models.md" target="_blank" rel="noopener">Armor lab model notes</a>.
      </p>
      <p>
        Organic targets are lab simulants: gel, fake blood packs and synthetic bone, as used in
        television and lab tests.
      </p>
      <h3>Content</h3>
      <p>
        Contains simulated blood and human-shaped ballistic test dummies. Intended for ages 17 and over.
      </p>
      <label class="about-option">
        <input type="checkbox" class="reduced-gore" />
        Reduced gore: show blood as a clear blue simulant
      </label>
      <label class="about-option">
        <input type="checkbox" class="open-with-shot" />
        Open with a shot: every launch starts by playing a .308 into gel
      </label>
      <h3>Credits &amp; licenses</h3>
      <p class="about-credits">
        Built with <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> (MIT).
        Fonts: Inter, Barlow Condensed and JetBrains Mono (SIL Open Font License 1.1).
        <a href="${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt" target="_blank" rel="noopener">Full license texts</a>
      </p>
      <form method="dialog"><button type="submit">Close</button></form>
    </dialog>
  `;
  // The launcher is the page without a ?mode in the address, so going back to it starts the page afresh.
  root.querySelector('.simulators-open')!.addEventListener('click', () => location.assign(location.pathname));
  const dialog = root.querySelector<HTMLDialogElement>('.about')!;
  const gore = dialog.querySelector<HTMLInputElement>('.reduced-gore')!;
  gore.addEventListener('change', () => setReducedGore(gore.checked));
  const withShot = dialog.querySelector<HTMLInputElement>('.open-with-shot')!;
  withShot.checked = openWithShotAlways();
  withShot.addEventListener('change', () => setOpenWithShotAlways(withShot.checked));
  root.querySelector('.about-open')!.addEventListener('click', () => {
    gore.checked = reducedGore();
    dialog.showModal();
  });
  // Clicking the backdrop closes it too.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  mountSoundBoard(root, root.querySelector<HTMLElement>('.sounds-open')!, root.querySelector<HTMLButtonElement>('.sound-mute-toggle')!);
}

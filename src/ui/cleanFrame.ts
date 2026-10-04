/**
 * Clean frame (#239): hides every panel and the readout so the scene can be
 * captured with no UI, for store screenshots. H toggles it, Escape leaves it,
 * and a hint shows for a moment on the way in.
 */
export interface CleanFrame {
  toggle(): void;
  readonly on: boolean;
}

const HINT_MS = 1800;

export function mountCleanFrame(root: HTMLElement): CleanFrame {
  const hint = document.createElement('p');
  hint.className = 'clean-hint';
  hint.textContent = 'Clean frame · press H to bring the panels back';
  hint.hidden = true;
  root.append(hint);
  let on = false;
  let timer = 0;

  const set = (next: boolean) => {
    on = next;
    document.body.classList.toggle('clean-frame', on);
    window.clearTimeout(timer);
    hint.hidden = !on;
    if (on) timer = window.setTimeout(() => (hint.hidden = true), HINT_MS);
  };

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    if (e.key === 'h' || e.key === 'H') set(!on);
    else if (e.key === 'Escape' && on) set(false);
  });

  return {
    toggle: () => set(!on),
    get on() {
      return on;
    },
  };
}

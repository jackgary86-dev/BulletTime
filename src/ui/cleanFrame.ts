/**
 * Clean frame (#239): hides every panel and the readout so the scene can be
 * captured with no UI, for screenshots and store art. H toggles it, Escape
 * leaves it, and `?clean` in the address starts with it on.
 */

export type CleanFrameAction = 'toggle' | 'exit' | null;

/** What a key press means for the clean frame: H toggles, Escape leaves, anything typed into a field or with a modifier is ignored. */
export function cleanFrameAction(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; targetTag?: string }, on: boolean): CleanFrameAction {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.targetTag && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.targetTag.toUpperCase())) return null;
  if (e.key === 'h' || e.key === 'H') return 'toggle';
  if (e.key === 'Escape' && on) return 'exit';
  return null;
}

export interface CleanFrame {
  readonly on: boolean;
  set(on: boolean): void;
  toggle(): void;
}

/** Wires the clean frame to `overlay` (a class that hides its children) and the keyboard. */
export function mountCleanFrame(overlay: HTMLElement, initial: boolean): CleanFrame {
  let on = false;
  let hint: HTMLDivElement | null = null;

  const showHint = () => {
    hint?.remove();
    hint = document.createElement('div');
    hint.className = 'clean-frame-hint';
    hint.textContent = 'Clean frame. Press H or Esc to bring the controls back.';
    document.body.append(hint);
    const mine = hint;
    window.setTimeout(() => mine.remove(), 2500);
  };

  const frame: CleanFrame = {
    get on() {
      return on;
    },
    set(next) {
      if (next === on) return;
      on = next;
      overlay.classList.toggle('clean-frame', on);
      if (on) showHint();
      else hint?.remove();
    },
    toggle() {
      frame.set(!on);
    },
  };

  window.addEventListener('keydown', (e) => {
    const action = cleanFrameAction({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, targetTag: (e.target as HTMLElement | null)?.tagName }, on);
    if (action === 'toggle') frame.toggle();
    else if (action === 'exit') frame.set(false);
  });
  // `?clean` starts clean without the hint, so a screenshot run is never photobombed by it.
  if (initial) {
    on = true;
    overlay.classList.add('clean-frame');
  }
  return frame;
}

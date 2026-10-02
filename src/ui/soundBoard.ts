import { SOUNDS, playSound, type SoundGroup } from '../audio/sounds';

const PLAY_ICON =
  '<svg class="icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4.5 3v10l8.5-5z" fill="currentColor"/></svg>';

/**
 * The Sounds window (#108): every sound effect with a label and a play
 * button, opened from the header next to About.
 */
export function mountSoundBoard(root: HTMLElement, opener: HTMLElement): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'about sound-board';
  dialog.setAttribute('aria-labelledby', 'sound-board-title');

  const groups: SoundGroup[] = ['Shots', 'Impacts'];
  dialog.innerHTML = `
    <h2 id="sound-board-title">Sounds</h2>
    ${groups
      .map(
        (group) => `
      <h3>${group}</h3>
      <ul>
        ${SOUNDS.filter((s) => s.group === group)
          .map(
            (s) => `
          <li>
            <span>${s.label}</span>
            <button type="button" class="sound-play" data-sound="${s.id}" aria-label="Play ${s.label}">${PLAY_ICON} Play</button>
          </li>`,
          )
          .join('')}
      </ul>`,
      )
      .join('')}
    <form method="dialog"><button type="submit">Close</button></form>
  `;
  root.append(dialog);

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      dialog.close();
      return;
    }
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.sound-play');
    if (button?.dataset.sound) playSound(button.dataset.sound);
  });
  opener.addEventListener('click', () => dialog.showModal());
}

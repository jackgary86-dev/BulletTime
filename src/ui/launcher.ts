/**
 * The launcher shown after the content warning: the four simulators (#186).
 * Each is an experimental impact test on the same material catalogue, over its
 * own munition range. `?mode=artillery` (or any other mode) in the URL skips the screen.
 */
import type { SimulatorId } from '../data/bullets';

export type { SimulatorId };

/** What the launcher can open: the four simulators, or the Armor lab (#157), which is its own screen. */
export type LauncherChoice = SimulatorId | 'armor';

interface Simulator {
  id: LauncherChoice;
  name: string;
  range: string;
  blurb: string;
  ready: boolean;
}

const SIMULATORS: Simulator[] = [
  { id: 'bullet', name: 'Bullet', range: '.22 LR to 20 mm', blurb: 'Fire any round into gel, wood, concrete, steel, glass and layered stacks.', ready: true },
  { id: 'artillery', name: 'Artillery', range: '20 mm to 240 mm', blurb: 'AP, HE, HEAT and HESH shells from autocannon to siege howitzers against plate, concrete and earth.', ready: true },
  { id: 'missile', name: 'Missile', range: '5 missiles, 5 warheads', blurb: 'Five basic missiles, each fitted with a different warhead.', ready: true },
  { id: 'explosion', name: 'Explosion', range: 'Every kind of blast', blurb: 'Detonate charges in a test bed and watch the materials respond.', ready: true },
  { id: 'armor', name: 'Armor lab', range: 'A cross-section of the plate', blurb: 'Shot, long rods, shaped-charge jets and squash heads against armour plate, with temperature, stress and energy.', ready: true },
];

/** Which card keyboard focus moves to: arrow keys step through the grid, Home and End jump to the ends. */
export function nextCard(index: number, key: string, count: number, columns: number): number {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'ArrowDown':
      return index + columns < count ? index + columns : index;
    case 'ArrowUp':
      return index - columns >= 0 ? index - columns : index;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return index;
  }
}

function requestedMode(): LauncherChoice | null {
  const id = new URLSearchParams(location.search).get('mode');
  return SIMULATORS.find((s) => s.id === id && s.ready)?.id ?? null;
}

/** Resolves with the simulator the player picks. */
export function chooseSimulator(): Promise<LauncherChoice> {
  const direct = requestedMode();
  if (direct) return Promise.resolve(direct);
  return new Promise((resolve) => {
    const screen = document.createElement('div');
    screen.className = 'launcher';
    screen.innerHTML = `
      <div class="launcher-inner">
        <h2>BulletTime</h2>
        <p class="launcher-sub">Choose a simulator (keys 1 to 4, or the arrow keys and Enter)</p>
        <div class="launcher-grid">
          ${SIMULATORS.map(
            (s) => `
          <button type="button" class="launcher-card" data-mode="${s.id}" ${s.ready ? '' : 'disabled'}>
            <span class="launcher-name">${SIMULATORS.indexOf(s) + 1}. ${s.name}</span>
            <span class="launcher-range">${s.range}</span>
            <span class="launcher-blurb">${s.blurb}</span>
            ${s.ready ? '' : '<span class="launcher-soon">Coming soon</span>'}
          </button>`,
          ).join('')}
        </div>
      </div>
    `;
    document.body.append(screen);
    screen.querySelector<HTMLButtonElement>('.launcher-card:not([disabled])')?.focus();
    // Keys 1 to 4 pick a simulator, arrows and Home/End move between the cards.
    screen.addEventListener('keydown', (e) => {
      const cards = [...screen.querySelectorAll<HTMLButtonElement>('.launcher-card:not([disabled])')];
      const digit = Number(e.key);
      if (digit >= 1 && digit <= SIMULATORS.length && SIMULATORS[digit - 1].ready) {
        screen.remove();
        resolve(SIMULATORS[digit - 1].id);
        return;
      }
      const at = cards.indexOf(document.activeElement as HTMLButtonElement);
      const columns = Math.max(1, Math.round(screen.querySelector<HTMLElement>('.launcher-grid')!.clientWidth / (cards[0]?.offsetWidth || 1)));
      const to = nextCard(at < 0 ? 0 : at, e.key, cards.length, columns);
      if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        cards[to]?.focus();
      }
    });
    screen.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLButtonElement>('.launcher-card:not([disabled])');
      if (!card) return;
      screen.remove();
      resolve(card.dataset.mode as LauncherChoice);
    });
  });
}

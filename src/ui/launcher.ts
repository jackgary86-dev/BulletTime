/**
 * The launcher shown after the content warning: the four simulators (#186).
 * Each is an experimental impact test on the same material catalogue, over its
 * own munition range. `?mode=artillery` (or any other mode) in the URL skips the screen.
 */
import type { SimulatorId } from '../data/bullets';

export type { SimulatorId };

interface Simulator {
  id: SimulatorId;
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
];

function requestedMode(): SimulatorId | null {
  const id = new URLSearchParams(location.search).get('mode');
  return SIMULATORS.find((s) => s.id === id && s.ready)?.id ?? null;
}

/** Resolves with the simulator the player picks. */
export function chooseSimulator(): Promise<SimulatorId> {
  const direct = requestedMode();
  if (direct) return Promise.resolve(direct);
  return new Promise((resolve) => {
    const screen = document.createElement('div');
    screen.className = 'launcher';
    screen.innerHTML = `
      <div class="launcher-inner">
        <h2>BulletTime</h2>
        <p class="launcher-sub">Choose a simulator</p>
        <div class="launcher-grid">
          ${SIMULATORS.map(
            (s) => `
          <button type="button" class="launcher-card" data-mode="${s.id}" ${s.ready ? '' : 'disabled'}>
            <span class="launcher-name">${s.name}</span>
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
    screen.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLButtonElement>('.launcher-card:not([disabled])');
      if (!card) return;
      screen.remove();
      resolve(card.dataset.mode as SimulatorId);
    });
  });
}

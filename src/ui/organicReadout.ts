import type { OrganicResult } from '../fx/bloodPackEffect';

export interface OrganicReadout {
  show(result: OrganicResult): void;
  hide(): void;
}

/** A small panel reporting what an organic target shot did: packs hit, packs burst by the cavity, bone struck. */
export function mountOrganicReadout(root: HTMLElement): OrganicReadout {
  const panel = document.createElement('section');
  panel.className = 'panel organic-results';
  panel.hidden = true;
  panel.innerHTML = `
    <span class="field-label">Blood packs</span>
    <dl class="readout">
      <div><dt>Hit by bullet</dt><dd class="packs-hit"></dd></div>
      <div><dt>Burst by cavity</dt><dd class="packs-cavity"></dd></div>
      <div><dt>Intact</dt><dd class="packs-intact"></dd></div>
      <div class="bone-row"><dt>Spine</dt><dd class="bone"></dd></div>
    </dl>
  `;
  root.append(panel);
  const field = (name: string) => panel.querySelector<HTMLElement>(`.${name}`)!;
  return {
    show(r) {
      field('packs-hit').textContent = String(r.hit);
      field('packs-cavity').textContent = String(r.burstByCavity);
      field('packs-intact').textContent = String(r.packs - r.hit - r.burstByCavity);
      field('bone').textContent = r.boneStruck ? 'Struck' : 'Missed';
      field('bone-row').hidden = r.bone === false;
      panel.hidden = false;
    },
    hide() {
      panel.hidden = true;
    },
  };
}

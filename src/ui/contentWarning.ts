import { acceptWarning, reducedGore, setReducedGore, warningAccepted } from '../data/content';

/**
 * The mature-content warning shown on first launch, before the lab renders
 * (#109). Resolves once the player continues; "Leave" goes back or closes the
 * window and never resolves. Skipped once it has been accepted.
 */
export function contentGate(): Promise<void> {
  if (warningAccepted()) return Promise.resolve();
  return new Promise((resolve) => {
    const gate = document.createElement('div');
    gate.className = 'content-warning';
    gate.setAttribute('role', 'alertdialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'content-warning-title');
    gate.setAttribute('aria-describedby', 'content-warning-body');
    gate.innerHTML = `
      <div class="content-warning-card">
        <h2 id="content-warning-title">Content warning</h2>
        <div id="content-warning-body">
          <p>
            BulletTime shows simulated firearm, artillery, missile and explosive impacts and blasts in slow motion, including <strong>simulated blood</strong>
            and <strong>human-shaped ballistic test dummies</strong>.
          </p>
          <p>It is intended for players aged 17 and over.</p>
        </div>
        <label class="content-warning-option">
          <input type="checkbox" class="reduced-gore" ${reducedGore() ? 'checked' : ''} />
          Reduced gore: show blood as a clear blue simulant
        </label>
        <div class="content-warning-actions">
          <button type="button" class="leave">Leave</button>
          <button type="button" class="continue">Continue</button>
        </div>
      </div>
    `;
    document.body.append(gate);
    const box = gate.querySelector<HTMLInputElement>('.reduced-gore')!;
    box.addEventListener('change', () => setReducedGore(box.checked));
    const continueButton = gate.querySelector<HTMLButtonElement>('.continue')!;
    continueButton.focus();
    continueButton.addEventListener('click', () => {
      acceptWarning();
      gate.remove();
      resolve();
    });
    gate.querySelector('.leave')!.addEventListener('click', () => {
      if (history.length > 1) history.back();
      else window.close();
      // Still here (a fresh tab, or an embed that can't navigate): say so instead.
      window.setTimeout(() => {
        gate.querySelector('.content-warning-card')!.innerHTML =
          '<h2>Goodbye</h2><p>You can close this window. Nothing else will load.</p>';
      }, 300);
    });
  });
}

/** A short notice over the scene that fades by itself, for things the player should know but need not act on (#245). */
export function showNotice(text: string, ms = 4500): void {
  const el = document.createElement('div');
  el.className = 'notice-toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  window.setTimeout(() => el.remove(), ms);
}

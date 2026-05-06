const getEl = () => document.getElementById('d2d-tx-spinner');
const getTextEl = () => document.getElementById('d2d-tx-spinner-text');
const getRing = () => getEl()?.querySelector('.spinner-ring') as HTMLElement | null;

let active = false;

// Auto-transition: when proof completes, switch text to "Waiting Transaction"
window.addEventListener('d2d-proof-complete', () => {
  if (active) {
    const textEl = getTextEl();
    if (textEl) textEl.textContent = 'Waiting Transaction';
  }
});

// Auto-transition: when batcher confirms TX, show the TX hash briefly
window.addEventListener('d2d-tx-submitted', ((e: CustomEvent<{ txHash: string }>) => {
  if (active) {
    const txHash = e.detail.txHash;
    const short = txHash.length > 16 ? txHash.slice(0, 8) + '\u2026' + txHash.slice(-8) : txHash;
    const textEl = getTextEl();
    if (textEl) textEl.textContent = `TX: ${short}`;
  }
}) as EventListener);

export const txSpinner = {
  show(text: string): void {
    active = true;
    const el = getEl();
    const ring = getRing();
    if (el) el.style.display = 'flex';
    if (ring) ring.style.display = '';
    const textEl = getTextEl();
    if (textEl) textEl.textContent = text;
  },

  hide(): void {
    active = false;
    const el = getEl();
    if (el) el.style.display = 'none';
  },
};

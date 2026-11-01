/**
 * The pointer in cell coordinates, shared by the sill (grab, drag) and the weather (wind).
 * `overUi` is set while it is over the text panels, where the scene should not react.
 */
export const pointer = { x: -99, y: -99, vx: 0, vy: 0, inside: false, overUi: false, down: false };

let grid = null;
let lastAt = 0;

const UI = '.head, .prose, .actions, button, a, .unhide';

export function bindGrid(g) {
  grid = g;
}

export function toCell(e) {
  if (!grid) return [-99, -99];
  return [(e.clientX - grid.offsetX) / grid.cellWidth, (e.clientY - grid.offsetY) / grid.cellHeight];
}

addEventListener('pointermove', (e) => {
  const [x, y] = toCell(e);
  const now = performance.now();
  const dt = Math.max(0.008, (now - lastAt) / 1000);
  if (pointer.inside && now - lastAt < 200) {
    // smoothed velocity in cells per second
    pointer.vx += ((x - pointer.x) / dt - pointer.vx) * 0.5;
    pointer.vy += ((y - pointer.y) / dt - pointer.vy) * 0.5;
  }
  lastAt = now;
  pointer.x = x;
  pointer.y = y;
  pointer.inside = true;
  pointer.overUi = !pointer.down && !!e.target.closest?.(UI);
});
addEventListener('pointerdown', () => { pointer.down = true; });
addEventListener('pointerup', () => { pointer.down = false; });
addEventListener('pointercancel', () => { pointer.down = false; });
document.addEventListener('pointerleave', () => { pointer.inside = false; });
document.documentElement.addEventListener('mouseleave', () => { pointer.inside = false; });

/** Velocity fades when the pointer rests. */
export function settlePointer(dt) {
  const k = Math.exp(-dt * 6);
  pointer.vx *= k;
  pointer.vy *= k;
}

import { mix, scale } from './util.js';

/** Window frame and sill. Drawn last; the things on the sill are in sill.js. */
export const sillRow = (rows) => rows - 3;

export function drawForeground(ctx) {
  const { buf, cols, rows, clock } = ctx;
  const d = clock.daylight;
  const wood = mix([24, 24, 32], [104, 90, 78], d);
  const bevel = scale(wood, 1.25);
  const ft = cols > 80 ? 2 : 1;
  const sillTop = sillRow(rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const inFrame = c < ft || c >= cols - ft || r < ft;
      const inSill = r >= sillTop;
      if (!inFrame && !inSill) continue;
      let bg = wood;
      let ch = ' ';
      if (inSill) {
        bg = r === sillTop ? scale(wood, 1.35) : scale(wood, 1 - (r - sillTop) * 0.12);
        if (r === sillTop) { ch = '_'; }
      } else if (c === ft - 1 || c === cols - ft || r === ft - 1) {
        bg = bevel;
      }
      buf.put(c, r, ch, bevel, bg);
    }
  }
  // inner shadow under the top rail and beside the uprights
  for (let c = ft; c < cols - ft; c++) buf.tint(c, ft, [0, 0, 0], 0.22);
  for (let r = ft; r < sillTop; r++) { buf.tint(ft, r, [0, 0, 0], 0.16); buf.tint(cols - ft - 1, r, [0, 0, 0], 0.16); }
}

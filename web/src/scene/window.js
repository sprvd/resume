import { hash2, mix, scale } from './util.js';

/** Window frame and sill. Drawn last; the things on the sill are in sill.js. */
export const sillRow = (rows) => rows - 4;
export const frameWidth = (cols) => (cols > 80 ? 3 : 2);

/** Wood grain: long strokes along the board, a knot now and then. */
function grain(c, r, along) {
  const h = hash2(along ? c >> 2 : c, along ? r : r >> 2, 21);
  if (h < 0.04) return 'o';
  if (h < 0.3) return along ? '~' : ')';
  return along ? (r % 2 ? '=' : '-') : (c % 2 ? '|' : ':');
}

export function drawForeground(ctx) {
  const { buf, cols, rows, clock } = ctx;
  const d = clock.daylight;
  const wood = mix([30, 28, 38], [118, 98, 80], d);
  const ft = frameWidth(cols);
  const sillTop = sillRow(rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const inFrame = c < ft || c >= cols - ft || r < ft;
      const inSill = r >= sillTop;
      if (!inFrame && !inSill) continue;
      let tone = 1;
      if (inSill) tone = r === sillTop ? 1.4 : 1 - (r - sillTop) * 0.14;
      else if (c === ft - 1 || c === cols - ft || r === ft - 1) tone = 1.3;
      const col = scale(wood, tone * (0.92 + 0.16 * hash2(c >> 3, r, 5)));
      const along = inSill || r < ft;
      buf.put(c, r, r === sillTop ? '_' : grain(c, r, along), scale(col, 1.5), scale(col, 0.42));
    }
  }
  // inner shadow under the top rail and beside the uprights
  for (let c = ft; c < cols - ft; c++) buf.tint(c, ft, [0, 0, 0], 0.3);
  for (let r = ft; r < sillTop; r++) { buf.tint(ft, r, [0, 0, 0], 0.22); buf.tint(cols - ft - 1, r, [0, 0, 0], 0.22); }
}

import { mix, scale } from './util.js';
import { drawSillCat } from './cat.js';

const CERAMIC = [214, 208, 192];
const TERRACOTTA = [178, 94, 66];
const LEAF = {
  winter: [[96, 130, 104], [120, 150, 124]],
  spring: [[96, 190, 104], [244, 150, 190]],
  summer: [[60, 168, 84], [100, 204, 96]],
  autumn: [[210, 130, 44], [228, 176, 60]],
};

/** Window frame, sill, and the things sitting on it. Drawn last. */
export function drawForeground(ctx) {
  const { buf, cols, rows, clock, time } = ctx;
  const d = clock.daylight;
  const wood = mix([24, 24, 32], [104, 90, 78], d);
  const bevel = scale(wood, 1.25);
  const ft = cols > 80 ? 2 : 1;
  const sillTop = rows - 3;

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

  if (cols < 64) return;
  // cat on the left; mug and plant on the right, clear of the text column
  drawSillCat(ctx, ft + 3, sillTop - 1);
  const plantX = cols - ft - 8;
  drawMug(buf, plantX - 10, sillTop, time, clock);
  drawPlant(buf, plantX, sillTop, clock.season, time);
}

function drawMug(buf, x, sill, time, clock) {
  const lit = mix(CERAMIC, [60, 62, 80], clock.night * 0.5);
  for (let r = sill - 3; r < sill; r++) for (let c = x; c < x + 4; c++) buf.put(c, r, ' ', lit, lit);
  buf.put(x + 1, sill - 3, ' ', lit, [64, 38, 26]);
  buf.put(x + 2, sill - 3, ' ', lit, [64, 38, 26]);
  buf.ink(x + 4, sill - 2, ')', lit);
  for (let k = 0; k < 3; k++) {
    for (let j = 1; j <= 4; j++) {
      const sway = Math.sin(time * 1.6 + k * 2 + j * 0.9) * (0.4 + j * 0.25);
      buf.ink(x + 1 + k * 0.6 + sway, sill - 3 - j, (j + k) % 2 ? '(' : ')', [230, 236, 248], 0.75 - j * 0.15);
    }
  }
}

function drawPlant(buf, x, sill, season, time) {
  const [leaf, accent] = LEAF[season];
  buf.put(x + 1, sill - 1, ' ', TERRACOTTA, TERRACOTTA);
  buf.put(x + 2, sill - 1, ' ', TERRACOTTA, TERRACOTTA);
  buf.put(x + 3, sill - 1, ' ', TERRACOTTA, TERRACOTTA);
  for (let c = x; c <= x + 4; c++) buf.put(c, sill - 2, ' ', TERRACOTTA, scale(TERRACOTTA, 1.12));
  const sway = Math.round(Math.sin(time * 0.9));
  const rows = [
    [[0, '\\'], [2, '|'], [4, '/']],
    [[1, '\\'], [2, '|'], [3, '/']],
  ];
  rows.forEach((row, i) => row.forEach(([dx, ch]) => buf.ink(x + dx + (i === 0 ? sway : 0), sill - 4 - i, ch, leaf)));
  buf.ink(x + 2, sill - 3, '|', leaf);
  buf.ink(x + sway, sill - 5, season === 'spring' ? '*' : season === 'winter' ? '.' : '@', accent);
  buf.ink(x + 4 + sway, sill - 5, season === 'spring' ? '*' : 'o', accent);
}

import { clamp01, mix, scale } from './util.js';

// Pixel art for the things on the sill: a black cat, an alarm clock's case and a potted plant.
// They are drawn into small RGBA grids (y up from the bottom edge) and blown up onto the overlay
// canvas with blit().

const FUR = [26, 24, 32];
const EAR = [228, 220, 226];
const EYE = [246, 212, 116];
const PUPIL = [20, 16, 18];
const WHISKER = [208, 208, 220];
const TERRACOTTA = [184, 98, 68];
export const INK = [54, 30, 18];
export const SOIL = [72, 48, 34];
export const LEAF = {
  winter: [[84, 122, 98], [112, 148, 120]],
  spring: [[86, 184, 98], [248, 160, 196]],
  summer: [[52, 162, 80], [96, 202, 94]],
  autumn: [[204, 124, 40], [230, 176, 58]],
};

/**
 * The cat is drawn in cell units (one old text cell) scaled by `k` pixels a unit. WIDTH is the
 * visible body without the tail, HEAD the top of the head, both in those units.
 */
export const CAT = { w: 64, h: 84, k: 4.1, WIDTH: 11, HEAD: [4.8, 15] };
/** The clock: its pixel grid, the centre of the dial, and the radii of the dial window and the case. */
export const CLOCK = { w: 26, h: 29, cx: 13, cy: 13, dial: 8.4, case: 11.2 };
export const PLANT = { w: 32, h: 26 };

/** RGBA pixel grid, y up from the bottom edge. */
export class Pix {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.img = new ImageData(w, h);
  }

  clear() {
    this.img.data.fill(0);
  }

  set(x, y, col, a = 255) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const k = ((this.h - 1 - y) * this.w + x) * 4;
    const d = this.img.data;
    if (a >= 255 || d[k + 3] === 0) {
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = a;
    } else {
      const f = a / 255;
      d[k] += (col[0] - d[k]) * f; d[k + 1] += (col[1] - d[k + 1]) * f; d[k + 2] += (col[2] - d[k + 2]) * f;
      d[k + 3] = Math.max(d[k + 3], a);
    }
  }

  alphaAt(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.img.data[((this.h - 1 - y) * this.w + x) * 4 + 3];
  }

  /** One-pixel edge around everything drawn so far. */
  outline(col) {
    const mark = [];
    for (let y = -1; y <= this.h; y++) {
      for (let x = -1; x <= this.w; x++) {
        if (this.alphaAt(x, y)) continue;
        if (this.alphaAt(x + 1, y) || this.alphaAt(x - 1, y) || this.alphaAt(x, y + 1) || this.alphaAt(x, y - 1)) mark.push([x, y]);
      }
    }
    for (const [x, y] of mark) this.set(x, y, col);
  }

  /** Tight bounds of what was drawn, [x0, y0, x1, y1], for hit-testing. */
  bounds() {
    let x0 = this.w, x1 = 0, y0 = this.h, y1 = 0;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!this.alphaAt(x, y)) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    return [x0, y0, x1, y1];
  }
}

/** Blow a sprite up `P` times onto the canvas, its bottom-left corner at (x, bottom). */
export function blit(c2, pix, x, bottom, P, { dx = 0, dy = 0 } = {}) {
  if (!pix.off) {
    pix.off = document.createElement('canvas');
    pix.off.width = pix.w;
    pix.off.height = pix.h;
  }
  pix.off.getContext('2d').putImageData(pix.img, 0, 0);
  c2.drawImage(pix.off, Math.round(x + dx), Math.round(bottom - pix.h * P + dy), pix.w * P, pix.h * P);
}

function line(pix, x0, y0, x1, y1, col) {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) || 1;
  for (let i = 0; i <= n; i++) pix.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, col);
}

/** Shapes in cell units (k converts to pixels), shaded from the upper left and banded like pixel art. */
function brush(pix, amb, k) {
  const shade = (col, l, rim) => scale(col, amb * (0.7 + 0.34 * (Math.round(l * 3) / 3)) * (rim ? 0.86 : 1));
  const cx = (v) => v * k;
  return {
    k,
    ellipse(ex, ey, rx, ry, col, { rot = 0 } = {}) {
      ex = cx(ex); ey = cx(ey); rx = cx(rx); ry = cx(ry);
      const m = Math.max(rx, ry) + 1;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      for (let y = Math.floor(ey - m); y <= ey + m; y++) {
        for (let x = Math.floor(ex - m); x <= ex + m; x++) {
          const dx = x + 0.5 - ex;
          const dy = y + 0.5 - ey;
          const nx = (dx * cos + dy * sin) / rx;
          const ny = (-dx * sin + dy * cos) / ry;
          const e = nx * nx + ny * ny;
          if (e > 1) continue;
          pix.set(x, y, shade(col, clamp01(0.55 - nx * 0.28 + ny * 0.5 - e * 0.25), e > 0.8));
        }
      }
    },
    tri(a, b, c, col) {
      const [A, B, C] = [a, b, c].map(([x, y]) => [cx(x), cx(y)]);
      const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
      const x0 = Math.floor(Math.min(A[0], B[0], C[0]));
      const x1 = Math.ceil(Math.max(A[0], B[0], C[0]));
      const y0 = Math.floor(Math.min(A[1], B[1], C[1]));
      const y1 = Math.ceil(Math.max(A[1], B[1], C[1]));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const p = [x + 0.5, y + 0.5];
          const d1 = sign(p, A, B);
          const d2 = sign(p, B, C);
          const d3 = sign(p, C, A);
          if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) {
            pix.set(x, y, shade(col, clamp01((y - y0) / (y1 - y0 + 1) + 0.2), false));
          }
        }
      }
    },
    /** Pointed ears, mirrored around x = `mirror` / 2, with a pale inner triangle. */
    ears(outer, mirror, inner) {
      const flip = (t) => t.map(([x, y]) => [mirror - x, y]);
      this.tri(...outer, FUR);
      this.tri(...flip(outer), FUR);
      // the pale insides stay bright even at night
      const pale = scale(EAR, Math.max(amb, 0.9) / amb);
      this.tri(...inner, pale);
      this.tri(...flip(inner), pale);
    },
    px(x, y, col, a = 255) {
      pix.set(x, y, col, a);
    },
    /** Tail as a string of round segments. */
    tail(points, r) {
      for (const [x, y] of points) this.ellipse(x, y, r, r, FUR);
    },
    // details drawn on top of the outline, like whiskers that stick out past the head
    after: [],
  };
}

/** Rows of an open eye from the outer corner inwards, row 0 at the top, pupil in column `p`. */
const openEye = (p) => [
  [...'YYYYYY'].map((ch, c) => (c === p ? 'P' : c === p - 1 ? 'H' : ch)).join(''),
  [...'YYYYYY'].map((ch, c) => (c === p ? 'P' : ch)).join(''),
  '.YYYY.',
];

/**
 * Eyes and whiskers. `look` (-1 left … 1 right, null when the pointer is away) moves the pupils;
 * idle, they sit towards the nose and the cat looks a little smug.
 */
function face(g, x, y, { blink, happy, wide, look }) {
  const u = g.k;
  // the face is mirrored around the line between pixel columns px - 1 and px
  const px = Math.round(x * u);
  const py = Math.round(y * u);
  const gap = Math.round(0.75 * u);
  const lid = scale(EYE, 0.55);
  // eyes: 6 wide, 3 tall, drawn from the outer corner inwards
  const eye = (rows, left) => rows.forEach((row, r) => [...row].forEach((ch, c) => {
    const k = { Y: EYE, P: PUPIL, H: [255, 252, 240], L: lid }[ch];
    if (k) g.px(left ? px - gap - 6 + c : px + gap + 5 - c, py + 2 - r, k);
  }));
  let left, right;
  if (happy) left = right = ['......', '.LLLL.', 'L....L'];
  else if (blink) left = right = ['......', 'L....L', '.LLLL.'];
  else if (wide) left = right = ['YHPPYY', 'YPPPPY', '.YPPY.'];
  else if (look === null) left = right = openEye(4);
  else {
    // the inner corner of the left eye is on the right, of the right eye on the left
    left = openEye(Math.max(1, Math.min(4, Math.round(2.5 + 1.6 * look))));
    right = openEye(Math.max(1, Math.min(4, Math.round(2.5 - 1.6 * look))));
  }
  eye(left, true);
  eye(right, false);
  g.after.push(() => {
    // whiskers fan out past the cheeks
    for (let i = 0; i < 7; i++) {
      for (const s of [-1, 1]) {
        const c = s < 0 ? px - 1 - gap - 3 - i : px + gap + 3 + i;
        g.px(c, py - 4 + (i > 3 ? 1 : 0), WHISKER, 170 - i * 14);
        g.px(c, py - 6 - (i > 3 ? 1 : 0), WHISKER, 130 - i * 12);
      }
    }
  });
}

/**
 * The cat sits facing out, tail curled up beside it.
 *   t       animation clock (the tail flicks on it)
 *   breath  -1…1, how far the chest swells
 *   ears    > 0 pricks them up, < 0 lays them back
 *   lash    0…1, how hard the tail swings when it is cross
 *   eyes    { blink, happy, wide, look } for face()
 *   edge    outline colour
 */
export function drawCatPix(pix, amb, k, { t, breath, ears, lash, eyes, edge }) {
  pix.clear();
  const g = brush(pix, amb, k);
  const flick = Math.sin(t * (2.2 + lash * 7)) * (0.35 + lash * 0.9);
  g.tail([
    [6.6, 0.55], [7.5, 0.6], [8.4, 0.75], [9.2, 1.1], [9.8, 1.7], [10.2, 2.4], [10.4, 3.2], [10.5, 4.0],
    [10.5 + flick * 0.5, 4.8], [10.4 + flick, 5.5],
  ], 0.62);
  g.ellipse(4.8, 2.4, 3.3, 2.4, FUR); // haunches
  g.ellipse(4.8, 4.9, 2.7, 4.0 + breath * 0.5, FUR);
  // a wide skull with fuller cheeks below it
  g.ellipse(4.8, 9.6 + 2.8 * 0.12, 3.6 * 0.92, 2.8, FUR);
  g.ellipse(4.8, 9.6 - 2.8 * 0.25, 3.6, 2.8 * 0.7, FUR);
  const up = Math.max(0, ears) * 0.6;
  const back = Math.max(0, -ears) * 1.3;
  g.ears(
    [[1.3, 10.6], [1.8 - back, 14.8 + up - back], [4.3, 12.2]],
    9.6,
    [[1.9, 11.4], [2.2 - back * 0.8, 13.9 + up - back], [3.6, 12.0]],
  );
  face(g, 4.8, 9.4, eyes);
  pix.outline(edge);
  for (const f of g.after) f();
}

/** Alarm clock case with a round window cut where the dial goes; the dial itself is text. */
export function drawClockPix(pix, amb, ring, edge) {
  pix.clear();
  const { cx, cy, dial } = CLOCK;
  const body = scale([196, 74, 72], amb);
  // bells perched on top and the hammer between them, shaking while it rings
  const sh = ring ? 1 : 0;
  for (const s of [-1, 1]) {
    const bx = cx + s * 7 + s * sh;
    for (let y = 22; y < CLOCK.h; y++) {
      for (let x = Math.floor(bx - 4); x <= bx + 4; x++) {
        const dx = (x + 0.5 - bx) / 3.6;
        const dy = (y + 0.5 - 24) / 4.2;
        if (dy >= -0.2 && dx * dx + dy * dy <= 1) pix.set(x, y, scale(body, (ring ? 1.3 : 1.12) - dx * 0.2));
      }
    }
    // feet
    const fx = cx + s * 6 - (s > 0 ? 1 : 0);
    pix.set(fx, 0, scale(INK, 1.6));
    pix.set(fx, 1, scale(INK, 1.6));
    pix.set(fx + s, 0, scale(INK, 1.6));
  }
  line(pix, cx - 0.5, 24, cx - 0.5, 27, INK);
  line(pix, cx - 2 - sh, 27, cx + 1 + sh, 27, INK);
  // the case: a thick ring, lit from the upper left, with a darker lip around the window
  for (let y = 0; y < CLOCK.h; y++) {
    for (let x = 0; x < CLOCK.w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= CLOCK.case || d < dial) continue;
      const lit = 0.82 + 0.28 * clamp01(0.5 - (x - cx) / 22 + (y - cy) / 22);
      pix.set(x, y, d < dial + 0.9 ? scale(body, 0.55) : scale(body, lit));
    }
  }
  // a glint on the rim
  for (let a = 2.2; a < 2.9; a += 0.08) pix.set(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, scale([255, 220, 210], amb));
  pix.outline(edge);
}

/** A clay pot of long leaves that sway; `lean` tips them (the pot being carried, a shake). */
export function drawPlantPix(pix, amb, season, time, lean, edge) {
  const [leaf, accent] = LEAF[season];
  pix.clear();
  const g = brush(pix, amb, 1);
  const sway = Math.sin(time * 0.9) * 0.06 + lean;
  // pot, with soil showing at the rim
  for (let y = 0; y < 9; y++) {
    const half = y === 8 ? 8 : 7 - Math.floor((8 - y) * 0.15);
    for (let x = 16 - half; x < 16 + half; x++) pix.set(x, y, scale(TERRACOTTA, amb * (y === 8 ? 1.18 : 0.8 + 0.25 * clamp01(1 - (x - 8) / 16))));
  }
  for (let x = 10; x < 22; x++) pix.set(x, 7, scale(SOIL, amb));
  // leaves fan out from the soil, each on its stem
  const leaves = [[-1.3, 8.5], [-0.85, 11], [-0.4, 13], [0.05, 14], [0.5, 12.5], [0.95, 10.5], [1.35, 8], [-0.15, 9.5]];
  leaves.forEach(([a, len], i) => {
    const ang = a + sway * (1 + i * 0.1);
    const tx = 16 + Math.sin(ang) * len;
    const ty = 8 + Math.cos(ang) * len;
    for (let s = 0; s <= 1; s += 0.05) pix.set(16 + (tx - 16) * s, 8 + (ty - 8) * s, scale(mix(leaf, [30, 80, 40], 0.4), amb));
    const col = i % 2 && accent !== leaf ? mix(leaf, [255, 255, 255], 0.12) : leaf;
    g.ellipse(tx, ty, 1.5, 3.6, col, { rot: -ang });
  });
  // a bloom (or berries) at the top, except in winter
  const bx = 16 + Math.sin(sway * 2) * 2;
  if (season !== 'winter') for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) pix.set(bx + dx, 22 + dy, scale(dx || dy ? accent : [250, 224, 120], amb));
  pix.outline(edge);
}

const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];

/** Three pixel hearts rising from (x, y); `p0` runs 0…1 over their life. */
export function drawHearts(c2, x, y, P, p0) {
  c2.fillStyle = '#ff7a9a';
  for (let i = 0; i < 3; i++) {
    const p = p0 - i * 0.16;
    if (p <= 0 || p >= 1) continue;
    c2.globalAlpha = Math.min(1, (1 - p) * 1.6);
    const hx = x + (i - 1) * 7 * P + Math.sin(p * 7 + i) * 2 * P;
    const hy = y - p * 22 * P;
    HEART.forEach((row, r) => [...row].forEach((ch, cc) => ch === '#' && c2.fillRect(Math.round(hx + cc * P), Math.round(hy + r * P), P, P)));
  }
  c2.globalAlpha = 1;
}

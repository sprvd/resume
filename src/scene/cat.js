import { clamp01, hash2, scale } from './util.js';

const FUR = [220, 146, 74];
const DARK = [160, 94, 44];
const LIGHT = [244, 198, 142];
const WHITE = [246, 236, 214];
const PINK = [236, 150, 160];
const EYE = [244, 222, 80];
const TEXTURE = ['~', ',', '`', "'", '"'];
const forced = new URLSearchParams(location.search).get('cat');
const POSES = ['loaf', 'curled', 'sprawl', 'sit'];
const SCALE = { loaf: 1.2, curled: 1.4, sprawl: 1.1, sit: 1.3 };

function pickPose(clock, time) {
  if (POSES.includes(forced)) return forced;
  const h = hash2(Math.floor(time / 90), 3, 99);
  if (clock.twilight > 0.55) return 'sit';
  if (clock.night > 0.6) return h < 0.22 ? 'sit' : clock.season === 'winter' || h < 0.7 ? 'curled' : 'loaf';
  if (clock.season === 'summer') return h < 0.7 ? 'sprawl' : 'loaf';
  if (clock.season === 'winter') return 'curled';
  return h < 0.25 ? 'sit' : 'loaf';
}

/**
 * The cat is drawn from soft shapes in cell units: x to the right, y up from the sill, (0, 0) at the
 * bottom-left cell. Later shapes paint over earlier ones.
 */
function painter(ctx, x0, bottom, amb, S) {
  const { buf } = ctx;
  const W = Math.ceil(28 * S);
  const H = Math.ceil(15 * S);
  const cellsIn = (fn) => {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) fn(i + 0.5, j + 0.5, x0 + i, bottom - j);
  };
  const put = (c, r, col) => buf.put(c, r, ' ', col, col);
  const shade = (col, ny, rim) => scale(col, amb * (0.9 + 0.16 * ny) * (rim ? 0.8 : 1));
  const cx = (px) => x0 + Math.floor(px * S);
  const cy = (py) => bottom - Math.floor(py * S);

  return {
    ellipse(ex, ey, rx, ry, col, fur = false) {
      ex *= S; ey *= S; rx *= S; ry *= S;
      cellsIn((px, py, c, r) => {
        const nx = (px - ex) / rx;
        const ny = (py - ey) / ry;
        const e = nx * nx + ny * ny;
        if (e > 1) return;
        let k = col;
        if (fur && Math.sin(px * 1.0 + py * 0.3) > 0.6 && ny > -0.5) k = scale(col, 0.8);
        const c2 = shade(k, ny, e > 0.78);
        put(c, r, c2);
        if (fur && hash2(c, r, 17) < 0.42) buf.ink(c, r, TEXTURE[Math.floor(hash2(c, r, 18) * TEXTURE.length)], scale(c2, 0.8));
      });
    },
    tri(a, b, c3, col) {
      const [A, B, C] = [a, b, c3].map(([x, y]) => [x * S, y * S]);
      const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
      cellsIn((px, py, c, r) => {
        const p = [px, py];
        const d1 = sign(p, A, B);
        const d2 = sign(p, B, C);
        const d3 = sign(p, C, A);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) put(c, r, shade(col, 0.4, false));
      });
    },
    ears(l, mirror, inner) {
      this.tri(l[0], l[1], l[2], FUR);
      this.tri(...l.map(([x, y]) => [mirror - x, y]), FUR);
      this.tri(inner[0], inner[1], inner[2], PINK);
      this.tri(...inner.map(([x, y]) => [mirror - x, y]), PINK);
    },
    closedEye(px, py) {
      put(cx(px), cy(py), DARK);
      put(cx(px) + 1, cy(py), DARK);
    },
    dot(px, py, col) {
      put(cx(px), cy(py), col);
    },
    glyph(px, py, ch, col, a = 1) {
      buf.ink(cx(px), cy(py), ch, col, a);
    },
    eyeOpen(px, py) {
      for (const dy of [0, 1]) buf.put(cx(px), cy(py) - dy, '|', [34, 26, 10], EYE);
    },
    tail(points, r = 0.85) {
      for (const [tx, ty] of points) this.ellipse(tx, ty, r, r, DARK);
    },
  };
}

function zzz(ctx, x, y) {
  const { buf, time } = ctx;
  for (let k = 0; k < 3; k++) {
    const p = (time * 0.35 + k / 3) % 1;
    buf.ink(x + p * 5 + Math.sin(p * 6), y - p * 6, p < 0.45 ? 'z' : 'Z', [226, 232, 255], (1 - p) * 0.9);
  }
}

const POSE = {
  loaf(g, ctx, breath) {
    g.tail([0, 1, 2, 3, 4, 5, 6].map((i) => [18.2 + i * 0.85, 0.7 + Math.max(0, i - 3) * 0.9]));
    g.ellipse(10.8, 3, 8.3, 3.1 + breath, FUR, true);
    g.ellipse(2.8, 0.7, 1.7, 0.7, WHITE);
    g.ellipse(3.9, 3.1, 3.1, 2.9, FUR, true);
    g.ears([[0.9, 4.4], [1.4, 8.0], [3.9, 5.6]], 7.8, [[1.5, 4.9], [1.8, 7.0], [3.2, 5.6]]);
    g.ellipse(3.9, 2.0, 1.6, 1.0, LIGHT);
    g.closedEye(2.3, 3.4);
    g.closedEye(4.9, 3.4);
    g.dot(3.9, 2.5, PINK);
    g.glyph(0.5, 2.4, '-', WHITE, 0.8);
    g.glyph(7.2, 2.4, '-', WHITE, 0.8);
    return [4, 9];
  },
  curled(g, ctx, breath) {
    g.tail([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => [3 + i * 1.0, 0.6 + 0.3 * Math.sin(i * 0.5)]));
    g.ellipse(7.4, 3.3, 6.0, 3.3 + breath, FUR, true);
    g.ellipse(3.4, 3.0, 2.5, 2.3, FUR, true);
    g.ears([[1.2, 4.2], [1.8, 6.9], [3.5, 5.0]], 6.8, [[1.8, 4.7], [2.1, 6.1], [3.1, 5.0]]);
    g.ellipse(3.4, 2.0, 1.2, 0.8, LIGHT);
    g.closedEye(2.1, 3.1);
    g.closedEye(4.0, 3.1);
    g.dot(3.4, 2.3, PINK);
    g.ellipse(1.6, 0.6, 1.0, 0.6, WHITE);
    return [3, 8];
  },
  sprawl(g, ctx, breath) {
    g.tail([0, 1, 2, 3, 4, 5].map((i) => [20.4 + i * 0.85, 0.8 + (i > 3 ? 0.5 : 0)]));
    g.ellipse(11.4, 2, 8.4, 2 + breath, FUR, true);
    g.ellipse(18, 1.3, 2.4, 1.1, FUR, true);
    g.ellipse(20.2, 0.7, 1.0, 0.6, WHITE);
    g.ellipse(3.3, 2.2, 2.7, 2.2, FUR, true);
    g.ears([[1.0, 3.6], [1.6, 5.9], [3.3, 4.3]], 6.6, [[1.6, 4.0], [1.9, 5.2], [2.8, 4.3]]);
    g.ellipse(3.3, 1.5, 1.3, 0.8, LIGHT);
    g.ellipse(1.1, 0.6, 1.3, 0.6, WHITE);
    g.closedEye(2.0, 2.5);
    g.closedEye(4.0, 2.5);
    g.dot(3.3, 1.7, PINK);
    return [3, 7];
  },
  sit(g, ctx) {
    const { time } = ctx;
    g.tail([0, 1, 2, 3, 4, 5, 6, 7].map((i) => [9.4 + Math.sin(time * 2 + i * 0.4) * 0.5 * (i / 7) + i * 0.1, 0.8 + i * 0.75]), 0.8);
    g.ellipse(5, 2.4, 4.3, 2.5, FUR, true);
    g.ellipse(4.6, 5.0, 3.0, 4.0, FUR, true);
    g.ellipse(4.4, 4.2, 1.3, 2.2, WHITE);
    g.ellipse(3.6, 1.2, 0.9, 1.3, LIGHT);
    g.ellipse(5.6, 1.2, 0.9, 1.3, LIGHT);
    g.ellipse(3.6, 0.5, 1.0, 0.5, WHITE);
    g.ellipse(5.6, 0.5, 1.0, 0.5, WHITE);
    g.ellipse(4.6, 9.6, 3.0, 2.7, FUR, true);
    g.ears([[1.7, 10.4], [2.4, 13.9], [4.5, 11.6]], 9.2, [[2.4, 10.9], [2.8, 13.0], [4.0, 11.6]]);
    g.ellipse(4.6, 8.7, 1.5, 1.0, LIGHT);
    g.eyeOpen(3.6, 10.0);
    g.eyeOpen(5.6, 10.0);
    g.dot(4.6, 9.1, PINK);
    g.glyph(1.2, 8.8, '-', WHITE, 0.8);
    g.glyph(8.0, 8.8, '-', WHITE, 0.8);
    return null;
  },
};

/** Cat on the sill; `bottom` is the buffer row just above the sill. */
export function drawSillCat(ctx, x, bottom) {
  const { clock, time } = ctx;
  const name = pickPose(clock, time);
  const amb = 0.6 + 0.4 * clamp01(clock.daylight + 0.15);
  const breath = 0.16 * Math.sin(time * 2.3);
  const S = SCALE[name];
  const zAt = POSE[name](painter(ctx, x, bottom, amb, S), ctx, breath);
  if (zAt) zzz(ctx, x + zAt[0] * S, bottom - zAt[1] * S - 3);
}

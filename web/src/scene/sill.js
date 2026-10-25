import { clamp01, mix, scale } from './util.js';

// Things on the sill are pixel art on a canvas over the text scene: one pixel is half a cell,
// so they carry twice the detail a cell-sized sprite could.

// a black cat: flat silhouette with pale ears and eyes
const FUR = [26, 24, 32];
const EAR = [228, 220, 226];
const EYE = [246, 212, 116];
const PUPIL = [20, 16, 18];
const WHISKER = [208, 208, 220];
const INK = [54, 30, 18];
const TERRACOTTA = [184, 98, 68];
const LEAF = {
  winter: [[84, 122, 98], [112, 148, 120]],
  spring: [[86, 184, 98], [248, 160, 196]],
  summer: [[52, 162, 80], [96, 202, 94]],
  autumn: [[204, 124, 40], [230, 176, 58]],
};

// cell-unit coordinates below are multiplied by 2 * SCALE to get pixels
const SCALE = 2.05;
// visible body width in cell units (tail excluded) and the top of the head, for fitting and hearts
const WIDTH = 11;
const HEAD = [4.8, 15];

/** RGBA pixel grid, y up from the bottom edge. */
class Pix {
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

  /** Dark one-pixel edge around everything drawn so far. */
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
}

/** Shapes in cell units (k converts to pixels), shaded from the upper left and banded like pixel art. */
function brush(pix, amb, k) {
  const shade = (col, l, rim) => scale(col, amb * (0.7 + 0.34 * (Math.round(l * 3) / 3)) * (rim ? 0.86 : 1));
  const cx = (v) => v * k;
  return {
    k,
    shade,
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

/** Eyes and whiskers. */
function face(g, x, y, { blink, happy }) {
  const u = g.k;
  // the face is mirrored around the line between pixel columns px - 1 and px
  const px = Math.round(x * u);
  const py = Math.round(y * u);
  const gap = Math.round(0.75 * u);
  const lid = scale(EYE, 0.55);
  // eyes: 6 wide, 3 tall, from the outer corner inwards; row 0 is the bottom
  // the flat top makes them look half-closed and a little smug; the pupils sit towards the nose
  const eye = (rows, col) => rows.forEach((row, r) => [...row].forEach((ch, c) => {
    const k = { Y: col, P: PUPIL, H: [255, 252, 240], L: lid }[ch];
    if (!k) return;
    g.px(px - gap - 6 + c, py + 2 - r, k);
    g.px(px + gap + 5 - c, py + 2 - r, k);
  }));
  if (happy) eye(['......', '.LLLL.', 'L....L'], EYE);
  else if (!blink) eye(['YYYHPY', 'YYYYPY', '.YYYY.'], EYE);
  else eye(['......', 'L....L', '.LLLL.'], EYE);
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

/** Wide skull with fuller cheeks below it. */
function head(g, x, y, rx, ry) {
  g.ellipse(x, y + ry * 0.12, rx * 0.92, ry, FUR);
  g.ellipse(x, y - ry * 0.25, rx, ry * 0.7, FUR);
}

/** The cat sits facing out, tail curled up beside it. */
function sit(g, t, breath, blink, happy) {
  // the tip of the tail flicks
  const flick = Math.sin(t * 2.2) * 0.35;
  g.tail([
    [6.6, 0.55], [7.5, 0.6], [8.4, 0.75], [9.2, 1.1], [9.8, 1.7], [10.2, 2.4], [10.4, 3.2], [10.5, 4.0],
    [10.5 + flick * 0.5, 4.8], [10.4 + flick, 5.5],
  ], 0.62);
  g.ellipse(4.8, 2.4, 3.3, 2.4, FUR); // haunches
  g.ellipse(4.8, 4.9, 2.7, 4.0 + breath * 0.5, FUR);
  head(g, 4.8, 9.6, 3.6, 2.8);
  g.ears([[1.3, 10.6], [1.8, 14.8], [4.3, 12.2]], 9.6, [[1.9, 11.4], [2.2, 13.9], [3.6, 12.0]]);
  face(g, 4.8, 9.4, { blink, happy });
}

// state shared by the click handlers and the draw loop
const st = { tapAt: -99, plantShake: -99, clockShake: -99 };
const HAPPY_FOR = 2.4;

function drawCat(ctx, pix, amb) {
  const { time, clock } = ctx;
  const g = brush(pix, amb, 2 * SCALE * (ctx.catFit ?? 1));
  const react = Math.max(0, 1 - (time - st.tapAt) / HAPPY_FOR);
  const breath = 0.16 * Math.sin(time * 2.3) + react * 0.12 * Math.sin(time * 9);
  const blink = (time * 0.2) % 1 > 0.97;
  pix.clear();
  sit(g, react ? time * 3 : time, breath, blink, react > 0);
  // a faint edge of moonlight at night, so the black cat never melts into the dark
  pix.outline(mix([70, 76, 112], [40, 36, 44], clock.daylight));
  for (const f of g.after) f();
  // tight bounds of what was drawn, for hit-testing
  let x0 = pix.w, x1 = 0, y0 = pix.h, y1 = 0;
  for (let y = 0; y < pix.h; y++) for (let x = 0; x < pix.w; x++) if (pix.alphaAt(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { k: g.k, react, bounds: [x0, y0, x1, y1] };
}

function line(pix, x0, y0, x1, y1, col) {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) || 1;
  for (let i = 0; i <= n; i++) pix.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, col);
}

/** Alarm clock whose hands follow the sky. */
function drawClockPix(pix, amb, hour, ring) {
  pix.clear();
  const body = scale([196, 74, 72], amb);
  const face = scale([240, 234, 214], Math.max(amb, 0.75));
  const cx = 8;
  const cy = 9;
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < 7.6) pix.set(x, y, d < 5.6 ? face : scale(body, 0.82 + 0.25 * clamp01(1 - x / 16)));
    }
  }
  // bells and feet
  for (const s of [-1, 1]) {
    for (const [dx, dy] of [[4, 16], [5, 16], [4, 17], [5, 17], [6, 16], [3, 15]]) pix.set(cx + s * dx - (s > 0 ? 1 : 0), dy, scale(body, 1.1));
    pix.set(cx + s * 4 - (s > 0 ? 1 : 0), 0, scale(INK, 1.6));
    pix.set(cx + s * 4 - (s > 0 ? 1 : 0), 1, scale(INK, 1.6));
  }
  pix.set(cx - 1, 17, INK); pix.set(cx, 17, INK);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pix.set(cx - 0.5 + Math.sin(a) * 4.6, cy - 0.5 + Math.cos(a) * 4.6, i % 3 ? scale(INK, 2) : INK);
  }
  const ha = ((hour % 12) / 12) * Math.PI * 2;
  const ma = (hour % 1) * Math.PI * 2;
  line(pix, cx, cy, cx + Math.sin(ha) * 3, cy + Math.cos(ha) * 3, INK);
  line(pix, cx, cy, cx + Math.sin(ma) * 4.4, cy + Math.cos(ma) * 4.4, scale([120, 50, 50], 1));
  pix.set(cx, cy, INK);
  pix.outline(scale(INK, amb));
  if (ring) pix.set(1, 17, [255, 220, 120]), pix.set(14, 17, [255, 220, 120]);
}

function drawPlantPix(pix, amb, season, time) {
  const [leaf, accent] = LEAF[season];
  pix.clear();
  const g = brush(pix, amb, 1);
  const sway = Math.sin(time * 0.9) * 0.06;
  // pot
  for (let y = 0; y < 9; y++) {
    const half = y === 8 ? 8 : 7 - Math.floor((8 - y) * 0.15);
    for (let x = 16 - half; x < 16 + half; x++) pix.set(x, y, scale(TERRACOTTA, amb * (y === 8 ? 1.18 : 0.8 + 0.25 * clamp01(1 - (x - 8) / 16))));
  }
  for (let x = 10; x < 22; x++) pix.set(x, 7, scale([72, 48, 34], amb)); // soil
  // leaves fan out from the soil
  const leaves = [[-1.3, 8.5], [-0.85, 11], [-0.4, 13], [0.05, 14], [0.5, 12.5], [0.95, 10.5], [1.35, 8], [-0.15, 9.5]];
  leaves.forEach(([a, len], i) => {
    const ang = a + sway * (1 + i * 0.1);
    const tx = 16 + Math.sin(ang) * len;
    const ty = 8 + Math.cos(ang) * len;
    // stem
    for (let s = 0; s <= 1; s += 0.05) pix.set(16 + (tx - 16) * s, 8 + (ty - 8) * s, scale(mix(leaf, [30, 80, 40], 0.4), amb));
    g.ellipse(tx, ty, 1.5, 3.6, i % 2 ? accent === leaf ? leaf : mix(leaf, [255, 255, 255], 0.12) : leaf, { rot: -ang });
  });
  // a bloom (or berries, or a bare tip)
  const bx = 16 + Math.sin(sway * 2) * 2;
  if (season !== 'winter') for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) pix.set(bx + dx, 22 + dy, scale(dx || dy ? accent : [250, 224, 120], amb));
  pix.outline(scale(INK, amb * 0.9));
}

const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];

function drawHearts(c2, x, y, P, p0) {
  for (let i = 0; i < 3; i++) {
    const p = p0 - i * 0.16;
    if (p <= 0 || p >= 1) continue;
    c2.globalAlpha = Math.min(1, (1 - p) * 1.6);
    c2.fillStyle = '#ff7a9a';
    const hx = x + (i - 1) * 7 * P + Math.sin(p * 7 + i) * 2 * P;
    const hy = y - p * 22 * P;
    HEART.forEach((row, r) => [...row].forEach((ch, cc) => ch === '#' && c2.fillRect(Math.round(hx + cc * P), Math.round(hy + r * P), P, P)));
  }
  c2.globalAlpha = 1;
}

function blit(c2, pix, x, bottom, P, { sy = 1, dx = 0, dy = 0 } = {}) {
  if (!pix.off) {
    pix.off = document.createElement('canvas');
    pix.off.width = pix.w;
    pix.off.height = pix.h;
  }
  pix.off.getContext('2d').putImageData(pix.img, 0, 0);
  const h = Math.round(pix.h * P * sy);
  c2.drawImage(pix.off, Math.round(x + dx), Math.round(bottom - h + dy), pix.w * P, h);
}

/**
 * Overlay canvas for the sill. The cat purrs when tapped, the clock skips ahead through the day and
 * the plant steps through the seasons. `actions` come from the scene.
 */
export function createSill(canvas, actions) {
  const c2 = canvas.getContext('2d');
  c2.imageSmoothingEnabled = false;
  const cat = new Pix(64, 84);
  const clockPix = new Pix(16, 19);
  const plant = new Pix(32, 26);
  let panelLeft = null;
  let hits = []; // { id, x, y, w, h } in CSS px, rebuilt every frame

  const hitAt = (e) => {
    if (e.target.closest?.('.head, .prose, .actions, button, a, .unhide')) return null;
    return hits.find((h) => e.clientX >= h.x && e.clientX <= h.x + h.w && e.clientY >= h.y && e.clientY <= h.y + h.h)?.id ?? null;
  };

  window.addEventListener('pointermove', (e) => {
    document.documentElement.style.cursor = hitAt(e) ? 'pointer' : '';
  });
  window.addEventListener('pointerdown', (e) => {
    const id = hitAt(e);
    if (!id) return;
    if (id === 'cat') {
      st.tapAt = actions.time();
    } else if (id === 'clock') {
      st.clockShake = actions.time();
      actions.skipHours(3);
    } else if (id === 'plant') {
      st.plantShake = actions.time();
      actions.nextSeason();
    }
  });

  return function drawSill(ctx, grid, sillTop) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(innerWidth * dpr);
    const h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      panelLeft = null;
    }
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.imageSmoothingEnabled = false;
    c2.clearRect(0, 0, w, h);
    hits = [];
    if (ctx.cols < 64) return;

    const { clock, time, cols } = ctx;
    const cw = grid.cellWidth * dpr;
    const P = Math.max(1, Math.floor(cw / 2));
    const ox = grid.offsetX * dpr;
    const bottom = (grid.offsetY + sillTop * grid.cellHeight) * dpr;
    const ft = cols > 80 ? 2 : 1;
    const amb = 0.6 + 0.4 * clamp01(clock.daylight + 0.15);
    const addHit = (id, x, y, bw, bh) => hits.push({ id, x: x / dpr, y: y / dpr, w: bw / dpr, h: bh / dpr });

    // shrink the cat a little if the text column would cover most of it
    if (panelLeft === null) panelLeft = document.querySelector('.head')?.getBoundingClientRect().left ?? innerWidth;
    const avail = (panelLeft - grid.offsetX) * dpr - (ft + 2) * cw;
    ctx.catFit = Math.max(0.85, Math.min(1.15, avail / (WIDTH * SCALE * cw)));

    const { k, react, bounds } = drawCat(ctx, cat, amb);
    const catX = ox + (ft + 2) * cw;
    const hopT = time - st.tapAt;
    blit(c2, cat, catX, bottom, P);
    addHit('cat', catX + bounds[0] * P, bottom - (bounds[3] + 1) * P, (bounds[2] - bounds[0] + 1) * P, (bounds[3] - bounds[1] + 1) * P);
    const [hx, hy] = HEAD;
    if (react > 0) drawHearts(c2, catX + hx * k * P, bottom - hy * k * P, P, hopT / HAPPY_FOR);

    // clock and plant, right-aligned clear of the text column
    const wobble = (since, amp) => (time - since < 0.6 ? Math.round(Math.sin((time - since) * 40) * amp * (1 - (time - since) / 0.6) * P) : 0);
    const plantX = ox + (cols - ft - 9) * cw - plant.w * P * 0.5;
    const clockX = plantX - 14 * P;
    drawClockPix(clockPix, amb, clock.hour, time - st.clockShake < 0.6);
    blit(c2, clockPix, clockX, bottom, P, { dx: wobble(st.clockShake, 1) });
    addHit('clock', clockX, bottom - clockPix.h * P, clockPix.w * P, clockPix.h * P);
    drawPlantPix(plant, amb, clock.season, time + (time - st.plantShake < 0.6 ? Math.sin((time - st.plantShake) * 30) * 0.6 : 0));
    blit(c2, plant, plantX, bottom, P);
    addHit('plant', plantX + 3 * P, bottom - 25 * P, 26 * P, 25 * P);
  };
}

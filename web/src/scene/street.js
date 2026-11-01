import { clamp01, fbm, hash2, lineGlyph, mix, mulberry32, scale } from './util.js';
import { MAT } from './buffer.js';

// The street below the window: pavement and road, lamps, trees between them, passing cars.

const CAR = ['.bbgg..', 'bbbbbbb', 'bwbbbwb'];
const CAR_COLORS = [[200, 60, 52], [60, 110, 190], [230, 230, 225], [44, 46, 54], [222, 172, 52], [70, 150, 100]];
const BARK = [70, 54, 44];
const POLE = [40, 44, 54];

// Foliage per season; winter trees stand bare.
const FOLIAGE = {
  summer: { leaves: [[40, 112, 54], [62, 142, 66], [92, 170, 78], [34, 92, 56]] },
  spring: { leaves: [[92, 164, 82], [126, 194, 98], [70, 140, 74]], bloom: [250, 178, 206] },
  autumn: { leaves: [[214, 110, 40], [232, 170, 58], [184, 64, 42], [160, 128, 52], [240, 196, 80]] },
};

export function createStreet(cols, rows, horizon) {
  const spacing = Math.max(18, Math.round(cols / 5));
  const height = Math.min(9, Math.max(5, Math.round(rows * 0.11)));
  const lamps = [];
  for (let x = 6; x < cols; x += spacing) lamps.push({ x, headX: x + 2, headY: horizon - height });

  // a tree between each pair of lamps
  const rng = mulberry32(cols * 31 + rows);
  const size = Math.min(10, Math.max(6, Math.round(rows * 0.09)));
  const trees = [];
  for (const lamp of lamps) {
    const x = lamp.x + Math.round(spacing * (0.42 + rng() * 0.16));
    if (x > cols - 4) continue;
    trees.push(createTree(rng, x, horizon, size + Math.round(rng() * 2 - 1)));
  }
  return { lamps, trees, cars: [], spawnIn: 1 };
}

/**
 * A tree's crown is a cluster of round lobes: a big one in the middle, smaller ones around its
 * shoulders and top, so it reads as clumps of leaves rather than one blob.
 */
function createTree(rng, x, horizon, size) {
  const trunk = 3 + Math.round(rng() * 2);
  const cy = horizon - trunk - size * 0.75;
  const lobes = [{ x, y: cy, r: size * 0.8 }];
  for (let i = 0; i < 5; i++) {
    const a = -1.4 + (i / 4) * 2.8 + (rng() - 0.5) * 0.4;
    const d = size * (0.55 + rng() * 0.2);
    lobes.push({ x: x + Math.sin(a) * d * 1.35, y: cy - Math.cos(a) * d * 0.8, r: size * (0.45 + rng() * 0.2) });
  }
  return { x, trunk, size, lobes, seed: Math.floor(rng() * 1e4) };
}

/** The crown's bounding box, for leaves that fall out of it. */
export function canopy(tree) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const l of tree.lobes) {
    x0 = Math.min(x0, l.x - l.r * 1.3);
    x1 = Math.max(x1, l.x + l.r * 1.3);
    y0 = Math.min(y0, l.y - l.r);
    y1 = Math.max(y1, l.y + l.r);
  }
  return { x0, x1, y0, y1 };
}

function drawTree(ctx, tree) {
  const { buf, horizon, clock, time, pal } = ctx;
  const d = clock.daylight;
  const bark = mix(scale(BARK, 0.35), BARK, 0.3 + 0.7 * d);
  const top = horizon - tree.trunk;

  // trunk, two glyphs thick, and branches fanning up into the crown
  buf.pen = MAT.wall;
  for (let r = horizon + 1; r > top - tree.size * 0.5; r--) {
    buf.put(tree.x, r, hash2(tree.x, r, 2) < 0.3 ? ')' : '|', scale(bark, 1.6), scale(bark, 0.6));
    if (r > top) buf.put(tree.x + 1, r, '|', scale(bark, 1.2), scale(bark, 0.5));
  }
  for (const a of [-1.1, -0.55, 0.55, 1.1]) {
    const len = tree.size * (0.7 + 0.25 * hash2(tree.seed, a * 10, 3));
    for (let s = 0.8; s < len; s += 0.6) {
      const bx = Math.round(tree.x + Math.sin(a) * s * 1.3);
      const by = Math.round(top - Math.cos(a) * s);
      buf.put(bx, by, lineGlyph(a), scale(bark, 1.5), scale(bark, 0.5));
      if (clock.season === 'winter' && hash2(bx, by, 6) < 0.5) buf.ink(bx, by - 1, '.', pal.snow, 0.9);
    }
  }

  const look = FOLIAGE[clock.season];
  if (!look) return;
  const sway = Math.sin(time * 0.8 + tree.seed) * 0.6 + Math.sin(time * 2.3 + tree.seed) * 0.2;
  const box = canopy(tree);
  buf.pen = MAT.leaf;
  for (let r = Math.floor(box.y0); r <= box.y1; r++) {
    // the crown moves more than the lower branches
    const shift = sway * clamp01((box.y1 - r) / (box.y1 - box.y0));
    for (let c = Math.floor(box.x0 - 1); c <= box.x1 + 1; c++) {
      // the strongest lobe under this cell, and where in it the cell sits
      let best = 0, lx = 0, ly = 0;
      for (const l of tree.lobes) {
        const dx = (c - shift - l.x) / (l.r * 1.3);
        const dy = (r - l.y) / l.r;
        const v = 1 - (dx * dx + dy * dy);
        if (v > best) { best = v; lx = dx; ly = dy; }
      }
      // ragged edges: noise eats into the outside of each lobe
      const n = fbm((c - shift) * 0.35, r * 0.45, tree.seed);
      if (best + (n - 0.5) * 0.7 < 0.08) continue;
      let col = look.leaves[Math.floor(hash2(c, r, tree.seed) * look.leaves.length)];
      if (look.bloom && hash2(c, r, tree.seed + 1) < 0.2) col = look.bloom;
      // each clump is lit on its upper left and shaded underneath; all of it darkens at night
      const lit = (0.95 - ly * 0.3 - lx * 0.15 + best * 0.2) * (0.22 + 0.78 * d);
      buf.setBg(c, r, scale(col, lit));
    }
  }
}

export function updateStreet(street, ctx, dt) {
  const { cols, horizon } = ctx;
  street.spawnIn -= dt;
  if (street.spawnIn <= 0 && street.cars.length < 4) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    street.cars.push({
      x: dir > 0 ? -8 : cols + 1,
      row: dir > 0 ? horizon + 2 : horizon + 6,
      dir,
      speed: 6 + Math.random() * 9,
      color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
    });
    street.spawnIn = 2.5 + Math.random() * 5;
  }
  for (const car of street.cars) car.x += car.dir * car.speed * dt;
  street.cars = street.cars.filter((car) => car.x > -10 && car.x < cols + 3);
}

function drawGround(ctx) {
  const { buf, cols, rows, horizon, pal, clock, time } = ctx;
  const winter = clock.season === 'winter';
  const wet = clock.season === 'spring';
  const walk = winter ? pal.snow : pal.sidewalk;
  const laneRow = horizon + 5;
  buf.pen = winter ? MAT.snow : MAT.road;
  for (let r = horizon; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let bg = r < horizon + 2 ? walk : pal.road;
      let ch = ' ';
      let fg = bg;
      if (winter && r >= horizon + 2) {
        const f = 0.55 + hash2(c, r, 3) * 0.4 + Math.sin(c * 0.13 + r) * 0.08;
        bg = mix(bg, pal.snow, clamp01(f));
        if (hash2(c, r, 4) < 0.06) { ch = '.'; fg = mix(bg, [255, 255, 255], 0.5); }
      }
      if (wet && r >= horizon + 2) bg = mix(bg, pal.horizon, 0.16 + 0.1 * Math.sin(c * 0.4 + r * 1.3 + time * 0.2));
      if (r === laneRow && Math.floor(c / 4) % 2 === 0) { ch = '-'; fg = mix(bg, [226, 214, 140], 0.7); }
      buf.put(c, r, ch, fg, bg);
    }
  }
}

function drawLamp(ctx, lamp) {
  const { buf, horizon, clock } = ctx;
  const night = clock.night;
  for (let r = lamp.headY + 1; r < horizon; r++) buf.ink(lamp.x, r, '|', POLE);
  buf.ink(lamp.x, lamp.headY, '-', POLE);
  buf.ink(lamp.x + 1, lamp.headY, '-', POLE);
  if (night > 0.25) {
    buf.ink(lamp.headX, lamp.headY, 'o', [255, 232, 160]);
    buf.glow(lamp.headX + 0.5, lamp.headY + 1, 9, [255, 196, 110], 0.62 * night);
    buf.glow(lamp.headX + 0.5, horizon + 3, 8, [255, 190, 100], 0.34 * night);
  } else {
    buf.ink(lamp.headX, lamp.headY, 'o', [150, 156, 166]);
  }
}

function drawCar(ctx, car) {
  const { buf, clock } = ctx;
  const night = clock.night;
  const flip = car.dir < 0;
  const cx = Math.round(car.x);
  buf.pen = MAT.metal;
  for (let y = 0; y < 3; y++) {
    for (let i = 0; i < 7; i++) {
      const code = CAR[y][flip ? 6 - i : i];
      if (code === '.') continue;
      const col = code === 'g' ? [120, 150, 180] : code === 'w' ? [26, 26, 32] : car.color;
      buf.setBg(cx + i, car.row + y, scale(col, 0.45 + 0.55 * clamp01(clock.daylight + 0.35)));
    }
  }
  if (night > 0.25) {
    const frontX = flip ? cx - 0.5 : cx + 7.5;
    buf.glow(frontX + car.dir * 2.5, car.row + 2, 6, [255, 236, 170], 0.55 * night);
    buf.glow(flip ? cx + 7.5 : cx - 0.5, car.row + 2, 3, [255, 40, 30], 0.5 * night);
  }
}

export function drawStreet(ctx, street) {
  drawGround(ctx);
  for (const tree of street.trees) drawTree(ctx, tree);
  for (const lamp of street.lamps) drawLamp(ctx, lamp);
  for (const car of street.cars) drawCar(ctx, car);
}

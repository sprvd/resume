import { clamp01, hash2, mix, mulberry32, scale } from './util.js';
import { WINDOW_LIT } from './palette.js';

const LAYERS = [
  { name: 'far', hMin: 0.16, hMax: 0.34, wMin: 6, wMax: 14, haze: 0.7, detail: 0 },
  { name: 'mid', hMin: 0.22, hMax: 0.46, wMin: 8, wMax: 18, haze: 0.4, detail: 1 },
  { name: 'near', hMin: 0.3, hMax: 0.58, wMin: 10, wMax: 24, haze: 0.1, detail: 2 },
];
const ROOFS_FAR = ['flat', 'antenna', 'step', 'flat'];
const ROOFS_NEAR = ['flat', 'antenna', 'tank', 'pitch', 'step', 'spire', 'flat'];
const CAR_COLORS = [[200, 60, 52], [60, 110, 190], [230, 230, 225], [44, 46, 54], [222, 172, 52], [70, 150, 100]];

export function buildSkyline(cols, horizon, seed = 20241210) {
  const rng = mulberry32(seed);
  const k = Math.min(1.4, Math.max(0.55, cols / 116));
  return LAYERS.map((L, li) => {
    const buildings = [];
    let x = -Math.floor(rng() * 6);
    while (x < cols) {
      const w = Math.max(4, Math.round((L.wMin + rng() * (L.wMax - L.wMin)) * k));
      const h = Math.max(4, Math.round(horizon * (L.hMin + (L.hMax - L.hMin) * rng() ** 1.2)));
      const roofs = li === 0 ? ROOFS_FAR : ROOFS_NEAR;
      buildings.push({
        x, w, h,
        roof: roofs[Math.floor(rng() * roofs.length)],
        seed: Math.floor(rng() * 1e6),
        occ: 0.35 + rng() * 0.65,
        tone: 0.9 + rng() * 0.2,
      });
      x += w + (li === 2 ? Math.floor(rng() * 2) : Math.floor(rng() * 3));
    }
    return { ...L, buildings };
  });
}

/** Share of windows lit by hour of day. */
function activity(hour) {
  if (hour >= 17 && hour < 23.5) return 0.62;
  if (hour >= 23.5 || hour < 1.5) return 0.34;
  if (hour >= 1.5 && hour < 5.5) return 0.1;
  if (hour >= 5.5 && hour < 8.5) return 0.4;
  return 0.07;
}

function windowColor(ctx, b, c, r) {
  const { clock, time } = ctx;
  const slot = Math.floor(time / (30 + 90 * hash2(c, r, b.seed + 1)));
  const lit = hash2(c, r, b.seed + slot * 13) < b.occ * activity(clock.hour);
  if (!lit) return null;
  const h = hash2(c, r, b.seed + 5);
  if (h < 0.12) {
    const flick = 0.75 + 0.25 * Math.sin(time * 6 + h * 90);
    return [120 * flick, 170 * flick, 255 * flick];
  }
  return mix(WINDOW_LIT, [255, 238, 190], h);
}

function drawBlock(ctx, layer, b, x, w, y0, y1, body) {
  const { buf, cols, clock, pal, time } = ctx;
  const day = clock.daylight;
  const glass = mix(scale(body, 0.72), pal.horizon, 0.5 * day);
  for (let r = y0; r < y1; r++) {
    const ly = r - y0;
    for (let lx = 0; lx < w; lx++) {
      const c = x + lx;
      if (c < 0 || c >= cols) continue;
      let bg = body;
      if (lx === 0) bg = scale(body, 1.07);
      else if (lx === w - 1) bg = scale(body, 0.88);
      else if (ly === 0) bg = scale(body, 1.1);
      else if (r >= y1 - 2) bg = scale(body, 0.9);
      let ch = ' ';
      let fg = null;
      if (layer.detail >= 1 && lx > 0 && lx < w - 1 && ly >= 1 && r < y1 - 1) {
        const near = layer.detail === 2;
        const wx = near ? lx % 4 === 1 || lx % 4 === 2 : lx % 3 === 1;
        const wy = near ? ly % 3 === 1 : ly % 2 === 1;
        if (wx && wy) {
          const lit = windowColor(ctx, b, c, r);
          bg = lit ?? glass;
          if (!lit && day > 0.5 && hash2(c, r, b.seed + 9) < 0.08) bg = mix(glass, [255, 255, 255], 0.35);
        }
      } else if (layer.detail === 2 && hash2(c, r, b.seed) < 0.07) {
        ch = ':';
        fg = scale(bg, 0.82);
      }
      buf.put(c, r, ch, fg ?? bg, bg);
    }
  }
}

function drawRoof(ctx, layer, b, body, colTop, top) {
  const { buf, clock, time, pal } = ctx;
  const { x, w } = b;
  if (b.roof === 'antenna') {
    const mx = x + (w >> 1);
    const len = 3 + (b.seed % 4);
    for (let k = 1; k <= len; k++) buf.ink(mx, top - k, '|', scale(body, 0.7));
    const blink = clock.night > 0.4 && Math.sin(time * 2.2 + b.seed) > 0.5;
    if (blink) {
      buf.ink(mx, top - len - 1, '*', [255, 70, 56]);
      buf.glow(mx + 0.5, top - len - 0.5, 4, [255, 60, 40], 0.5);
    } else {
      buf.ink(mx, top - len - 1, '.', scale(body, 0.75));
    }
  } else if (b.roof === 'tank') {
    const tx = x + 1 + (b.seed % Math.max(1, w - 4));
    for (let k = 0; k < 3; k++) {
      for (let j = 1; j <= 2; j++) buf.put(tx + k, top - j, j === 2 ? '=' : ' ', scale(body, 0.7), scale(body, 0.85));
      colTop[tx + k - x] = top - 2;
    }
  } else if (b.roof === 'pitch') {
    const roof = mix([100, 66, 60], pal.horizon, layer.haze);
    const ph = Math.min(3, w >> 2);
    for (let k = 0; k < ph; k++) {
      for (let c = x + 1 + k; c <= x + w - 2 - k; c++) {
        buf.setBg(c, top - 1 - k, scale(roof, 1 - k * 0.05));
        colTop[c - x] = top - 1 - k;
      }
    }
  } else if (b.roof === 'spire') {
    const mx = x + (w >> 1);
    const len = 4 + (b.seed % 4);
    for (let k = 1; k <= len; k++) buf.put(mx, top - k, k === len ? '^' : '|', scale(body, 0.8), scale(body, 0.95));
    colTop[mx - x] = top - len;
  }
}

export function drawCityLayer(ctx, layer) {
  const { buf, cols, horizon, pal, clock } = ctx;
  const body0 = mix(pal[layer.name], pal.horizon, layer.haze);
  const snowy = clock.season === 'winter';
  for (const b of layer.buildings) {
    if (b.x + b.w < 0 || b.x >= cols) continue;
    const top = horizon - b.h;
    const body = scale(body0, b.tone);
    const colTop = new Int16Array(b.w).fill(top);
    drawBlock(ctx, layer, b, b.x, b.w, top, horizon, body);
    if (b.roof === 'step') {
      const sw = Math.max(3, b.w >> 1);
      const sx = b.x + ((b.w - sw) >> 1);
      const sh = 2 + (b.seed % 3);
      drawBlock(ctx, layer, b, sx, sw, top - sh, top, scale(body, 0.97));
      for (let c = sx; c < sx + sw; c++) colTop[c - b.x] = top - sh;
    } else {
      drawRoof(ctx, layer, b, body, colTop, top);
    }
    if (snowy) {
      for (let lx = 0; lx < b.w; lx++) buf.setBg(b.x + lx, colTop[lx], pal.snow, 0.9 - layer.haze * 0.4);
    }
  }
}

export function createStreet(cols, rows, horizon) {
  const spacing = Math.max(18, Math.round(cols / 5));
  const height = Math.min(9, Math.max(5, Math.round(rows * 0.11)));
  const lamps = [];
  for (let x = 6; x < cols; x += spacing) lamps.push({ x, headX: x + 2, headY: horizon - height });
  return { lamps, cars: [], spawnIn: 1, height };
}

const CAR = ['.bbgg..', 'bbbbbbb', 'bwbbbwb'];

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

export function drawStreet(ctx, street) {
  const { buf, cols, rows, horizon, pal, clock, time } = ctx;
  const night = clock.night;
  const winter = clock.season === 'winter';
  const wet = clock.season === 'spring';
  const walk = winter ? pal.snow : pal.sidewalk;
  const laneRow = horizon + 5;

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
      if (r === laneRow && (Math.floor(c / 4) % 2 === 0)) { ch = '-'; fg = mix(bg, [226, 214, 140], 0.7); }
      buf.put(c, r, ch, fg, bg);
    }
  }

  for (const lamp of street.lamps) {
    const lampOn = night > 0.25;
    for (let r = lamp.headY + 1; r < horizon; r++) buf.ink(lamp.x, r, '|', [40, 44, 54]);
    buf.ink(lamp.x, lamp.headY, '-', [40, 44, 54]);
    buf.ink(lamp.x + 1, lamp.headY, '-', [40, 44, 54]);
    if (lampOn) {
      buf.ink(lamp.headX, lamp.headY, 'o', [255, 232, 160]);
      buf.glow(lamp.headX + 0.5, lamp.headY + 1, 9, [255, 196, 110], 0.62 * night);
      buf.glow(lamp.headX + 0.5, horizon + 3, 8, [255, 190, 100], 0.34 * night);
    } else {
      buf.ink(lamp.headX, lamp.headY, 'o', [150, 156, 166]);
    }
  }

  for (const car of street.cars) {
    const flip = car.dir < 0;
    const cx = Math.round(car.x);
    for (let y = 0; y < 3; y++) {
      for (let i = 0; i < 7; i++) {
        const code = CAR[y][flip ? 6 - i : i];
        if (code === '.') continue;
        let col = car.color;
        if (code === 'g') col = [120, 150, 180];
        if (code === 'w') col = [26, 26, 32];
        buf.setBg(cx + i, car.row + y, scale(col, 0.45 + 0.55 * clamp01(clock.daylight + 0.35)));
      }
    }
    if (night > 0.25) {
      const frontX = flip ? cx - 0.5 : cx + 7.5;
      buf.glow(frontX + car.dir * 2.5, car.row + 2, 6, [255, 236, 170], 0.55 * night);
      buf.glow(flip ? cx + 7.5 : cx - 0.5, car.row + 2, 3, [255, 40, 30], 0.5 * night);
    }
  }
}

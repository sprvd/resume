import { hash2, luma, mix, mulberry32, pickOne, scale } from './util.js';
import { WINDOW_LIT } from './palette.js';
import { MAT } from './buffer.js';

// The skyline: three rows of buildings, hazier with distance, and a TV tower on the far one.

const LAYERS = [
  { name: 'far', hMin: 0.16, hMax: 0.34, wMin: 6, wMax: 14, haze: 0.7, detail: 0 },
  { name: 'mid', hMin: 0.22, hMax: 0.46, wMin: 8, wMax: 18, haze: 0.4, detail: 1 },
  { name: 'near', hMin: 0.26, hMax: 0.56, wMin: 10, wMax: 24, haze: 0.1, detail: 2 },
];
const ROOFS_FAR = ['flat', 'antenna', 'step', 'flat'];
const ROOFS_NEAR = ['flat', 'antenna', 'tank', 'pitch', 'step', 'spire', 'flat', 'chimney'];

// Facades. `tint` pulls the layer colour towards the material while keeping its brightness.
//   brick   red-brown courses, small single windows with sills
//   panel   grey prefab slabs with seams and balconies
//   glass   a curtain-wall tower: mullions, whole floors lit at night
//   stucco  pastel plaster, tall windows, a cornice under the roof
const STYLES = {
  brick: { tint: [158, 82, 62], mat: MAT.wall },
  panel: { tint: [168, 166, 156], mat: MAT.plaster },
  glass: { tint: [74, 118, 140], mat: MAT.glass },
  stucco: { tint: [214, 178, 124], mat: MAT.plaster },
};
const PASTELS = [[214, 178, 124], [200, 150, 150], [176, 186, 146], [226, 206, 168], [160, 172, 196]];
const AWNINGS = [[170, 50, 50], [40, 110, 90], [200, 150, 50], [60, 80, 150]];
const BEACON = [255, 60, 40];

function pickStyle(rng, tall) {
  const r = rng();
  if (tall) return r < 0.4 ? 'glass' : r < 0.8 ? 'panel' : 'brick';
  return r < 0.34 ? 'brick' : r < 0.6 ? 'stucco' : r < 0.88 ? 'panel' : 'glass';
}

function createBuilding(rng, layer, x, w, h, tall) {
  const style = pickStyle(rng, tall);
  const b = {
    x, w, h, style,
    roof: style === 'glass' ? (rng() < 0.5 ? 'spire' : 'flat') : pickOne(rng, layer.detail ? ROOFS_NEAR : ROOFS_FAR),
    seed: Math.floor(rng() * 1e6),
    occ: 0.35 + rng() * 0.65,
    tone: 0.9 + rng() * 0.2,
    tint: style === 'stucco' ? pickOne(rng, PASTELS) : STYLES[style].tint,
  };
  // street-level life on the nearest row: shop fronts under awnings
  if (layer.detail === 2) b.shop = rng() < 0.65 ? { awning: pickOne(rng, AWNINGS) } : null;
  return b;
}

export function buildSkyline(cols, horizon, seed = 20241210) {
  const rng = mulberry32(seed);
  const k = Math.min(1.4, Math.max(0.55, cols / 116));
  const layers = LAYERS.map((L) => {
    const buildings = [];
    let x = -Math.floor(rng() * 6);
    while (x < cols) {
      const w = Math.max(4, Math.round((L.wMin + rng() * (L.wMax - L.wMin)) * k));
      const h = Math.max(4, Math.round(horizon * (L.hMin + (L.hMax - L.hMin) * rng() ** 1.2)));
      buildings.push(createBuilding(rng, L, x, w, h, h > horizon * 0.42));
      x += w + Math.floor(rng() * (L.detail === 2 ? 2 : 3));
    }
    return { ...L, buildings };
  });
  const tower = { x: Math.round(cols * (0.55 + rng() * 0.25)), h: Math.round(horizon * 0.86) };
  return { layers, tower };
}

/** Share of windows lit by hour of day. */
function activity(hour) {
  if (hour >= 17 && hour < 23.5) return 0.62;
  if (hour >= 23.5 || hour < 1.5) return 0.34;
  if (hour >= 1.5 && hour < 5.5) return 0.1;
  if (hour >= 5.5 && hour < 8.5) return 0.4;
  return 0.07;
}

/** A lit window's colour, or null; windows come on and off on their own slow timers. */
function windowColor(ctx, b, c, r) {
  const { clock, time } = ctx;
  // a glass tower lights whole floors at once
  if (b.style === 'glass' && hash2(r, Math.floor(time / 40), b.seed) < b.occ * activity(clock.hour)) {
    return mix(WINDOW_LIT, [220, 236, 255], 0.5);
  }
  const slot = Math.floor(time / (30 + 90 * hash2(c, r, b.seed + 1)));
  if (hash2(c, r, b.seed + slot * 13) >= b.occ * activity(clock.hour)) return null;
  const h = hash2(c, r, b.seed + 5);
  if (h < 0.12) {
    const flick = 0.75 + 0.25 * Math.sin(time * 6 + h * 90);
    return [120 * flick, 170 * flick, 255 * flick];
  }
  return mix(WINDOW_LIT, [255, 238, 190], h);
}

/**
 * What sits at (lx, ly) of a facade: 'window', a trim glyph with how bright it is against the
 * wall, or null for plain wall.
 */
function facadeTrim(style, lx, ly, near) {
  switch (style) {
    case 'brick':
      if (lx % 3 !== 1) return null;
      return ly % 3 === 1 ? 'window' : ly % 3 === 2 ? ['_', 1.4] : null;
    case 'panel':
      if ((lx % 4 === 1 || lx % 4 === 2) && ly % 3 === 1) return 'window';
      if (!near) return null;
      // balconies under every other pair of windows
      if (lx % 8 < 4 && ly % 3 === 2) return [lx % 8 === 0 || lx % 8 === 3 ? '|' : '=', 1.4];
      // seams between the prefab slabs
      if (lx % 4 === 0) return [ly % 3 === 0 ? '+' : '|', 0.75];
      return ly % 3 === 0 ? ['-', 0.75] : null;
    case 'glass':
      if (lx % 3 === 0) return ['|', 1.35];
      return ly % 2 === 1 ? 'window' : null;
    default:
      if (ly === 1) return ['=', 1.3];
      return lx % 3 === 1 && (ly % 4 === 1 || ly % 4 === 2) ? 'window' : null;
  }
}

function drawBlock(ctx, layer, b, x, w, y0, y1, body) {
  const { buf, cols, clock, pal } = ctx;
  const near = layer.detail === 2;
  const glass = mix(scale(body, 0.72), pal.horizon, 0.5 * clock.daylight);
  const wall = layer.detail ? STYLES[b.style].mat : MAT.wall;
  for (let r = y0; r < y1; r++) {
    const ly = r - y0;
    for (let lx = 0; lx < w; lx++) {
      const c = x + lx;
      if (c < 0 || c >= cols) continue;
      // lit edge on the left, shaded on the right, a cap on top, grime at the bottom
      let bg = body;
      if (lx === 0) bg = scale(body, 1.07);
      else if (lx === w - 1) bg = scale(body, 0.88);
      else if (ly === 0) bg = scale(body, 1.1);
      else if (r >= y1 - 2) bg = scale(body, 0.9);
      let ch = ' ';
      let fg = bg;
      buf.pen = wall;
      const inside = lx > 0 && lx < w - 1 && ly >= 1 && r < y1 - 1;
      const trim = layer.detail && inside ? facadeTrim(b.style, lx, ly, near) : null;
      if (trim === 'window') {
        const lit = windowColor(ctx, b, c, r);
        buf.pen = MAT.glass;
        bg = fg = lit ?? glass;
        // daylight catches a pane here and there
        if (!lit && clock.daylight > 0.5 && hash2(c, r, b.seed + 9) < 0.08) bg = fg = mix(glass, [255, 255, 255], 0.35);
      } else if (trim) {
        ch = trim[0];
        fg = scale(body, trim[1]);
      } else if (near && hash2(c, r, b.seed) < 0.05) {
        ch = ':';
        fg = scale(bg, 0.82);
      }
      buf.put(c, r, ch, fg, bg);
    }
  }
}

// Roof furniture. Each draws above `top` and raises `colTop` (the topmost row per column) where
// it adds height, so snow settles on it.
const ROOFS = {
  flat() {},
  antenna({ buf, clock, time }, b, body, colTop, top) {
    const mx = b.x + (b.w >> 1);
    const len = 3 + (b.seed % 4);
    for (let k = 1; k <= len; k++) buf.ink(mx, top - k, '|', scale(body, 0.7));
    const blink = clock.night > 0.4 && Math.sin(time * 2.2 + b.seed) > 0.5;
    buf.ink(mx, top - len - 1, blink ? '*' : '.', blink ? [255, 70, 56] : scale(body, 0.75));
    if (blink) buf.glow(mx + 0.5, top - len - 0.5, 4, BEACON, 0.5);
  },
  tank({ buf }, b, body, colTop, top) {
    const tx = b.x + 1 + (b.seed % Math.max(1, b.w - 4));
    for (let k = 0; k < 3; k++) {
      for (let j = 1; j <= 2; j++) buf.put(tx + k, top - j, j === 2 ? '=' : ' ', scale(body, 0.7), scale(body, 0.85));
      colTop[tx + k - b.x] = top - 2;
    }
  },
  pitch({ buf, pal }, b, body, colTop, top, layer) {
    const roof = mix([100, 66, 60], pal.horizon, layer.haze);
    const ph = Math.min(3, b.w >> 2);
    for (let k = 0; k < ph; k++) {
      for (let c = b.x + 1 + k; c <= b.x + b.w - 2 - k; c++) {
        buf.setBg(c, top - 1 - k, scale(roof, 1 - k * 0.05));
        colTop[c - b.x] = top - 1 - k;
      }
    }
  },
  spire({ buf }, b, body, colTop, top) {
    const mx = b.x + (b.w >> 1);
    const len = 4 + (b.seed % 4);
    for (let k = 1; k <= len; k++) buf.put(mx, top - k, k === len ? '^' : '|', scale(body, 0.8), scale(body, 0.95));
    colTop[mx - b.x] = top - len;
  },
  step(ctx, b, body, colTop, top, layer) {
    const sw = Math.max(3, b.w >> 1);
    const sx = b.x + ((b.w - sw) >> 1);
    const sh = 2 + (b.seed % 3);
    drawBlock(ctx, layer, b, sx, sw, top - sh, top, scale(body, 0.97));
    for (let c = sx; c < sx + sw; c++) colTop[c - b.x] = top - sh;
  },
  chimney({ buf, clock, time, pal }, b, body, colTop, top) {
    const cx = b.x + 2 + (b.seed % Math.max(1, b.w - 5));
    for (let j = 1; j <= 3; j++) buf.put(cx, top - j, j === 3 ? '=' : '#', scale(body, 0.8), scale(body, 0.6));
    colTop[cx - b.x] = top - 3;
    if (clock.season !== 'winter' && clock.season !== 'autumn') return;
    // smoke curls away in the cold months
    for (let i = 0; i < 6; i++) {
      const age = (time * 0.6 + i / 6) % 1;
      const sx = cx + age * 6 + Math.sin(time + i * 2) * 0.8;
      buf.ink(sx, top - 4 - age * 6, age < 0.4 ? 'o' : age < 0.7 ? '~' : '.', mix([200, 200, 210], pal.horizon, 0.3), 0.6 * (1 - age));
    }
  },
};

/** Ground floor of a near building: an awning over a shop window, warm and bright after dark. */
function drawShop(ctx, b) {
  const { buf, horizon, clock, time, pal } = ctx;
  const y = horizon - 3;
  const { awning } = b.shop;
  // some shops shut for the night
  const open = clock.night > 0.3 && !(hash2(b.seed, 3, 7) < 0.25 && (clock.hour > 23 || clock.hour < 7));
  buf.pen = MAT.metal;
  for (let lx = 1; lx < b.w - 1; lx++) {
    const c = b.x + lx;
    const stripe = (lx >> 1) % 2 ? awning : mix(awning, [236, 230, 214], 0.7);
    buf.put(c, y, lx === 1 ? '/' : lx === b.w - 2 ? '\\' : '=', scale(stripe, 1.1), scale(stripe, 0.5 + 0.4 * clock.daylight));
    const glass = open ? mix([255, 214, 150], [255, 240, 210], hash2(c, 1, b.seed)) : mix([60, 70, 80], pal.horizon, 0.4);
    for (let r = y + 1; r < horizon; r++) buf.put(c, r, lx % 5 === 0 ? '|' : ' ', scale(glass, 0.6), glass);
  }
  if (open) buf.glow(b.x + b.w / 2, horizon + 1, Math.min(10, b.w * 0.6), [255, 190, 110], 0.28 * clock.night * (0.9 + 0.1 * Math.sin(time * 3 + b.seed)));
}

/** The TV tower: a tapering shaft, a pod two thirds up, a mast with red lights that blink. */
function drawTower(ctx, tower) {
  const { buf, horizon, pal, clock, time } = ctx;
  const body = mix(pal.far, pal.horizon, 0.55);
  const top = horizon - tower.h;
  const pod = Math.round(horizon - tower.h * 0.62);
  buf.pen = MAT.wall;
  for (let r = top; r < horizon; r++) {
    const u = (r - top) / tower.h;
    if (u < 0.22) {
      buf.put(tower.x, r, '|', scale(body, 1.3), scale(body, 0.9));
      continue;
    }
    const half = Math.round(0.5 + u * 2.4);
    for (let c = tower.x - half; c <= tower.x + half; c++) buf.setBg(c, r, scale(body, c < tower.x ? 1.05 : 0.9));
  }
  // the pod, with a ring of lit windows at night
  for (let r = pod - 1; r <= pod + 1; r++) {
    const half = r === pod ? 4 : 3;
    for (let c = tower.x - half; c <= tower.x + half; c++) {
      const win = r === pod && clock.night > 0.3 && (c - tower.x) % 2 === 0;
      buf.put(c, r, win ? '=' : ' ', WINDOW_LIT, win ? scale(WINDOW_LIT, 0.8) : scale(body, 1.1));
    }
  }
  for (const [r, phase] of [[top, 0], [pod - 2, 1.5], [Math.round(top + tower.h * 0.4), 3]]) {
    const on = clock.night > 0.2 && Math.sin(time * 1.6 + phase) > 0.2;
    buf.ink(tower.x, r, on ? '*' : '.', on ? [255, 70, 56] : scale(body, 1.4));
    if (on) buf.glow(tower.x + 0.5, r + 0.5, 3.5, BEACON, 0.45);
  }
}

function drawLayer(ctx, layer) {
  const { buf, cols, horizon, pal, clock } = ctx;
  const base = mix(pal[layer.name], pal.horizon, layer.haze);
  for (const b of layer.buildings) {
    if (b.x + b.w < 0 || b.x >= cols) continue;
    const top = horizon - b.h;
    // towards the facade's material colour, keeping the layer's brightness; less so at night
    const tint = scale(b.tint, luma(base) / luma(b.tint));
    const body = scale(mix(base, tint, 0.6 * (1 - layer.haze) * (0.5 + 0.5 * clock.daylight)), b.tone);
    const colTop = new Int16Array(b.w).fill(top);
    drawBlock(ctx, layer, b, b.x, b.w, top, horizon, body);
    buf.pen = MAT.wall;
    ROOFS[b.roof](ctx, b, body, colTop, top, layer);
    if (clock.season === 'winter') {
      buf.pen = MAT.snow;
      for (let lx = 0; lx < b.w; lx++) buf.setBg(b.x + lx, colTop[lx], pal.snow, 0.9 - layer.haze * 0.4);
    }
    if (b.shop) drawShop(ctx, b);
  }
}

/** The whole skyline, back to front; `between` runs after the far row (the autumn mist goes there). */
export function drawCity(ctx, skyline, between) {
  const [far, mid, near] = skyline.layers;
  drawLayer(ctx, far);
  drawTower(ctx, skyline.tower);
  between?.(ctx);
  drawLayer(ctx, mid);
  drawLayer(ctx, near);
}

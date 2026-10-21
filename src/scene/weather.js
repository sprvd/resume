import { clamp01, fbm, hash2, mix } from './util.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const LEAF_CHARS = ['~', ',', '"', '`'];
const LEAF_COLORS = [[222, 122, 40], [194, 64, 42], [232, 184, 52], [150, 92, 44]];

/** Everything that falls, flies or fogs, per season. */
export function createWeather(season, cols, rows, horizon) {
  const state = { season, parts: [], splashes: [], drops: [], birds: [], birdIn: 2, moths: [] };

  if (season === 'winter') {
    const n = Math.round(cols * rows * 0.03);
    for (let i = 0; i < n; i++) {
      const depth = i % 5 === 0 ? 2 : i % 2 ? 1 : 0;
      state.parts.push({ x: rnd(0, cols), y: rnd(-rows, rows), depth, vy: [2.6, 4.6, 7][depth] * rnd(0.8, 1.2), phase: rnd(0, 6.28) });
    }
  } else if (season === 'spring') {
    const n = Math.round(cols * 2.2);
    for (let i = 0; i < n; i++) state.parts.push(spawnRain(cols, rows, horizon, true));
    for (let i = 0; i < 7; i++) state.drops.push({ x: rnd(2, cols - 2), y: rnd(2, rows - 6), vy: 0, wait: rnd(0, 3), len: 2 + Math.floor(rnd(0, 3)) });
  } else if (season === 'autumn') {
    const n = Math.round(cols * 0.28);
    for (let i = 0; i < n; i++) {
      state.parts.push({ x: rnd(0, cols), y: rnd(-rows, rows), vy: rnd(2.2, 5), phase: rnd(0, 6.28), color: LEAF_COLORS[i % LEAF_COLORS.length] });
    }
  } else {
    for (let i = 0; i < 6; i++) state.moths.push({ phase: rnd(0, 6.28), rx: rnd(1.4, 3.2), ry: rnd(1, 2.2), speed: rnd(2, 4), lamp: i });
    for (let i = 0; i < 9; i++) state.parts.push({ x: rnd(0, cols), y: rnd(horizon + 1, rows - 4), phase: rnd(0, 6.28), speed: rnd(0.3, 0.8) });
  }
  return state;
}

function spawnRain(cols, rows, horizon, anywhere = false) {
  return {
    x: rnd(-rows * 0.3, cols),
    y: anywhere ? rnd(-rows, rows) : rnd(-8, -1),
    vy: rnd(36, 54),
    endY: rnd(horizon + 2, rows - 4),
  };
}

export function updateWeather(w, ctx, dt) {
  const { cols, rows, horizon, time, clock } = ctx;
  if (w.season === 'winter') {
    for (const p of w.parts) {
      p.y += p.vy * dt;
      p.x += Math.sin(time * 0.8 + p.phase) * (0.6 + p.depth * 0.5) * dt * 2 - 0.6 * dt * (p.depth + 1);
      if (p.y > rows) { p.y = rnd(-4, 0); p.x = rnd(0, cols); }
      if (p.x < -1) p.x += cols + 2;
    }
  } else if (w.season === 'spring') {
    for (let i = 0; i < w.parts.length; i++) {
      const p = w.parts[i];
      p.y += p.vy * dt;
      p.x -= 9 * dt;
      if (p.y >= p.endY) {
        w.splashes.push({ x: p.x, y: p.endY, age: 0 });
        w.parts[i] = spawnRain(cols, rows, horizon);
      }
    }
    w.splashes = w.splashes.filter((s) => (s.age += dt) < 0.25);
    for (const d of w.drops) {
      d.wait -= dt;
      if (d.wait <= 0) { d.vy = rnd(2, 5); d.wait = rnd(0.6, 2.2); } else d.vy *= 0.9;
      d.y += d.vy * dt;
      if (d.y > rows - 5) { d.y = rnd(1, 6); d.x = rnd(2, cols - 2); d.len = 2 + Math.floor(rnd(0, 3)); }
    }
  } else if (w.season === 'autumn') {
    const gust = Math.max(0, Math.sin(time * 0.35 + 1)) ** 3;
    for (const p of w.parts) {
      p.y += p.vy * dt;
      p.x += (Math.sin(time * 1.4 + p.phase) * 2.2 + 2.5 + gust * 9) * dt;
      if (p.y > rows - 3 || p.x > cols + 2) { p.y = rnd(-6, 0); p.x = rnd(-cols * 0.3, cols); }
    }
  } else {
    for (const p of w.parts) {
      p.x += Math.sin(time * p.speed + p.phase) * dt * 2;
      p.y += Math.cos(time * p.speed * 1.3 + p.phase) * dt;
    }
    w.birdIn -= dt;
    if (w.birdIn <= 0 && clock.daylight > 0.4 && w.birds.length < 3) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      w.birds.push({ x: dir > 0 ? -4 : cols + 4, y: rnd(horizon * 0.12, horizon * 0.5), dir, speed: rnd(4, 7), phase: rnd(0, 6) });
      w.birdIn = rnd(3, 9);
    }
    for (const b of w.birds) { b.x += b.dir * b.speed * dt; b.y += Math.sin(time * 0.8 + b.phase) * dt * 0.8; }
    w.birds = w.birds.filter((b) => b.x > -6 && b.x < cols + 6);
  }
}

/** Autumn mist: a drifting band over the lower skyline. */
export function drawFog(ctx) {
  const { buf, cols, horizon, time, clock, pal } = ctx;
  if (clock.season !== 'autumn') return;
  const top = Math.floor(horizon * 0.45);
  const fog = mix(pal.horizon, [235, 235, 240], 0.4);
  const strength = 0.42 * (1 - clock.daylight * 0.3);
  for (let r = top; r < horizon + 2; r++) {
    const vert = ((r - top) / (horizon + 2 - top)) ** 1.5;
    for (let c = 0; c < cols; c++) {
      const a = clamp01((fbm(c * 0.045 - time * 0.5, r * 0.2, 99) - 0.36) / 0.4) * vert * strength;
      if (a > 0.01) buf.tint(c, r, fog, a);
    }
  }
}

export function drawWeather(ctx, w, street) {
  const { buf, cols, rows, time, clock, pal } = ctx;
  const d = clock.daylight;
  if (w.season === 'winter') {
    const col = mix([190, 206, 244], [255, 255, 255], d);
    for (const p of w.parts) buf.ink(p.x, p.y, ['.', '*', '*'][p.depth], col, 0.7 + p.depth * 0.15);
  } else if (w.season === 'spring') {
    const col = mix([150, 172, 224], [226, 238, 255], d);
    for (const p of w.parts) buf.ink(p.x, p.y, '/', col, 0.85);
    for (const s of w.splashes) buf.ink(s.x, s.y, s.age < 0.12 ? 'o' : '.', col, 0.8);
    drawBirds(buf, w, time, 0.5);
  } else if (w.season === 'autumn') {
    for (const p of w.parts) buf.ink(p.x, p.y, LEAF_CHARS[Math.floor(time * 3 + p.phase * 4) % LEAF_CHARS.length], p.color, 0.95);
  } else {
    drawBirds(buf, w, time, 1);
    if (clock.night > 0.35) {
      for (const m of w.moths) {
        const lamp = street.lamps[m.lamp % street.lamps.length];
        const a = time * m.speed + m.phase;
        buf.ink(lamp.headX + Math.cos(a) * m.rx, lamp.headY + 1.5 + Math.sin(a * 1.3) * m.ry, '.', [255, 244, 180], 0.9);
      }
      for (const f of w.parts) {
        const pulse = Math.max(0, Math.sin(time * 1.6 + f.phase));
        if (pulse < 0.15) continue;
        buf.ink(f.x, f.y, '*', [190, 255, 130], pulse);
        buf.glow(f.x + 0.5, f.y + 0.5, 3, [150, 255, 90], 0.5 * pulse * clock.night);
      }
    }
  }
}

function drawBirds(buf, w, time, alpha) {
  for (const b of w.birds) {
    const flap = Math.floor(time * 5 + b.phase) % 2 === 0;
    const sprite = flap ? '\\v/' : '_v_';
    for (let i = 0; i < 3; i++) buf.ink(b.x + i, b.y, sprite[i], [34, 36, 44], alpha);
  }
}

/** On the glass itself: frost in winter, running drops in spring. */
export function drawGlass(ctx, w) {
  const { buf, cols, rows, time } = ctx;
  if (w.season === 'winter') {
    const reach = Math.max(5, cols * 0.09);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const edge = Math.min(c, cols - 1 - c, (r) * 1.6, (rows - 1 - r) * 1.6);
        if (edge > reach) continue;
        const f = (1 - edge / reach) * fbm(c * 0.22, r * 0.3, 41);
        if (f > 0.4) {
          buf.tint(c, r, [226, 240, 255], 0.28 * Math.min(1, (f - 0.4) * 3));
          buf.ink(c, r, f > 0.6 ? '*' : f > 0.46 ? '+' : '.', [244, 250, 255], 0.9);
        }
      }
    }
  } else if (w.season === 'spring') {
    for (const dr of w.drops) {
      for (let k = 1; k <= dr.len; k++) buf.ink(dr.x, dr.y - k, '.', [210, 230, 255], 0.55 / k);
      buf.setBg(dr.x, dr.y, [220, 236, 255], 0.22);
      buf.ink(dr.x, dr.y, 'o', [230, 242, 255], 0.9);
    }
  }
}

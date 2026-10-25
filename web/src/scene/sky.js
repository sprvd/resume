import { clamp01, fbm, hash2, mix } from './util.js';

// Lower threshold = more clouds.
const CLOUD_THRESHOLD = { winter: 0.52, spring: 0.55, summer: 0.66, autumn: 0.5 };

function celestial({ clock, cols, horizon }) {
  const p = clock.bodyP;
  const arc = horizon * 0.78;
  const base = horizon * 0.98;
  const x = cols * (0.1 + 0.8 * p);
  const y = base - Math.sin(Math.PI * p) * arc;
  const r = Math.max(3, cols * 0.028);
  return { kind: clock.sunUp ? 'sun' : 'moon', x, y, r };
}

function drawSun(buf, s, clock) {
  const warm = mix([255, 246, 200], [255, 140, 60], clock.twilight);
  buf.glow(s.x, s.y, s.r * 5.5, [255, 190, 110], 0.5 * (0.4 + clock.daylight * 0.6));
  for (let r = Math.floor(s.y - s.r - 1); r <= Math.ceil(s.y + s.r + 1); r++) {
    for (let c = Math.floor(s.x - s.r - 1); c <= Math.ceil(s.x + s.r + 1); c++) {
      const dist = Math.hypot(c + 0.5 - s.x, r + 0.5 - s.y);
      if (dist <= s.r + 0.6) buf.setBg(c, r, warm, dist <= s.r ? 1 : 0.5);
    }
  }
}

function drawMoon(buf, s, clock) {
  const k = Math.cos(2 * Math.PI * clock.moonPhase);
  const waxing = clock.moonPhase < 0.5;
  const lit = [226, 230, 216];
  buf.glow(s.x, s.y, s.r * 4, [110, 130, 190], 0.28 * clock.night);
  for (let r = Math.floor(s.y - s.r - 1); r <= Math.ceil(s.y + s.r + 1); r++) {
    for (let c = Math.floor(s.x - s.r - 1); c <= Math.ceil(s.x + s.r + 1); c++) {
      const dx = (c + 0.5 - s.x) / s.r;
      const dy = (r + 0.5 - s.y) / s.r;
      if (dx * dx + dy * dy > 1) continue;
      const term = k * Math.sqrt(Math.max(0, 1 - dy * dy));
      const isLit = waxing ? dx > term : dx < -term;
      if (isLit) {
        buf.setBg(c, r, lit);
        if (hash2(c, r, 5) < 0.22) buf.ink(c, r, ':', [176, 182, 170], 0.8);
      } else {
        buf.setBg(c, r, [30, 36, 66], 0.65);
      }
    }
  }
}

export function drawSky(ctx) {
  const { buf, cols, horizon, time, clock, pal } = ctx;
  const { top, horizon: hor } = pal;
  const d = clock.daylight;
  const threshold = CLOUD_THRESHOLD[clock.season];

  // gradient + stars
  const starVis = clamp01(1 - d * 1.5);
  for (let r = 0; r < horizon; r++) {
    const g = (r / (horizon - 1)) ** 1.4;
    const bg = [top[0] + (hor[0] - top[0]) * g, top[1] + (hor[1] - top[1]) * g, top[2] + (hor[2] - top[2]) * g];
    for (let c = 0; c < cols; c++) {
      buf.put(c, r, ' ', bg, bg);
      if (starVis > 0.05 && r < horizon * 0.85) {
        const h = hash2(c, r, 7);
        if (h < 0.02) {
          const tw = 0.5 + 0.5 * Math.sin(time * (1 + h * 90) + h * 400);
          const ch = tw > 0.82 ? '*' : tw > 0.4 ? '+' : '.';
          buf.ink(c, r, ch, [255, 255, 236], starVis * (0.35 + 0.65 * tw));
        }
      }
    }
  }

  const body = celestial(ctx);
  if (body.kind === 'sun') drawSun(buf, body, clock);
  else drawMoon(buf, body, clock);

  // clouds drift over the sun/moon
  const drift = time * 0.4;
  let cloudCol = mix([64, 70, 104], [248, 249, 252], d);
  cloudCol = mix(cloudCol, [255, 156, 116], clock.twilight * 0.65);
  for (let r = 0; r < horizon; r++) {
    for (let c = 0; c < cols; c++) {
      const n = fbm(c * 0.035 + drift, r * 0.1 + 3.7, 11);
      const a = clamp01((n - threshold) / 0.2);
      if (a <= 0) continue;
      const fade = 1 - (r / horizon) ** 3 * 0.5;
      buf.setBg(c, r, cloudCol, a * (0.45 + 0.4 * d) * fade);
    }
  }
}

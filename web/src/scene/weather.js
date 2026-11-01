import { clamp01, fbm, mix, scale } from './util.js';
import { canopy } from './street.js';
import { pointer } from './pointer.js';

// Everything that falls, flies or fogs outside the glass, one handler per season. Each season may
// define create (initial state), update, draw, and glass (what clings to the window pane itself).

const rnd = (a, b) => a + Math.random() * (b - a);

/** The air the pointer pushes around as it moves, in cells per second at (x, y). */
function windAt(x, y) {
  if (!pointer.inside || pointer.overUi) return [0, 0];
  const dx = x - pointer.x;
  const dy = (y - pointer.y) * 1.4;
  const f = Math.exp(-(dx * dx + dy * dy) / 40);
  return [pointer.vx * f * 0.9, pointer.vy * f * 0.9];
}

// ---- winter: snow in three depths, frost creeping in from the corners of the pane

const winter = {
  create(w, { cols, rows }) {
    const n = Math.round(cols * rows * 0.03);
    for (let i = 0; i < n; i++) {
      const depth = i % 5 === 0 ? 2 : i % 2 ? 1 : 0;
      w.parts.push({ x: rnd(0, cols), y: rnd(-rows, rows), depth, vx: 0, vy: [2.6, 4.6, 7][depth] * rnd(0.8, 1.2), phase: rnd(0, 6.28) });
    }
  },
  update(w, { cols, rows, time }, dt) {
    for (const p of w.parts) {
      // flakes drift with the pointer and keep a little of the push
      const [wx, wy] = windAt(p.x, p.y);
      p.vx = p.vx * Math.exp(-dt * 1.2) + wx * dt * 2.5;
      p.y += (p.vy + wy * 0.4) * dt;
      p.x += (Math.sin(time * 0.8 + p.phase) * (0.6 + p.depth * 0.5) * 2 - 0.6 * (p.depth + 1) + p.vx) * dt;
      if (p.y > rows) Object.assign(p, { y: rnd(-4, 0), x: rnd(0, cols), vx: 0 });
      if (p.x < -1) p.x += cols + 2;
      if (p.x > cols + 2) p.x -= cols + 2;
    }
  },
  draw(w, { buf, clock }) {
    const col = mix([190, 206, 244], [255, 255, 255], clock.daylight);
    for (const p of w.parts) buf.ink(p.x, p.y, ['.', '*', '*'][p.depth], col, 0.7 + p.depth * 0.15);
  },
  glass(w, { buf, cols, rows }) {
    const reach = Math.max(5, cols * 0.09);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const edge = Math.min(c, cols - 1 - c, r * 1.6, (rows - 1 - r) * 1.6);
        if (edge > reach) continue;
        const f = (1 - edge / reach) * fbm(c * 0.22, r * 0.3, 41);
        if (f <= 0.4) continue;
        buf.tint(c, r, [226, 240, 255], 0.28 * Math.min(1, (f - 0.4) * 3));
        buf.ink(c, r, f > 0.6 ? '*' : f > 0.46 ? '+' : '.', [244, 250, 255], 0.9);
      }
    }
  },
};

// ---- spring and autumn: things the trees let go of, tumbling down in three depths. The near ones
// settle on the pavement, and a sweep of the pointer sends them all swirling, fallen ones too.

const SETTLE_FOR = 45;

/**
 * A season of falling things. `look` sets what falls: colours, the glyphs it shows as it tumbles,
 * how many, how fast, the glyph left on the overlay for close ones and on the ground once it lands.
 */
function fallingSeason(look) {
  /** One of them; `depth` 0 is far and dim, 2 is close, two strokes deep, and lands on the pavement. */
  const spawn = ({ cols, rows, horizon }, at = null, depth = Math.random() < 0.35 ? 2 : Math.random() < 0.5 ? 1 : 0) => ({
    x: at ? at[0] : rnd(-cols * 0.3, cols),
    y: at ? at[1] : rnd(-8, 0),
    depth,
    vx: 0,
    vy: [1.6, 2.6, 3.6][depth] * rnd(0.8, 1.25) * look.fall,
    phase: rnd(0, 1),
    spin: rnd(0.6, 2.2) * (Math.random() < 0.5 ? -1 : 1),
    color: look.colors[Math.floor(Math.random() * look.colors.length)],
    landY: rnd(horizon + 1, rows - 5),
  });

  return {
    create(w, area) {
      for (let i = 0; i < area.cols * look.density; i++) w.parts.push({ ...spawn(area), y: rnd(-area.rows * 0.5, area.rows) });
      // ones that have come down and lie on the pavement for a while
      w.rest = [];
      w.shedIn = 0;
    },
    update(w, ctx, dt, street) {
      const { cols, rows, time } = ctx;
      const gust = Math.max(0, Math.sin(time * 0.35 + 1)) ** 3;
      for (let i = 0; i < w.parts.length; i++) {
        const p = w.parts[i];
        const near = 0.55 + p.depth * 0.3;
        const [wx, wy] = windAt(p.x, p.y);
        // momentum, so a swipe of the pointer sends them swirling and they settle back into the breeze
        const breeze = (Math.sin(time * 1.4 + p.phase * 6.28) * 2.2 + 2.5 + gust * 9) * near * look.drift;
        p.vx += (breeze - p.vx) * Math.min(1, dt * 1.5) + wx * dt * 3;
        p.y += (p.vy * (0.7 + 0.5 * Math.sin(time * 2.6 + p.phase * 6.28)) + wy * 0.6) * dt;
        p.x += p.vx * dt;
        p.phase += p.spin * dt * (1 + Math.abs(p.vx) * 0.08);
        if (p.depth === 2 && p.y >= p.landY && w.rest.length < 160) {
          w.rest.push({ x: p.x, y: Math.round(p.landY), color: p.color, ch: look.settled[Math.floor(Math.random() * look.settled.length)], age: 0 });
          w.parts[i] = spawn(ctx);
        } else if (p.y > rows - 3 || p.x > cols + 4 || p.x < -cols * 0.4) {
          w.parts[i] = spawn(ctx);
        }
      }
      // the trees let go of a few more now and then
      w.shedIn -= dt;
      if (street.trees.length && w.shedIn <= 0) {
        const box = canopy(street.trees[Math.floor(Math.random() * street.trees.length)]);
        w.parts.push(spawn(ctx, [rnd(box.x0, box.x1), rnd(box.y0, (box.y0 + box.y1) / 2)], 2));
        if (w.parts.length > cols * look.density * 1.6) w.parts.shift();
        w.shedIn = rnd(0.2, 0.8);
      }
      // fallen ones fade after a while; a sweep of the pointer lifts them back into the air
      w.rest = w.rest.filter((l) => {
        l.age += dt;
        const [wx, wy] = windAt(l.x, l.y);
        if (Math.hypot(wx, wy) <= 6) return l.age < SETTLE_FOR;
        w.parts.push({
          ...spawn(ctx, [l.x, l.y - 0.5], 2),
          vx: wx * 0.8,
          vy: Math.min(-3, wy * 0.5),
          color: l.color,
          landY: Math.min(rows - 5, l.y + rnd(0, 3)),
        });
        return false;
      });
    },
    draw(w, { buf, clock }) {
      const dim = look.night + (1 - look.night) * clock.daylight;
      for (const l of w.rest) buf.ink(l.x, l.y, l.ch, scale(l.color, dim * 0.8), Math.min(1, (SETTLE_FOR - l.age) / 5));
      for (const p of w.parts) {
        const ch = look.tumble[Math.floor((((p.phase % 1) + 1) % 1) * look.tumble.length)];
        const col = scale(p.color, dim * [0.55, 0.8, 1.05][p.depth]);
        buf.ink(p.x, p.y, ch, col, [0.55, 0.8, 1][p.depth]);
        // close ones are two strokes deep: the second sits on the overlay, half a cell off
        if (p.depth === 2) buf.over(p.x, p.y, look.over(ch), scale(col, 0.9));
      }
    },
  };
}

// a leaf seen as it tumbles: edge on, tilting, flat, curling
const autumn = fallingSeason({
  colors: [[222, 122, 40], [194, 64, 42], [232, 184, 52], [150, 92, 44], [236, 150, 50], [170, 54, 40]],
  tumble: ['-', '\\', '|', '/', '-', '~', ',', '`'],
  over: (ch) => (ch === '|' ? '(' : ch === '-' ? '_' : "'"),
  settled: [',', '_'],
  density: 0.24,
  fall: 1,
  drift: 1,
  night: 0.3,
});

// blossom: small, pale, slow, carried further by the breeze; it keeps a little of its colour at night
const petals = fallingSeason({
  colors: [[255, 136, 186], [255, 178, 212], [236, 104, 156], [255, 214, 232]],
  tumble: ['*', "'", '`', ',', '*', '~'],
  over: (ch) => (ch === '*' ? '.' : "'"),
  settled: ['.', ','],
  density: 0.5,
  fall: 0.6,
  drift: 1.3,
  night: 0.45,
});

// ---- spring: blossom drifting off the trees, birds by day
const spring = {
  create: petals.create,
  update(w, ctx, dt, street) {
    petals.update(w, ctx, dt, street);
    updateBirds(w, ctx, dt);
  },
  draw(w, ctx) {
    petals.draw(w, ctx);
    drawBirds(ctx.buf, w, ctx.time, 0.7);
  },
};

// ---- summer: birds by day; moths round the lamps and fireflies over the street at night

const summer = {
  create(w, { cols, rows, horizon }) {
    for (let i = 0; i < 6; i++) w.moths.push({ phase: rnd(0, 6.28), rx: rnd(1.4, 3.2), ry: rnd(1, 2.2), speed: rnd(2, 4), lamp: i });
    for (let i = 0; i < 9; i++) w.parts.push({ x: rnd(0, cols), y: rnd(horizon + 1, rows - 4), phase: rnd(0, 6.28), speed: rnd(0.3, 0.8) });
  },
  update(w, ctx, dt) {
    for (const p of w.parts) {
      p.x += Math.sin(ctx.time * p.speed + p.phase) * dt * 2;
      p.y += Math.cos(ctx.time * p.speed * 1.3 + p.phase) * dt;
    }
    updateBirds(w, ctx, dt);
  },
  draw(w, { buf, clock, time }, street) {
    drawBirds(buf, w, time, 1);
    if (clock.night <= 0.35) return;
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
  },
};

function updateBirds(w, { cols, horizon, time, clock }, dt) {
  w.birdIn -= dt;
  if (w.birdIn <= 0 && clock.daylight > 0.4 && w.birds.length < 3) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    w.birds.push({ x: dir > 0 ? -4 : cols + 4, y: rnd(horizon * 0.12, horizon * 0.5), dir, speed: rnd(4, 7), phase: rnd(0, 6) });
    w.birdIn = rnd(3, 9);
  }
  for (const b of w.birds) {
    b.x += b.dir * b.speed * dt;
    b.y += Math.sin(time * 0.8 + b.phase) * dt * 0.8;
  }
  w.birds = w.birds.filter((b) => b.x > -6 && b.x < cols + 6);
}

function drawBirds(buf, w, time, alpha) {
  for (const b of w.birds) {
    const sprite = Math.floor(time * 5 + b.phase) % 2 === 0 ? '\\v/' : '_v_';
    for (let i = 0; i < 3; i++) buf.ink(b.x + i, b.y, sprite[i], [34, 36, 44], alpha);
  }
}

const SEASONS = { winter, spring, summer, autumn };

/** `area` is { cols, rows, horizon }. */
export function createWeather(season, area) {
  const w = { season, parts: [], birds: [], birdIn: 2, moths: [] };
  SEASONS[season].create(w, area);
  return w;
}

export function updateWeather(w, ctx, dt, street) {
  SEASONS[w.season].update(w, ctx, dt, street);
}

export function drawWeather(ctx, w, street) {
  SEASONS[w.season].draw(w, ctx, street);
}

/** On the glass itself: frost in winter. */
export function drawGlass(ctx, w) {
  SEASONS[w.season].glass?.(w, ctx);
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

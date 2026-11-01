import { clamp01, lineGlyph, mix, scale } from './util.js';
import { frameWidth } from './window.js';
import { pointer } from './pointer.js';
import { CAT, CLOCK, INK, LEAF, PLANT, SOIL, Pix, blit, drawCatPix, drawClockPix, drawHearts, drawPlantPix } from './sprites.js';

// The things on the sill: pixel art on a canvas over the text scene (see sprites.js), except the
// clock's dial, which shows through a window in the case and is drawn in the text grid behind it.
//
// Each of them goes through the same cycle: hover (the outline warms up and a name tag appears),
// press, drag, release, and a reaction that settles back to idle.
//   cat    stroke it gently (press and move across it) and it purrs; scrub it and it hisses.
//          A tap gets a "mrrp?" and a few hearts. Its eyes follow the pointer.
//   clock  grab the dial and wind it round: one turn is an hour and the sky follows.
//          A tap rings the alarm and skips three hours.
//   plant  pick it up and carry it along the sill; it lands with a puff of soil.
//          A tap moves the season on.

const DIAL = [240, 234, 214];
const LABEL = [238, 232, 216];
const HINT = [150, 152, 166];
const GLOW = [236, 214, 160];
const PURR = [196, 188, 220];

const TAGS = {
  cat: { name: () => 'cat', hint: 'stroke gently' },
  clock: { name: (sky) => `clock ${fmtTime(sky.hour)}`, hint: 'wind the dial / tap to ring' },
  plant: { name: (sky) => `plant - ${sky.season}`, hint: 'drag to move / tap: season' },
};
// the plant is drawn last, so it wins where things overlap
const HIT_ORDER = ['plant', 'clock', 'cat'];

const rnd = (a, b) => a + Math.random() * (b - a);

const fmtTime = (h) => {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h % 1) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

/** A line of glyphs in the text grid, centred on `cx`; a dark ground keeps it legible over the city. */
function caption(buf, cx, r, str, col, a = 1) {
  const c0 = Math.round(cx - str.length / 2);
  for (let i = 0; i < str.length; i++) {
    if (str[i] === ' ') continue;
    buf.tint(c0 + i, r, [0, 0, 0], 0.55 * a);
    buf.ink(c0 + i, r, str[i], col, a);
    buf.over(c0 + i, r, ' ', col);
  }
}

/**
 * The dial behind the clock's window, in cells around (cc, rc): hour dots, the four numerals,
 * hour and minute hands that follow the sky, and a seconds dot on real time. `rad` is the window
 * radius in cells; `warm` (0…1) lights it up under the pointer.
 */
function drawDial(buf, cc, rc, rad, hour, amb, warm) {
  const face = mix(scale(DIAL, Math.max(amb, 0.78)), GLOW, warm * 0.25);
  const bg = scale(face, 0.62);
  const ink = scale(INK, 1.2);
  const reach = Math.ceil(rad + 0.7);
  for (let r = rc - reach; r <= rc + reach; r++) {
    for (let c = cc - reach; c <= cc + reach; c++) {
      if (Math.hypot(c - cc, r - rc) <= rad + 0.7) buf.put(c, r, ' ', face, bg);
    }
  }
  const at = (a, s) => [Math.round(cc + Math.sin(a) * s), Math.round(rc - Math.cos(a) * s)];
  for (let i = 0; i < 12; i++) {
    if (i % 3 === 0) continue;
    const [c, r] = at((i / 12) * Math.PI * 2, rad - 1.3);
    buf.put(c, r, '.', scale(ink, 1.6), bg);
  }
  // numerals and the minute hand stay well inside the window, clear of the lip
  const n = Math.floor(rad - 1.4);
  for (const [s, c, r] of [['12', cc - 1, rc - n], ['3', cc + n, rc], ['6', cc, rc + n], ['9', cc - n, rc]]) {
    for (let i = 0; i < s.length; i++) buf.put(c + i, r, s[i], ink, bg);
  }
  const hand = (a, len, col) => {
    for (let s = 0.7; s <= len; s += 0.5) {
      const [c, r] = at(a, s);
      buf.put(c, r, lineGlyph(a), col, bg);
    }
  };
  hand(((hour % 12) / 12) * Math.PI * 2, Math.max(1.2, rad * 0.45), ink);
  hand((hour % 1) * Math.PI * 2, n, [140, 48, 44]);
  const [sc, sr] = at(((Date.now() / 1000) % 60) / 60 * Math.PI * 2, n + 0.4);
  buf.put(sc, sr, '.', [210, 60, 50], bg);
  buf.put(cc, rc, 'o', ink, bg);
}

/**
 * Overlay canvas for the sill, the interaction cycle of the things on it and the bits that fly
 * off them. `actions` come from the scene: `time()`, `skipHours(h, instant)`, `nextSeason()`.
 */
export function createSill(canvas, actions) {
  const c2 = canvas.getContext('2d');
  const cat = { pix: new Pix(CAT.w, CAT.h), hit: null, pet: 0, annoy: 0, purrIn: 0, heartIn: 0, hearts: [], mrrpAt: -99, hissAt: -99, blinkAt: -99 };
  const clock = { pix: new Pix(CLOCK.w, CLOCK.h), hit: null, col: 0, cx: 0, cy: 0, angle: 0, ringAt: -99, ringFor: 0 };
  const plant = { pix: new Pix(PLANT.w, PLANT.h), hit: null, x: null, lift: 0, lean: 0, rustle: 0, landAt: -99, shakeAt: -99 };
  const objects = { cat, clock, plant };

  let parts = []; // glyphs flying off things: "prr", soil, leaves, "RING"
  let hover = null;
  let hoverA = 0;
  let press = null; // { id, x0, y0, moved, lastX, lastY, grabDx }
  let cursor = '';
  let enabled = false;
  let laidOutFor = 0;

  const hitAt = (x, y) =>
    HIT_ORDER.find((id) => {
      const h = objects[id].hit;
      return h && x >= h.c0 && x <= h.c1 && y >= h.r0 && y <= h.r1;
    }) ?? null;

  const spawn = (p) => parts.push({ vx: 0, vy: 0, g: 0, age: 0, life: 1, ...p });

  // ---- input: press on a thing, then the frame loop follows the pointer until release

  addEventListener('pointerdown', (e) => {
    if (!enabled || pointer.overUi || e.button > 0) return;
    const id = hitAt(pointer.x, pointer.y);
    if (!id) return;
    e.preventDefault();
    press = { id, x0: pointer.x, y0: pointer.y, moved: false, lastX: pointer.x, lastY: pointer.y, grabDx: pointer.x - (plant.x ?? 0) };
    if (id === 'clock') clock.angle = Math.atan2(pointer.x - clock.cx, clock.cy - pointer.y);
  });
  // keep a touch that starts on one of them from scrolling the page
  for (const type of ['touchstart', 'touchmove']) addEventListener(type, (e) => press && e.preventDefault(), { passive: false });

  const release = () => {
    if (!press) return;
    const t = actions.time();
    const { id, moved } = press;
    press = null;
    if (id === 'cat' && !moved && t - cat.hissAt > 2) {
      cat.mrrpAt = t;
      cat.blinkAt = t + 0.4;
      cat.hearts.push(t);
    } else if (id === 'clock') {
      clock.ringAt = t;
      clock.ringFor = moved ? 0.5 : 1.4;
      if (!moved) actions.skipHours(3);
    } else if (id === 'plant' && moved) {
      plant.landAt = t;
      plant.dust = true;
    } else if (id === 'plant') {
      plant.shakeAt = t;
      plant.burst = true;
      actions.nextSeason();
    }
  };
  for (const type of ['pointerup', 'pointercancel', 'blur']) addEventListener(type, release);

  /** Per-frame work for the press in progress: strokes, winding, carrying. */
  function drive(t, dt, cols, ft, plantCells) {
    if (!press) return;
    const dx = pointer.x - press.lastX;
    const dy = pointer.y - press.lastY;
    press.lastX = pointer.x;
    press.lastY = pointer.y;
    if (!press.moved && Math.hypot(pointer.x - press.x0, pointer.y - press.y0) > 1.2) press.moved = true;
    if (!press.moved) return;

    if (press.id === 'cat') strokeCat(t, dt, Math.hypot(dx, dy));
    else if (press.id === 'clock') windClock();
    else carryPlant(dt, cols, ft, plantCells);
  }

  // gentle strokes build up the purr; scrubbing fast annoys the cat until it hisses
  function strokeCat(t, dt, dist) {
    if (t - cat.hissAt < 2 || hitAt(pointer.x, pointer.y) !== 'cat') return;
    if (dist / Math.max(dt, 1e-3) > 70) cat.annoy += dt * 1.6;
    else cat.pet = Math.min(1.3, cat.pet + Math.min(dist, 40 * dt) * 0.02);
    if (cat.annoy <= 1) return;
    Object.assign(cat, { hissAt: t, pet: 0, annoy: 0 });
    spawn({ x: cat.hit.c0 + 4, y: cat.hit.r0 - 1, text: 'hss!', col: [255, 120, 100], vy: -2, life: 1.2 });
    press = null;
  }

  // one turn round the dial is an hour, and the sky follows
  function windClock() {
    const a = Math.atan2(pointer.x - clock.cx, clock.cy - pointer.y);
    const d = ((a - clock.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    clock.angle = a;
    actions.skipHours(d / (Math.PI * 2), true);
    if (Math.abs(d) > 0.05 && Math.random() < 0.3) spawn({ x: clock.cx + rnd(-4, 3), y: clock.hit.r0 - 1, text: 'tk', col: [200, 196, 180], vy: -3, life: 0.5 });
  }

  function carryPlant(dt, cols, ft, plantCells) {
    const x = Math.max(ft + 1, Math.min(cols - ft - 1 - plantCells, pointer.x - press.grabDx));
    // the leaves trail behind the way it is carried
    plant.lean += ((x - plant.x) * 0.06 - plant.lean) * Math.min(1, dt * 10);
    plant.x = x;
  }

  // ---- drawing; `f` is the frame layout: canvas scale, the grid and where the sill is

  function drawCat(f) {
    const { ctx, sky, t, dt, P, bottom, ox, cw, ft } = f;
    const x = ox + (ft + 2) * cw;
    // shrink a little if the text column would cover most of it
    const fit = Math.max(0.85, Math.min(1.15, (f.panelPx - x) / (CAT.WIDTH * CAT.k * P)));
    const k = CAT.k * fit;
    const hiss = Math.max(0, 1 - (t - cat.hissAt) / 2);
    const purr = hiss ? 0 : clamp01((cat.pet - 0.2) / 0.4);
    const tapped = Math.max(0, 1 - (t - cat.mrrpAt) / 1.6);
    const look = pointer.inside && !pointer.overUi && cat.hit
      ? Math.max(-1, Math.min(1, (pointer.x - (cat.hit.c0 + cat.hit.c1) / 2) / 14))
      : null;
    drawCatPix(cat.pix, f.amb, k, {
      t,
      // purring only deepens the breath; the body itself stays put
      breath: 0.16 * Math.sin(t * 2.3) + purr * 0.05 * Math.sin(t * 9),
      ears: hiss ? -1 : hover === 'cat' ? 1 : 0,
      lash: hiss,
      eyes: {
        happy: purr > 0 || (tapped > 0 && tapped < 0.75),
        blink: (t * 0.2) % 1 > 0.97 || (t > cat.blinkAt && t - cat.blinkAt < 0.35),
        wide: hiss > 0,
        look,
      },
      // a faint edge of moonlight at night, so the black cat never melts into the dark
      edge: f.edge('cat', mix([70, 76, 112], [40, 36, 44], sky.daylight)),
    });
    blit(c2, cat.pix, x, bottom, P);
    const b = cat.pix.bounds();
    cat.hit = f.toCells(x + b[0] * P, bottom - (b[3] + 1) * P, (b[2] - b[0] + 1) * P, (b[3] - b[1] + 1) * P);
    const headX = x + CAT.HEAD[0] * k * P;
    const headY = bottom - CAT.HEAD[1] * k * P;
    const headCol = (headX - ox) / cw;

    // purring sends up little "prr"s, and a long gentle stroke a few hearts
    if (purr) {
      cat.purrIn -= dt;
      if (cat.purrIn <= 0) {
        spawn({ x: headCol + rnd(3, 9), y: cat.hit.r0 + 2, text: Math.random() < 0.5 ? 'prr' : 'rrr', col: PURR, vy: -2.2, vx: rnd(0.5, 1.5), life: 1.4 });
        cat.purrIn = 0.5;
      }
      cat.heartIn -= dt;
      if (cat.pet > 0.9 && cat.heartIn <= 0) {
        cat.hearts.push(t);
        cat.heartIn = 1.2;
      }
    }
    cat.hearts = cat.hearts.filter((s) => t - s < 2.4);
    for (const s of cat.hearts) drawHearts(c2, headX, headY, P, (t - s) / 2.4);
    if (tapped) caption(ctx.buf, headCol + 1, Math.floor(cat.hit.r0) - 2, 'mrrp?', LABEL, Math.min(1, tapped * 3));
    // the purr fades when no one strokes it, the annoyance too
    if (press?.id !== 'cat') cat.pet = Math.max(0, cat.pet - dt * 0.3);
    cat.annoy = Math.max(0, cat.annoy - dt * 0.5);
    // the cat's own voice takes the place of its tag
    return { cx: headCol + 1, quiet: tapped > 0 || purr > 0 || hiss > 0 };
  }

  function drawClock(f) {
    const { ctx, sky, t, P, bottom, ox, oy, cw, ch } = f;
    const ringing = t - clock.ringAt < clock.ringFor;
    // the dial's centre falls on the middle of a cell so the text dial lines up with the window;
    // the clock may sink a few pixels into the sill for it
    const row = Math.round((bottom - CLOCK.cy * P - oy) / ch - 0.5);
    const x = ox + (clock.col + 0.5) * cw - CLOCK.cx * P;
    const base = oy + (row + 0.5) * ch + CLOCK.cy * P;
    drawDial(ctx.buf, clock.col, row, (CLOCK.dial * P) / cw, sky.hour, f.amb, hover === 'clock' ? hoverA : 0);
    drawClockPix(clock.pix, f.amb, ringing, f.edge('clock', scale(INK, f.amb)));
    blit(c2, clock.pix, x, base, P, { dx: ringing ? Math.round(Math.sin((t - clock.ringAt) * 40) * P) : 0 });
    clock.cx = clock.col + 0.5;
    clock.cy = row + 0.5;
    clock.hit = f.toCells(x, base - CLOCK.h * P, CLOCK.w * P, CLOCK.h * P);
    if (ringing && Math.random() < 0.35) {
      const s = Math.random() < 0.5 ? -1 : 1;
      spawn({ x: clock.cx + s * rnd(5, 8), y: clock.hit.r0, text: Math.random() < 0.5 ? 'RING' : '!', col: [255, 220, 120], vx: s * 3, vy: -3, life: 0.6 });
    }
    return { cx: clock.cx };
  }

  function drawPlant(f) {
    const { ctx, sky, t, dt, P, bottom, ox, cw, ch, plantCells } = f;
    const carried = press?.id === 'plant' && press.moved;
    plant.lift += ((carried ? 1 : 0) - plant.lift) * Math.min(1, dt * 14);
    if (!carried) plant.lean *= Math.exp(-dt * 3);
    plant.rustle += ((hover === 'plant' ? 1 : 0) - plant.rustle) * Math.min(1, dt * 5);
    const shake = Math.max(0, 1 - (t - plant.shakeAt) / 0.8);
    const since = t - plant.landAt;
    const hop = since < 0.35 ? Math.sin((since / 0.35) * Math.PI) * 3 * P : 0;
    const lift = plant.lift * 2.2 * ch + hop;
    const x = ox + plant.x * cw;
    const mid = plant.x + plantCells / 2;
    // its shadow stays on the sill while it is up in the air
    if (plant.lift > 0.2) for (let c = Math.round(plant.x + 1); c < plant.x + plantCells - 1; c++) ctx.buf.tint(c, f.sillTop, [0, 0, 0], 0.5 * plant.lift);
    const lean = -plant.lean + plant.rustle * Math.sin(t * 9) * 0.05 + shake * Math.sin(t * 30) * 0.25;
    drawPlantPix(plant.pix, f.amb, sky.season, t, lean, f.edge('plant', scale(INK, f.amb * 0.9)));
    blit(c2, plant.pix, x, bottom, P, { dy: -lift });
    plant.hit = f.toCells(x + 3 * P, bottom - lift - 25 * P, 26 * P, 25 * P);
    // a puff of soil when it lands, a flurry of leaves when the season turns
    if (plant.dust) {
      plant.dust = false;
      for (let i = 0; i < 10; i++) spawn({ x: mid + rnd(-6, 6), y: f.sillTop - 1, text: ".,'"[i % 3], col: scale(SOIL, 2.4), vx: rnd(-7, 7), vy: rnd(-5, -2), g: 18, life: 0.6 });
    }
    if (plant.burst) {
      plant.burst = false;
      const leaves = LEAF[sky.season];
      for (let i = 0; i < 14; i++) spawn({ x: mid + rnd(-5, 5), y: plant.hit.r0 + rnd(0, 5), text: ",'`"[i % 3], col: leaves[i % leaves.length], vx: rnd(-6, 6), vy: rnd(-6, -1), g: 6, life: 1.6, flutter: true });
    }
    return { cx: mid };
  }

  function drawParts(buf, dt) {
    for (const p of parts) {
      p.age += dt;
      p.vy += p.g * dt;
      p.x += (p.vx + (p.flutter ? Math.sin(p.age * 8) * 3 : 0)) * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-dt * 1.5);
      const a = Math.min(1, clamp01(1 - p.age / p.life) * 1.4);
      for (let i = 0; i < p.text.length; i++) buf.ink(Math.round(p.x) + i, Math.round(p.y), p.text[i], p.col, a);
    }
    parts = parts.filter((p) => p.age < p.life);
  }

  /** Canvas scale and where things stand this frame. */
  function layout(ctx, grid, sillTop, panelCol) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = grid.cellWidth * dpr;
    const ch = grid.cellHeight * dpr;
    const ox = grid.offsetX * dpr;
    const oy = grid.offsetY * dpr;
    // sprites keep the size they had when cells were ~innerWidth / 120 wide
    const P = Math.max(1, Math.floor((Math.max(10, Math.min(22, Math.round(innerWidth / 120))) * dpr) / 2));
    const amb = 0.6 + 0.4 * clamp01(ctx.clock.daylight + 0.15);
    return {
      ctx, sky: ctx.clock, t: ctx.time, dt: ctx.dt,
      dpr, cw, ch, ox, oy, P, amb, sillTop,
      bottom: oy + sillTop * ch,
      ft: frameWidth(ctx.cols),
      panelPx: (grid.offsetX + panelCol * grid.cellWidth) * dpr,
      plantCells: (PLANT.w * P) / cw,
      /** A canvas-pixel rectangle as a cell rectangle, for hit-testing against the pointer. */
      toCells: (x, y, w, h) => ({ c0: (x - ox) / cw, r0: (y - oy) / ch, c1: (x + w - ox) / cw, r1: (y + h - oy) / ch }),
      /** Outline colour: warmer while the pointer is on it. */
      edge: (id, base) => (hover === id ? mix(base, GLOW, 0.75 * hoverA) : base),
    };
  }

  return function drawSill(ctx, grid, sillTop, panelCol) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(innerWidth * dpr);
    const h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.imageSmoothingEnabled = false;
    c2.clearRect(0, 0, w, h);
    // the sill is too cramped on phones; the scene stays a view
    enabled = innerWidth >= 700;
    if (!enabled) {
      hover = press = null;
      return;
    }

    const f = layout(ctx, grid, sillTop, panelCol);
    const { cols } = ctx;
    // where things stand by default; a resize puts them back
    if (laidOutFor !== cols) {
      plant.x = cols - f.ft - 9 - f.plantCells / 2;
      clock.col = Math.round(plant.x - (CLOCK.w * f.P * 0.5 + 2 * f.P) / f.cw - 1);
      laidOutFor = cols;
    }

    drive(f.t, f.dt, cols, f.ft, f.plantCells);
    const now = press ? press.id : pointer.inside && !pointer.overUi ? hitAt(pointer.x, pointer.y) : null;
    if (now !== hover) {
      hover = now;
      hoverA = 0;
    }
    hoverA = Math.min(1, hoverA + f.dt * 6);

    const anchors = { cat: drawCat(f), clock: drawClock(f), plant: drawPlant(f) };
    drawParts(ctx.buf, f.dt);

    if (hover && !anchors[hover].quiet) {
      const top = Math.floor(objects[hover].hit.r0);
      const tag = TAGS[hover];
      caption(ctx.buf, anchors[hover].cx, top - 3, tag.name(f.sky), LABEL, hoverA);
      caption(ctx.buf, anchors[hover].cx, top - 2, tag.hint, HINT, hoverA * 0.9);
    }

    const want = press ? (press.id === 'cat' ? 'grab' : 'grabbing') : hover ? (hover === 'plant' ? 'grab' : 'pointer') : '';
    if (want !== cursor) {
      cursor = want;
      document.documentElement.style.cursor = want;
    }
  };
}

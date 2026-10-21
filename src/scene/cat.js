import { clamp01, hash2, scale } from './util.js';

// o fur, d dark fur, w white, x closed eye, O open eye, n nose
const POSES = {
  loaf: { sprite: ['d   d       ', 'ooooo       ', 'oxoxoooooooo', 'wwoooooooood'], breath: [2, 5], zAt: 5 },
  curled: { sprite: ['  d   d  ', ' ooooooo ', 'ooxooxooo', 'ddddooddd'], breath: [1, 2], zAt: 6 },
  sprawl: { sprite: ['d   d         ', 'oxoxooooooooot', 'wwooooooooooow'], breath: [1, 5], zAt: 5 },
  sit: { sprite: ['d   d ', 'ooooo ', 'oOnOo ', 'ooooo ', 'ooooo ', 'wwoww '], tail: true },
};
const MINI = {
  loaf: { sprite: ['d d    ', 'oooooo ', 'ooooooo'], breath: [1, 3], zAt: 4 },
  sit: { sprite: ['d  d', 'oOOo', 'oooo', 'oooo'] },
};

const FUR = { o: [218, 142, 70], d: [160, 94, 44], t: [160, 94, 44], w: [240, 222, 190], n: [226, 140, 150] };
const EYE = [240, 218, 84];
const forced = new URLSearchParams(location.search).get('cat');

function pickPose(clock, time) {
  if (forced && POSES[forced]) return forced;
  const h = hash2(Math.floor(time / 90), 3, 99);
  if (clock.twilight > 0.55) return 'sit';
  if (clock.night > 0.6) return h < 0.22 ? 'sit' : clock.season === 'winter' || h < 0.7 ? 'curled' : 'loaf';
  if (clock.season === 'summer') return h < 0.7 ? 'sprawl' : 'loaf';
  if (clock.season === 'winter') return 'curled';
  return h < 0.25 ? 'sit' : 'loaf';
}

function drawSprite(ctx, pose, x, y, shade, withZ) {
  const { buf, clock, time } = ctx;
  const amb = (0.6 + 0.4 * clamp01(clock.daylight + 0.15)) * shade;
  const inhale = Math.sin(time * 2.6) > 0 ? 1.1 : 1;
  pose.sprite.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const code = row[c];
      if (code === ' ') continue;
      let bg;
      let ch = ' ';
      let fg = [0, 0, 0];
      if (code === 'O') {
        bg = EYE;
        ch = '|';
        fg = [34, 26, 10];
      } else {
        bg = scale(FUR[code === 'x' ? 'o' : code], amb);
        if (code === 'x') {
          ch = '-';
          fg = scale(FUR.d, amb * 0.7);
        }
        if (pose.breath && r >= pose.breath[0] && c >= pose.breath[1]) bg = scale(bg, inhale);
      }
      buf.put(x + c, y + r, ch, fg, bg);
    }
  });

  if (pose.tail) {
    const flick = Math.sin(time * 3.2) > 0.3;
    const tx = x + pose.sprite[0].length;
    const bottom = y + pose.sprite.length - 1;
    buf.put(tx - 1, bottom, ' ', [0, 0, 0], scale(FUR.d, amb));
    buf.put(tx, flick ? bottom - 1 : bottom, ' ', [0, 0, 0], scale(FUR.d, amb));
  }
  if (withZ && pose.zAt) {
    for (let k = 0; k < 3; k++) {
      const p = (time * 0.35 + k / 3) % 1;
      buf.ink(x + pose.zAt + p * 4 + Math.sin(p * 6) * 0.8, y - 1 - p * 5, p < 0.45 ? 'z' : 'Z', [226, 232, 255], (1 - p) * 0.9);
    }
  }
}

/** Cat on the sill; `bottom` is the row just above the sill. Returns nothing: the width depends on the pose. */
export function drawSillCat(ctx, x, bottom) {
  const name = pickPose(ctx.clock, ctx.time);
  const pose = POSES[name];
  drawSprite(ctx, pose, x, bottom - pose.sprite.length + 1, 1, !!pose.zAt);
}

/** A flat-roofed building near a screen edge, so the cat stays visible beside the text column. */
export function pickRoofCat(layer, cols, horizon) {
  const flats = layer.buildings.filter((b) => b.roof === 'flat' && b.w >= 7 && b.x > 1 && b.x + b.w < cols - 1);
  const at = (lo, hi) => flats.find((b) => (b.x + b.w / 2) / cols >= lo && (b.x + b.w / 2) / cols <= hi);
  const b = at(0.83, 0.97) ?? at(0.03, 0.17) ?? flats[0];
  return b ? { x: b.x + (b.w >> 1) - 2, roofRow: horizon - b.h } : null;
}

export function drawRoofCat(ctx) {
  const spot = ctx.roofCat;
  if (!spot) return;
  const { clock, time } = ctx;
  const sit = clock.night > 0.5 && hash2(Math.floor(time / 90), 8, 99) < 0.5;
  const pose = sit ? MINI.sit : MINI.loaf;
  drawSprite(ctx, pose, spot.x, spot.roofRow - pose.sprite.length, 0.8, !sit);
}

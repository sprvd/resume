import { create } from 'textmode.js';
import { CellBuffer } from './buffer.js';
import { createClock } from './clock.js';
import { getPalette } from './palette.js';
import { drawSky } from './sky.js';
import { buildSkyline, drawCity } from './city.js';
import { createStreet, updateStreet, drawStreet } from './street.js';
import { createWeather, updateWeather, drawWeather, drawFog, drawGlass } from './weather.js';
import { drawForeground, sillRow } from './window.js';
import { createSill } from './sill.js';
import { bindGrid, settlePointer } from './pointer.js';

const canvas = document.getElementById('scene');
const params = new URLSearchParams(location.search);

if (canvas && !params.has('noscene')) start(canvas);

// UrsaFont is an 8px bitmap font: stay on multiples of 8 so glyphs stay crisp
function pickFontSize() {
  return innerWidth >= 2400 ? 16 : innerWidth >= 1700 ? 12 : 8;
}

function start(canvas) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t;
  try {
    t = create({ canvas, fontSize: pickFontSize(), frameRate: 24 });
  } catch (err) {
    console.warn('ASCII scene disabled:', err);
    canvas.remove();
    return;
  }

  const clockAt = createClock();
  const sill = document.getElementById('sill');
  const drawSill = sill
    ? createSill(sill, {
        time: () => ctx.time,
        skipHours: clockAt.skipHours,
        nextSeason: clockAt.nextSeason,
      })
    : null;
  const buf = new CellBuffer();
  const ctx = { buf, cols: 0, rows: 0, horizon: 0, time: 0, dt: 0, clock: null, pal: null };
  // first column the text panel covers; the cat shrinks to stay clear of it
  let panelCol = Infinity;
  let skyline, street, weather, weatherSeason;
  let last = performance.now();
  let elapsed = 0;

  // second glyph pass, half a cell off the first and screened over it
  let over = null;
  const fit = () => {
    const fs = pickFontSize();
    t.fontSize(fs);
    t.resizeCanvas(innerWidth, innerHeight);
    over?.fontSize(fs);
    over?.offset(t.grid.cellWidth / 2, t.grid.cellHeight / 2);
    bindGrid(t.grid);
    const left = document.querySelector('.head')?.getBoundingClientRect().left;
    panelCol = left === undefined ? Infinity : (left - t.grid.offsetX) / t.grid.cellWidth;
  };

  const rebuild = (cols, rows) => {
    ctx.cols = cols;
    ctx.rows = rows;
    // portrait: lift the skyline into the strip above the first panel
    ctx.horizon = rows > cols * 1.2 ? Math.round(rows * 0.4) : rows - Math.max(12, Math.round(rows * 0.22));
    buf.resize(cols, rows);
    skyline = buildSkyline(cols, ctx.horizon);
    street = createStreet(cols, rows, ctx.horizon);
    weatherSeason = clockAt(0).season;
    weather = createWeather(weatherSeason, ctx);
  };

  t.windowResized(() => {
    fit();
    if (reduced) t.redraw();
  });
  t.setup(() => {
    over = t.layers.add({ blendMode: t.BLEND_SCREEN, fontSize: pickFontSize() });
    over.draw(() => buf.flushOver(t));
    fit();
  });

  t.draw(() => {
    const { cols, rows } = t.grid;
    if (cols !== ctx.cols || rows !== ctx.rows) rebuild(cols, rows);

    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    elapsed += dt;

    ctx.time = elapsed;
    ctx.dt = dt;
    settlePointer(dt);
    ctx.clock = clockAt(elapsed);
    if (ctx.clock.season !== weatherSeason) {
      weatherSeason = ctx.clock.season;
      weather = createWeather(weatherSeason, ctx);
    }
    ctx.pal = getPalette(ctx.clock);

    updateStreet(street, ctx, dt);
    updateWeather(weather, ctx, dt, street);

    drawSky(ctx);
    drawCity(ctx, skyline, drawFog);
    drawStreet(ctx, street);
    buf.lift = ctx.clock.daylight;
    buf.asciify();
    drawWeather(ctx, weather, street);
    drawGlass(ctx, weather);
    drawForeground(ctx);
    drawSill?.(ctx, t.grid, sillRow(rows), panelCol);

    buf.flush(t);
    if (reduced) t.noLoop();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) t.noLoop();
    else if (!reduced) {
      last = performance.now();
      t.loop();
    }
  });
}

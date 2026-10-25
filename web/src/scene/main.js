import { create } from 'textmode.js';
import { CellBuffer } from './buffer.js';
import { createClock } from './clock.js';
import { getPalette } from './palette.js';
import { drawSky } from './sky.js';
import { buildSkyline, drawCityLayer, createStreet, updateStreet, drawStreet } from './city.js';
import { createWeather, updateWeather, drawWeather, drawFog, drawGlass } from './weather.js';
import { drawForeground, sillRow } from './window.js';
import { createSill } from './sill.js';

const canvas = document.getElementById('scene');
const params = new URLSearchParams(location.search);

if (canvas && !params.has('noscene')) start(canvas);

function pickFontSize() {
  return Math.max(10, Math.min(22, Math.round(innerWidth / 120)));
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

  const sill = document.getElementById('sill');
  const clockAt = createClock();
  const drawSill = sill
    ? createSill(sill, {
        time: () => ctx.time,
        skipHours: clockAt.skipHours,
        nextSeason: clockAt.nextSeason,
      })
    : null;
  const buf = new CellBuffer();
  const ctx = { buf, cols: 0, rows: 0, horizon: 0, time: 0, clock: null, pal: null };
  let skyline, street, weather, weatherSeason;
  let last = performance.now();
  let elapsed = 0;

  const fit = () => {
    t.fontSize(pickFontSize());
    t.resizeCanvas(innerWidth, innerHeight);
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
    weather = createWeather(weatherSeason, cols, rows, ctx.horizon);
  };

  t.windowResized(() => {
    fit();
    if (reduced) t.redraw();
  });
  t.setup(fit);
  window.addEventListener('mono-change', () => reduced && t.redraw());

  t.draw(() => {
    const { cols, rows } = t.grid;
    if (cols !== ctx.cols || rows !== ctx.rows) rebuild(cols, rows);

    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    elapsed += dt;

    ctx.time = elapsed;
    ctx.clock = clockAt(elapsed);
    if (ctx.clock.season !== weatherSeason) {
      weatherSeason = ctx.clock.season;
      weather = createWeather(weatherSeason, cols, rows, ctx.horizon);
    }
    ctx.pal = getPalette(ctx.clock);

    updateStreet(street, ctx, dt);
    updateWeather(weather, ctx, dt);

    drawSky(ctx);
    drawCityLayer(ctx, skyline[0]);
    drawFog(ctx);
    drawCityLayer(ctx, skyline[1]);
    drawCityLayer(ctx, skyline[2]);
    drawStreet(ctx, street);
    buf.lift = ctx.clock.daylight;
    buf.asciify();
    drawWeather(ctx, weather, street);
    drawGlass(ctx, weather);
    drawForeground(ctx);
    drawSill?.(ctx, t.grid, sillRow(rows));

    buf.mono = document.documentElement.dataset.mono === '1';
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

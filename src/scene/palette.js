import { mix } from './util.js';

const DAY = {
  winter: { top: [134, 160, 192], horizon: [214, 222, 232], far: [172, 184, 202], mid: [136, 148, 166], near: [98, 108, 126] },
  spring: { top: [94, 158, 224], horizon: [200, 224, 240], far: [162, 180, 198], mid: [126, 142, 160], near: [90, 102, 120] },
  summer: { top: [54, 134, 230], horizon: [208, 230, 244], far: [172, 188, 206], mid: [136, 150, 168], near: [98, 110, 128] },
  autumn: { top: [118, 144, 178], horizon: [234, 206, 172], far: [178, 178, 186], mid: [142, 140, 152], near: [104, 102, 114] },
};
const NIGHT = { top: [5, 7, 20], horizon: [26, 30, 62], far: [20, 24, 48], mid: [15, 18, 36], near: [10, 12, 26] };

export const WINDOW_LIT = [255, 206, 124];

export function getPalette(clock) {
  const d = clock.daylight;
  const w = clock.twilight;
  const day = DAY[clock.season];
  const p = {};
  for (const k of Object.keys(NIGHT)) p[k] = mix(NIGHT[k], day[k], d);
  p.horizon = mix(p.horizon, [246, 140, 84], w * 0.75);
  p.top = mix(p.top, [100, 74, 144], w * 0.3);
  p.far = mix(p.far, [190, 120, 112], w * 0.3);
  p.mid = mix(p.mid, [150, 96, 100], w * 0.2);
  p.road = mix([20, 22, 28], [78, 80, 90], d);
  p.sidewalk = mix([38, 40, 50], [132, 134, 142], d);
  p.snow = mix([150, 168, 210], [240, 246, 255], d);
  return p;
}

import { smoothstep } from './util.js';

const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const SEASON_BY_MONTH = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0];
// Sunrise / sunset hours, roughly mid-season at 55°N.
const SUN = { winter: [8.6, 16.2], spring: [6.2, 19.8], summer: [4.7, 21.3], autumn: [7.6, 18.2] };

export function moonPhase(date) {
  const synodic = 29.530588;
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  return (((days % synodic) + synodic) % synodic) / synodic;
}

/** `?season=winter&time=22:00` override the real date for debugging. */
export function createClock(search = location.search) {
  const q = new URLSearchParams(search);
  const now = new Date();
  const forced = q.get('season');
  let season = SEASONS.includes(forced) ? forced : SEASONS[SEASON_BY_MONTH[now.getMonth()]];
  const m = /^(\d{1,2}):(\d{2})$/.exec(q.get('time') ?? '');
  const startHour = m ? +m[1] + +m[2] / 60 : now.getHours() + now.getMinutes() / 60;
  const phase = moonPhase(now);
  // time skips ease in over a second or so so the sky sweeps instead of jumping
  let shift = 0;
  let target = 0;
  let last = 0;

  function clockAt(elapsedSec) {
    shift += (target - shift) * Math.min(1, Math.max(0, elapsedSec - last) * 2.5);
    last = elapsedSec;
    const [rise, set] = SUN[season];
    const nightLen = 24 - set + rise;
    const hour = (((startHour + elapsedSec / 3600 + shift) % 24) + 24) % 24;
    const sunUp = hour >= rise && hour <= set;
    const daylight = smoothstep(rise - 0.6, rise + 0.7, hour) * (1 - smoothstep(set - 0.7, set + 0.6, hour));
    const edge = Math.min(Math.abs(hour - rise), Math.abs(hour - set));
    const twilight = Math.max(0, 1 - edge / 1.1);
    const bodyP = sunUp ? (hour - rise) / (set - rise) : ((hour >= set ? hour - set : hour + 24 - set)) / nightLen;
    return { season, hour, sunUp, daylight, twilight, night: 1 - daylight, bodyP, moonPhase: phase };
  }

  clockAt.skipHours = (h) => { target += h; };
  clockAt.nextSeason = () => { season = SEASONS[(SEASONS.indexOf(season) + 1) % SEASONS.length]; };
  return clockAt;
}

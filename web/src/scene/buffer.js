import { hash2 } from './util.js';

const RAMP = [' ', '.', ':', '-', '=', '+', '*', '#', '%'];

/** Single-hue version of a colour, keeping its brightness. */
function tint(a, k) {
  const l = Math.min(1, ((0.299 * a[k] + 0.587 * a[k + 1] + 0.114 * a[k + 2]) / 255) ** 0.85 * 1.08);
  return [MONO[0] * l, MONO[1] * l, MONO[2] * l];
}

/** Back buffer of terminal cells; layers write into it, flush() draws it through textmode.js. */
const MONO = [255, 255, 255];

export class CellBuffer {
  cols = 0;
  rows = 0;
  mono = false;
  /** 0 at night, 1 in full daylight: lifts the dark backing and the glyph brightness. */
  lift = 0;

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.ch = new Array(n).fill(' ');
    this.fg = new Uint8ClampedArray(n * 3);
    this.bg = new Uint8ClampedArray(n * 3);
  }

  #at(c, r) {
    c = Math.floor(c);
    r = Math.floor(r);
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? -1 : r * this.cols + c;
  }

  bgAt(c, r) {
    const i = this.#at(c, r);
    if (i < 0) return null;
    const b = this.bg;
    return [b[i * 3], b[i * 3 + 1], b[i * 3 + 2]];
  }

  setBg(c, r, col, a = 1) {
    const i = this.#at(c, r);
    if (i < 0) return;
    const b = this.bg;
    const k = i * 3;
    b[k] += (col[0] - b[k]) * a;
    b[k + 1] += (col[1] - b[k + 1]) * a;
    b[k + 2] += (col[2] - b[k + 2]) * a;
  }

  /** Glyph on top of whatever background is there; `a` fades the glyph toward the background. */
  ink(c, r, ch, col, a = 1) {
    const i = this.#at(c, r);
    if (i < 0) return;
    const k = i * 3;
    const b = this.bg;
    const f = this.fg;
    this.ch[i] = ch;
    f[k] = b[k] + (col[0] - b[k]) * a;
    f[k + 1] = b[k + 1] + (col[1] - b[k + 1]) * a;
    f[k + 2] = b[k + 2] + (col[2] - b[k + 2]) * a;
  }

  put(c, r, ch, fg, bg) {
    const i = this.#at(c, r);
    if (i < 0) return;
    const k = i * 3;
    this.ch[i] = ch;
    this.fg[k] = fg[0];
    this.fg[k + 1] = fg[1];
    this.fg[k + 2] = fg[2];
    this.bg[k] = bg[0];
    this.bg[k + 1] = bg[1];
    this.bg[k + 2] = bg[2];
  }

  /** Blend both background and glyph toward `col` (fog, frost). */
  tint(c, r, col, a) {
    const i = this.#at(c, r);
    if (i < 0) return;
    const k = i * 3;
    for (let j = 0; j < 3; j++) {
      this.bg[k + j] += (col[j] - this.bg[k + j]) * a;
      this.fg[k + j] += (col[j] - this.fg[k + j]) * a;
    }
  }

  /** Additive radial light. */
  glow(cx, cy, rad, col, k) {
    const r0 = Math.floor(cy - rad);
    const r1 = Math.ceil(cy + rad);
    const c0 = Math.floor(cx - rad);
    const c1 = Math.ceil(cx + rad);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = this.#at(c, r);
        if (i < 0) continue;
        const dist = Math.hypot(c + 0.5 - cx, r + 0.5 - cy);
        if (dist >= rad) continue;
        const f = (1 - dist / rad) ** 2 * k;
        const j = i * 3;
        for (let m = 0; m < 3; m++) {
          this.bg[j + m] += col[m] * f;
          this.fg[j + m] += col[m] * f * 0.6;
        }
      }
    }
  }

  /**
   * Turn the painted scene into text: brightness picks glyph density, colour goes to the glyph,
   * the cell itself drops to a dark backing. Cells that already carry a glyph keep it.
   */
  asciify() {
    const { cols, rows, ch, fg, bg } = this;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const k = i * 3;
        const R = bg[k];
        const G = bg[k + 1];
        const B = bg[k + 2];
        if (ch[i] === ' ') {
          const lum = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
          const cover = 0.12 + 0.52 * Math.min(1, lum) + (hash2(c, r, 77) - 0.5) * 0.36;
          ch[i] = RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(cover * (RAMP.length - 1))))];
          // brighten the glyph but keep its hue
          const f = Math.min(1.6, (215 + 35 * this.lift) / Math.max(R, G, B, 1));
          fg[k] = R * f;
          fg[k + 1] = G * f;
          fg[k + 2] = B * f;
        }
        const back = 0.42 + 0.3 * this.lift;
        bg[k] = R * back;
        bg[k + 1] = G * back;
        bg[k + 2] = B * back;
      }
    }
  }

  flush(t) {
    const { cols, rows, ch, fg, bg } = this;
    const ox = cols / 2;
    const oy = rows / 2;
    const same = (i, j) =>
      ch[i] === ch[j] &&
      fg[i * 3] === fg[j * 3] && fg[i * 3 + 1] === fg[j * 3 + 1] && fg[i * 3 + 2] === fg[j * 3 + 2] &&
      bg[i * 3] === bg[j * 3] && bg[i * 3 + 1] === bg[j * 3 + 1] && bg[i * 3 + 2] === bg[j * 3 + 2];

    for (let r = 0; r < rows; r++) {
      let c = 0;
      while (c < cols) {
        const i = r * cols + c;
        let n = 1;
        while (c + n < cols && same(i, i + n)) n++;
        t.push();
        t.translate(c + n / 2 - ox, r + 0.5 - oy);
        t.char(ch[i]);
        if (this.mono) {
          t.charColor(...tint(fg, i * 3));
          t.cellColor(...tint(bg, i * 3));
        } else {
          t.charColor(fg[i * 3], fg[i * 3 + 1], fg[i * 3 + 2]);
          t.cellColor(bg[i * 3], bg[i * 3 + 1], bg[i * 3 + 2]);
        }
        t.rect(n, 1);
        t.pop();
        c += n;
      }
    }
  }
}

import { hash2 } from './util.js';

// What a cell is made of picks the glyphs it turns into. `ramp` runs sparse to dense and is picked
// by brightness; every cell gets one, even in the dark. `strokes` are laid over the base glyphs on
// a second layer, half a cell off: that second pass is what makes the texture dense. `pattern`,
// when there is one, draws structure (brick courses, cracks in the tarmac) before the ramp.
const MATERIALS = {
  sky: { ramp: " .'`,:;-", strokes: ".`'" },
  cloud: { ramp: ' .-~~==:', strokes: '~-.' },
  wall: { ramp: ' .:;=+#%', strokes: "_,'.", pattern: masonry },
  glass: { ramp: ' .:=+#%@', strokes: "+'." },
  road: { ramp: ' .,-_=;:', strokes: ".,'", pattern: paving },
  snow: { ramp: " .'`,:;*", strokes: "*'." },
  light: { ramp: ' .:*+%##', strokes: '*+.' },
  metal: { ramp: ' .:-=+*#', strokes: "-'." },
  plaster: { ramp: " .':;!", strokes: ".'" },
  leaf: { ramp: ' .,;%&#%', strokes: ",'`\"" },
};
const KINDS = Object.values(MATERIALS);

/** Material ids, for `buf.pen`. */
export const MAT = Object.fromEntries(Object.keys(MATERIALS).map((name, i) => [name, i]));

/** Back buffer of terminal cells; layers write into it, flush() draws it through textmode.js. */
export class CellBuffer {
  cols = 0;
  rows = 0;
  /** 0 at night, 1 in full daylight: lifts the dark backing and the glyph brightness. */
  lift = 0;
  /** Material stamped by put() and by opaque setBg(); layers set it before they draw. */
  pen = MAT.sky;

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.ch = new Array(n).fill(' ');
    this.fg = new Uint8ClampedArray(n * 3);
    this.bg = new Uint8ClampedArray(n * 3);
    this.mat = new Uint8Array(n);
    // the overlay plane: one more glyph per cell, drawn on its own layer
    this.ch2 = new Array(n).fill(' ');
    this.fg2 = new Uint8ClampedArray(n * 3);
  }

  #at(c, r) {
    c = Math.floor(c);
    r = Math.floor(r);
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? -1 : r * this.cols + c;
  }

  setBg(c, r, col, a = 1) {
    const i = this.#at(c, r);
    if (i < 0) return;
    const b = this.bg;
    const k = i * 3;
    if (a >= 0.5) this.mat[i] = this.pen;
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

  /** A whole cell; it also wipes the overlay glyph so solid things stay clean. */
  put(c, r, ch, fg, bg) {
    const i = this.#at(c, r);
    if (i < 0) return;
    const k = i * 3;
    this.ch[i] = ch;
    this.ch2[i] = ' ';
    this.mat[i] = this.pen;
    this.fg[k] = fg[0];
    this.fg[k + 1] = fg[1];
    this.fg[k + 2] = fg[2];
    this.bg[k] = bg[0];
    this.bg[k + 1] = bg[1];
    this.bg[k + 2] = bg[2];
  }

  /** A glyph on the overlay plane, over whatever the base glyph is. */
  over(c, r, ch, col) {
    const i = this.#at(c, r);
    if (i < 0) return;
    const k = i * 3;
    this.ch2[i] = ch;
    this.fg2[k] = col[0];
    this.fg2[k + 1] = col[1];
    this.fg2[k + 2] = col[2];
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
    for (let r = Math.floor(cy - rad); r <= Math.ceil(cy + rad); r++) {
      for (let c = Math.floor(cx - rad); c <= Math.ceil(cx + rad); c++) {
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
   * Turn the painted scene into text: brightness picks glyph density within the cell's material,
   * colour goes to the glyph, the cell itself drops to a near-black backing. Cells that already
   * carry a glyph keep it.
   */
  asciify() {
    const { cols, rows, ch, fg, bg, mat } = this;
    const back = 0.2 + 0.22 * this.lift;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const k = i * 3;
        const R = bg[k];
        const G = bg[k + 1];
        const B = bg[k + 2];
        if (ch[i] === ' ') {
          const kind = KINDS[mat[i]];
          const lum = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
          ch[i] = kind.pattern?.(c, r) ?? pick(kind.ramp, c, r, lum);
          this.#stroke(i, c, r, kind.strokes, lum, R, G, B);
          // brighten the glyph but keep its hue; dark cells get the biggest lift
          const f = Math.min(2.6 - 0.8 * this.lift, (205 + 45 * this.lift) / Math.max(R, G, B, 1));
          fg[k] = R * f;
          fg[k + 1] = G * f;
          fg[k + 2] = B * f;
        }
        bg[k] = R * back;
        bg[k + 1] = G * back;
        bg[k + 2] = B * back;
      }
    }
  }

  /** Overlay glyph: the brighter the cell, the likelier a stroke; tinted a touch lighter than the base. */
  #stroke(i, c, r, strokes, lum, R, G, B) {
    if (hash2(c, r, 131) > 0.22 + 0.4 * Math.min(1, lum * 1.4) - 0.12 * this.lift) {
      this.ch2[i] = ' ';
      return;
    }
    // screened strokes add light, so they stay dim; by day the base glyphs carry the picture
    const f = Math.min(2.4, (150 - 60 * this.lift) / Math.max(R, G, B, 1)) * (0.7 + 0.5 * hash2(c, r, 9));
    this.over(c, r, strokes[Math.floor(hash2(c, r, 57) * strokes.length)], [R * f + 10, G * f + 10, B * f + 12]);
  }

  /** Base plane, merging runs of identical cells into one wide rect. */
  flush(t) {
    const { cols, rows, ch, fg, bg } = this;
    const same = (i, j) =>
      ch[i] === ch[j] &&
      fg[i * 3] === fg[j * 3] && fg[i * 3 + 1] === fg[j * 3 + 1] && fg[i * 3 + 2] === fg[j * 3 + 2] &&
      bg[i * 3] === bg[j * 3] && bg[i * 3 + 1] === bg[j * 3 + 1] && bg[i * 3 + 2] === bg[j * 3 + 2];
    for (let r = 0; r < rows; r++) {
      for (let c = 0, n; c < cols; c += n) {
        const i = r * cols + c;
        n = 1;
        while (c + n < cols && same(i, i + n)) n++;
        this.#cell(t, c, r, n, ch[i], fg, bg, i);
      }
    }
  }

  /** Overlay plane on a black ground; its layer screens it over the base, so black adds nothing. */
  flushOver(t) {
    const { cols, rows, ch2, fg2 } = this;
    // the layer keeps last frame's glyphs unless wiped
    t.background(0, 0, 0);
    for (let i = 0; i < cols * rows; i++) {
      if (ch2[i] !== ' ') this.#cell(t, i % cols, Math.floor(i / cols), 1, ch2[i], fg2, null, i);
    }
  }

  /** `n` cells from (c, r) with glyph `ch`, colours read at index `i`; no `bg` means black. */
  #cell(t, c, r, n, ch, fg, bg, i) {
    const k = i * 3;
    t.push();
    t.translate(c + n / 2 - this.cols / 2, r + 0.5 - this.rows / 2);
    t.char(ch);
    t.charColor(fg[k], fg[k + 1], fg[k + 2]);
    if (bg) t.cellColor(bg[k], bg[k + 1], bg[k + 2]);
    else t.cellColor(0, 0, 0);
    t.rect(n, 1);
    t.pop();
  }
}

function pick(ramp, c, r, lum) {
  const cover = 0.2 + 0.6 * Math.min(1, lum) + (hash2(c, r, 77) - 0.5) * 0.34;
  return ramp[Math.max(1, Math.min(ramp.length - 1, Math.round(cover * (ramp.length - 1))))];
}

/** Courses of brick: a mortar line every third row, staggered joints between. */
function masonry(c, r) {
  if (r % 3 === 0) return hash2(c, r, 3) < 0.8 ? '=' : '-';
  if ((c + (Math.floor(r / 3) % 2) * 2) % 5 === 0) return '|';
  return null;
}

/** Tarmac with the odd crack. */
function paving(c, r) {
  return hash2(c >> 1, r, 8) < 0.06 ? '~' : null;
}

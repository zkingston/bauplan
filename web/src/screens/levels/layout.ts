import { rng } from '../../components/board.ts';

export interface Level {
  n: number;
  title: string;
  state: 'open' | 'solved' | 'locked';
  best?: string;
}

const INKS = ['--blue', '--red', '--yellow', '--blue', '--red', '--ink'];

/** A shape in the composition: its tile, its size in tiles (0 for an obstacle), and its piece. */
export interface Art {
  x: number;
  y: number;
  k: number;
  s: number;
  c: string;
  d: number;
}

interface Panel {
  l: Level;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The panels go from left to right at different heights. All other tiles can contain a shape. */
export function compose(levels: Level[], rows: number, minCols: number, phone = false) {
  const rnd = rng(1919);
  const panels: Panel[] = [];
  // Row 0 stays empty. The last row is next to the drafting line: shapes can be in it, but panels
  // stop before it.
  const end = rows - 1;
  // The tutorial is a square panel before level 1, in the middle of the rows.
  const tutorial = { x: 1, y: Math.floor((end - 1) / 2), w: 2, h: 2 };
  let x = tutorial.x + tutorial.w + 1;
  let prev: { y: number; h: number } = tutorial;
  let last = '';
  for (const l of levels) {
    // A rectangle of 2 to 4 tiles on each side. It is at least 3 tiles across the screen, so that
    // titles and metrics fit on one line (a phone draws the composition transposed). Two neighbor
    // panels never have the same size.
    const side = (min: number) => min + Math.floor(rnd() * (5 - min));
    let w: number, ph: number;
    do [w, ph] = [side(phone ? 2 : 3), side(phone ? 3 : 2)];
    while (`${w}x${ph}` === last);
    last = `${w}x${ph}`;
    // Offsets start at row 1. No edge aligns with an edge of the previous panel, so the panels do
    // not make a column. When there is space, offsets that are 2 or more apart are the first
    // choice.
    const ys = Array.from({ length: Math.max(1, end - ph) }, (_, i) => 1 + i);
    const clear = (y: number) => y !== prev.y && y + ph !== prev.y + prev.h;
    const apart = ys.filter(clear);
    const far = apart.filter((y) => Math.abs(y - prev.y) >= 2);
    const pick = far.length ? far : apart.length ? apart : ys;
    const y = Math.min(pick[Math.floor(rnd() * pick.length)], end - ph);
    const panel = { l, x, y, w, h: ph };
    panels.push(panel);
    prev = panel;
    x += w + 1 + Math.floor(rnd() * 2);
  }
  // After the last level: square panels for the editor and Unlimited (larger), and a narrow one for
  // About.
  // None is in line with the panel before it.
  const mid = Math.floor((end - 1) / 2);
  const after = (w: number, ph: number) => {
    const y = [mid, mid + 1, mid - 1].find((y) => y >= 1 && y + ph <= end && y !== prev.y) ?? mid;
    const p = { x, y, w, h: ph };
    prev = p;
    x += w + 1;
    return p;
  };
  const editor = after(2, 2);
  const unlimited = after(3, 3);
  const about = after(1, 2);
  const cols = Math.max(x + 3, minCols);
  const taken = new Uint8Array(cols * rows);
  const take = (x0: number, y0: number, w: number, hh: number) => {
    for (let y = y0; y < y0 + hh; y++)
      for (let xx = x0; xx < x0 + w; xx++) taken[y * cols + xx] = 1;
  };
  const free = (x0: number, y0: number, w: number, hh: number) => {
    if (x0 + w > cols || y0 + hh > rows) return false;
    for (let y = y0; y < y0 + hh; y++)
      for (let xx = x0; xx < x0 + w; xx++) if (taken[y * cols + xx]) return false;
    return true;
  };
  const all = [...panels, tutorial, editor, unlimited, about];
  for (const p of all) take(p.x, p.y, p.w, p.h);
  const touches = (p: { x: number; y: number; w: number; h: number }, x: number, y: number) =>
    x >= p.x - 1 && x <= p.x + p.w && y >= p.y - 1 && y <= p.y + p.h;
  // A tile that touches a panel is never black, so a black (solved) panel keeps its outline.
  const near = (x: number, y: number) => all.some((p) => touches(p, x, y));
  // A tile next to a colored panel (yellow Tutorial and editor, blue Unlimited, red About) does not
  // have its color.
  const colored = [
    { ...tutorial, c: '--yellow' },
    { ...editor, c: '--yellow' },
    { ...unlimited, c: '--blue' },
    { ...about, c: '--red' },
  ];
  // A shape can grow to 2×2, so all four of its tiles count.
  const clash = (c: string, x: number, y: number) =>
    colored.some(
      (p) => p.c === c && [x, x + 1].some((xx) => [y, y + 1].some((yy) => touches(p, xx, yy))),
    );

  const art: Art[] = [];
  for (let y = 0; y < rows; y++)
    for (let xx = 0; xx < cols; xx++) {
      if (!free(xx, y, 1, 1)) continue;
      const r = rnd();
      const shape = {
        s: Math.floor(rnd() * 8),
        c: INKS[Math.floor(rnd() * INKS.length)],
        d: Math.floor(rnd() * 4),
      };
      if (shape.c === '--ink' && (near(xx, y) || near(xx + 1, y + 1))) shape.c = '--blue';
      if (clash(shape.c, xx, y))
        shape.c = ['--blue', '--red', '--yellow'].find((c) => !clash(c, xx, y)) ?? '--ink';
      if (r < 0.07 && free(xx, y, 2, 2)) {
        take(xx, y, 2, 2);
        art.push({ x: xx, y, k: 2, ...shape });
      } else if (r < 0.1) {
        art.push({ x: xx, y, k: 0, ...shape });
      } else if (r < 0.48) {
        art.push({ x: xx, y, k: 1, ...shape });
      }
    }
  for (const a of art) take(a.x, a.y, a.k || 1, a.k || 1);
  return { cols, panels, tutorial, editor, unlimited, about, art, taken, near };
}

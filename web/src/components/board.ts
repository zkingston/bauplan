import {
  colorOf,
  EMPTY,
  directionOf,
  OBSTACLE,
  shapeOf,
  type Tile,
  type Piece,
} from '@bauplan/engine';
import { h } from '../lib/dom.ts';

/** The value of a CSS variable. Each name is read one time, until the colors change. */
const cssValues = new Map<string, string>();
/** Read the CSS variables again, after a change of the colors. */
export const clearCss = () => cssValues.clear();
export const css = (name: string) => {
  let v = cssValues.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) cssValues.set(name, v);
  }
  return v;
};

export const toTile = (v: number): Tile =>
  v === OBSTACLE
    ? 'obstacle'
    : v === EMPTY
      ? 'empty'
      : { s: shapeOf(v), c: colorOf(v), d: directionOf(v) };
export const toTiles = (g: Uint8Array) => Array.from(g, toTile);

/**
 * The tile (x, y) of a board canvas w tiles wide under a point of the screen. It uses screen
 * coordinates on both sides, so the tile is correct when the page has a zoom.
 */
export function tileUnder(
  c: HTMLCanvasElement,
  w: number,
  e: { clientX: number; clientY: number },
) {
  const r = c.getBoundingClientRect();
  const size = r.width / w;
  return [Math.floor((e.clientX - r.left) / size), Math.floor((e.clientY - r.top) / size)];
}

/** A board with its caption under it. */
export const boardFigure = (cls: string, board: HTMLCanvasElement, caption: string) =>
  h('figure', { class: cls }, board, h('figcaption', {}, caption));

/** The largest multiple of 4, from 20 to 64, that fits `cols` tiles into `width` px. */
export const tileSize = (width: number, cols: number) =>
  Math.max(20, Math.min(64, Math.floor(width / cols / 4) * 4));

/** The width that a stage keeps for the turn triangles and the column gaps (48 px each). */
export const ARROW_ROOM = 2 * 72 + 3 * 48;

/**
 * The tile size that fills a board box. The height is the box height minus the caption under each
 * board. The width is the box width minus `room`, divided between `n` boards side by side. Both
 * also subtract the borders and the shadow edge of each board. Play and the editor give their box
 * the same height, so the boards stay in place when the mode changes.
 */
export function boxTile(box: HTMLElement, w: number, h: number, n: number, room: number) {
  const cap = box.querySelector('figcaption');
  const capH = cap?.offsetHeight
    ? cap.offsetHeight + parseFloat(getComputedStyle(cap).marginTop)
    : 0;
  const byH = (box.clientHeight - capH - 4 - 8) / h;
  const byW = ((box.clientWidth - room) / n - 4 - 8) / w;
  return Math.max(12, Math.floor(Math.min(byH, byW)));
}

/**
 * The shapes in a box from -r to r, with direction up, in profile order S Q T L C D H W. Each shape
 * that is cut from the square stays in the same place. The half-disc keeps the top half of the
 * circle. The wedge keeps the bottom half of the hourglass.
 */
const ROUND = 0.97;
const SHAPES: ((ctx: CanvasRenderingContext2D, r: number) => void)[] = [
  (ctx, r) => ctx.rect(-r, -r, 2 * r, 2 * r),
  (ctx, r) => {
    ctx.moveTo(-r, r);
    ctx.lineTo(-r, -r);
    ctx.arc(-r, r, 2 * r, -Math.PI / 2, 0);
  },
  (ctx, r) => {
    ctx.moveTo(-r, -r);
    ctx.lineTo(-r, r);
    ctx.lineTo(r, r);
  },
  (ctx, r) => {
    ctx.moveTo(-r, -r);
    ctx.arc(-r, r, 2 * r, -Math.PI / 2, 0);
    ctx.arc(r, -r, 2 * r, Math.PI / 2, Math.PI);
  },
  // The circle and half-disc are slightly smaller than the tile, so they do not touch a neighbor.
  (ctx, r) => ctx.arc(0, 0, r * ROUND, 0, 2 * Math.PI),
  (ctx, r) => ctx.arc(0, 0, r * ROUND, Math.PI, 2 * Math.PI),
  (ctx, r) => {
    ctx.moveTo(-r, -r);
    ctx.lineTo(r, -r);
    ctx.lineTo(-r, r);
    ctx.lineTo(r, r);
  },
  (ctx, r) => {
    ctx.moveTo(-r, r);
    ctx.lineTo(0, 0);
    ctx.lineTo(r, r);
  },
];

/** A seeded random number generator, so a drawing is the same every time. */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/**
 * Draw one piece that fills its tile, turned to its direction, with faint brush streaks in the
 * fill. The tile and the state give the random seed, so each redraw is the same.
 */
export function drawPiece(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  t: Piece,
  fill = COLORS[t.c],
  pose: Pose = {},
) {
  const r = size / 2;
  const rnd = rng(Math.imul(x | 0, 7919) ^ Math.imul(y | 0, 104729) ^ (t.s * 97 + t.c * 13 + t.d));
  ctx.save();
  ctx.globalAlpha = pose.alpha ?? 1;
  ctx.translate(x + r + (pose.dx ?? 0), y + r + (pose.dy ?? 0));
  ctx.rotate(((pose.turn ?? t.d) * Math.PI) / 2);
  if (pose.scale !== undefined) ctx.scale(pose.scale, pose.scale);
  ctx.beginPath();
  SHAPES[t.s](ctx, r);
  ctx.closePath();
  ctx.fillStyle = css(fill);
  ctx.fill();
  ctx.clip();
  const tilt = (rnd() - 0.5) * 0.4;
  for (let k = 0; k < 4; k++) {
    const y0 = (rnd() * 2.4 - 1.2) * r;
    ctx.strokeStyle = rnd() < 0.5 ? 'rgb(255 255 255 / 0.03)' : 'rgb(0 0 0 / 0.022)';
    ctx.lineWidth = size * (0.25 + rnd() * 0.35);
    ctx.beginPath();
    ctx.moveTo(-1.3 * r, y0 - tilt * r);
    ctx.lineTo(1.3 * r, y0 + tilt * r + (rnd() - 0.5) * r * 0.3);
    ctx.stroke();
  }
  ctx.restore();
}

const COLORS = ['--blue', '--red', '--yellow'];

/**
 * A piece during a transition: its opacity, its turn in quarter turns, its scale, and its offset
 * from its tile. The tile gives the seed of the brush streaks, so they do not flicker as it moves.
 */
interface Pose {
  alpha?: number;
  turn?: number;
  scale?: number;
  dx?: number;
  dy?: number;
}

const easeIn = (k: number) => k * k;
const easeOut = (k: number) => 1 - (1 - k) ** 3;
export const easeInOut = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);

/**
 * The part that a cut removes: the old piece minus the new one, drawn at the old position so that
 * the streaks align. It is the same in each frame of a step, so it is drawn one time.
 */
const remnants = new Map<string, HTMLCanvasElement>();
function remnant(x: number, y: number, size: number, dpr: number, a: Piece, b: Piece) {
  const key = `${x},${y},${size},${dpr},${a.s}${a.c}${a.d},${b.s}${b.c}${b.d}`;
  let off = remnants.get(key);
  if (off) return off;
  off = document.createElement('canvas');
  off.width = off.height = Math.ceil(size * dpr);
  const o = off.getContext('2d')!;
  o.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
  drawPiece(o, x, y, size, a);
  o.globalCompositeOperation = 'destination-out';
  drawPiece(o, x, y, size, b);
  // A board has few cuts in a step. Keep the cuts of recent steps only.
  if (remnants.size > 200) remnants.clear();
  remnants.set(key, off);
  return off;
}

/**
 * Draw one tile part of the way through a step, with k from 0 to 1, by the change that the rule
 * made. A copy grows from the center of its tile. A cut shows the new shape immediately, and the
 * removed part turns a little, falls, and fades. A turn rotates the full shape by the shorter
 * direction. A recolor moves in from the side of the piece that painted it (at sx, sy). A removed
 * piece becomes smaller and fades. A drawing that goes outside its tile goes to `above`, so that
 * it draws after the other tiles.
 */
function drawTween(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  x: number,
  y: number,
  size: number,
  a: Tile,
  b: Tile,
  k: number,
  sx: number,
  sy: number,
  above: (() => void)[],
) {
  if (b === 'obstacle') return drawObstacle(ctx, x, y, size);
  if (a === 'empty' || a === 'obstacle') {
    if (b === 'empty') return;
    return drawPiece(ctx, x, y, size, b, undefined, { scale: easeOut(k) });
  }
  if (b === 'empty') {
    const q = 1 - easeOut(k);
    return drawPiece(ctx, x, y, size, a, undefined, { scale: 0.4 + 0.6 * q, alpha: q });
  }
  if (a.s !== b.s) {
    drawPiece(ctx, x, y, size, b);
    const off = remnant(x, y, size, dpr, a, b);
    const drop = easeIn(k);
    const s = 1.06 + 0.12 * k;
    above.push(() => {
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.translate(x + size / 2, y + size / 2 + size * 0.9 * drop);
      ctx.rotate(0.35 * drop);
      ctx.scale(s, s);
      ctx.drawImage(off, -size / 2, -size / 2, size, size);
      ctx.restore();
    });
    return;
  }
  if (a.d !== b.d) {
    // The full shape turns, and its corners go over the neighbor tiles.
    const d = ((b.d - a.d + 6) % 4) - 2;
    above.push(() => drawPiece(ctx, x, y, size, b, undefined, { turn: a.d + d * easeInOut(k) }));
    return;
  }
  drawPiece(ctx, x, y, size, a);
  // Start from the side of the piece that paints, or from the back of a piece that paints itself.
  const ang = sx === x && sy === y ? ((b.d - 1) * Math.PI) / 2 : Math.atan2(y - sy, x - sx);
  const R = size * 0.75;
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.rect(-R, -R, 2 * R * easeOut(k), 2 * R);
  ctx.clip();
  ctx.rotate(-ang);
  ctx.translate(-x - size / 2, -y - size / 2);
  drawPiece(ctx, x, y, size, b);
  ctx.restore();
}

export function drawObstacle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  ink = '--ink',
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.strokeStyle = css(ink);
  ctx.lineWidth = Math.max(2, size / 16);
  ctx.beginPath();
  for (let k = -size; k < size; k += size / 4) {
    ctx.moveTo(x + k, y + size);
    ctx.lineTo(x + k + size, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Set the size of a canvas in CSS px for the device pixel ratio, and fill it with `fill`. */
export function prepare(canvas: HTMLCanvasElement, wPx: number, hPx: number, fill = '--paper') {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${wPx}px`;
  canvas.style.height = `${hPx}px`;
  // A new size clears and reallocates the canvas, so change the size only when it is different.
  const W = Math.round(wPx * dpr);
  const H = Math.round(hPx * dpr);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // A canvas keeps its context between draws. Reset it for each draw (the selection uses dashes).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = css(fill);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { ctx, dpr };
}

/** The layer of the tiles that do not change in the current step, for each board canvas. */
const layers = new WeakMap<HTMLCanvasElement, { key: string; layer: HTMLCanvasElement }>();
/** For each board canvas, the board that it shows at rest (empty while a step is in progress). */
const shown = new WeakMap<HTMLCanvasElement, string>();

const same = (a: Tile, b: Tile) =>
  a === b ||
  (typeof a === 'object' && typeof b === 'object' && a.s === b.s && a.c === b.c && a.d === b.d);
const tileKey = (t: Tile) => (typeof t === 'object' ? `${t.s}${t.c}${t.d}` : t[0]);

/** Draw a tile at rest: an obstacle, a piece, or nothing for an empty tile. */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  t: Tile,
) {
  if (t === 'obstacle') drawObstacle(ctx, x, y, size);
  else if (t !== 'empty') drawPiece(ctx, x, y, size, t);
}

/** The top left of tile i of a board w tiles wide, in px. */
const tileAt = (i: number, w: number, size: number): [number, number] => [
  (i % w) * size,
  Math.floor(i / w) * size,
];

const viewOf = (w: number, h: number, size: number, selected: number) => {
  const dpr = window.devicePixelRatio || 1;
  return `${Math.round(w * size * dpr)}x${Math.round(h * size * dpr)}/${w}/${size}/${selected}`;
};
const boardKey = (view: string, ts: Tile[]) => `${view}:${ts.map(tileKey).join(' ')}`;

/** The layer of a step on `canvas`: the tiles that do not change from `from` to `tiles`. */
function stepLayer(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  size: number,
  tiles: Tile[],
  selected: number,
  from: Tile[],
) {
  const dpr = window.devicePixelRatio || 1;
  const px = (n: number) => Math.round(n * size * dpr);
  const view = viewOf(w, h, size, selected);
  const still = (i: number) => same(from[i], tiles[i]);
  const key = `${view}:${tiles.map((t, i) => (still(i) ? tileKey(t) : '?')).join(' ')}`;
  let cached = layers.get(canvas);
  if (cached?.key !== key) {
    const l = cached?.layer ?? document.createElement('canvas');
    const lc = prepare(l, w * size, h * size).ctx;
    // Copy only when tiles fill whole device pixels. A tile that ends inside a pixel shares it with
    // its neighbor, and a copy would keep the old edge of a changed tile in that pixel.
    if (Number.isInteger(size * dpr) && shown.get(canvas) === boardKey(view, from)) {
      lc.drawImage(canvas, 0, 0);
      lc.fillStyle = css('--paper');
      tiles.forEach((_, i) => {
        if (still(i)) return;
        const [x, y] = [i % w, Math.floor(i / w)];
        lc.fillRect(px(x), px(y), px(x + 1) - px(x), px(y + 1) - px(y));
      });
    } else {
      lc.setTransform(dpr, 0, 0, dpr, 0, 0);
      tiles.forEach((t, i) => still(i) && drawTile(lc, ...tileAt(i, w, size), size, t));
    }
    cached = { key, layer: l };
    layers.set(canvas, cached);
  }
  return cached.layer;
}

/**
 * Do the work of the first frame of a step before the step: its layer, and the part that each cut
 * removes. A run calls this between steps, so the step then starts without a slow frame.
 */
export function prepareStep(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  size: number,
  from: Tile[],
  tiles: Tile[],
  selected = -1,
) {
  const dpr = window.devicePixelRatio || 1;
  const made = [stepLayer(canvas, w, h, size, tiles, selected, from)];
  tiles.forEach((b, i) => {
    const a = from[i];
    if (typeof a === 'object' && typeof b === 'object' && a.s !== b.s)
      made.push(remnant(...tileAt(i, w, size), size, dpr, a, b));
  });
  // A canvas keeps its drawing commands and draws them only when it must. Read one pixel of each,
  // so that the drawing occurs now and not in the first frame of the step.
  for (const c of made) c.getContext('2d')!.getImageData(0, 0, 1, 1);
}

/**
 * Draw a w×h grid of tiles on a canvas. With the previous tiles, draw the part k of the step from
 * them. For each tile, `src` gives the tile of the piece whose rule wrote it.
 *
 * In a step, most tiles do not change. They are drawn one time on a layer, and each frame copies
 * the layer and draws only the tiles that change, so a slow device can show the step smoothly.
 * When the canvas already shows the start of the step, the layer is a copy of the canvas.
 */
export function drawBoard(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  size: number,
  tiles: Tile[],
  selected = -1,
  from?: Tile[],
  k = 1,
  src?: Int32Array,
) {
  const dpr = window.devicePixelRatio || 1;
  const view = viewOf(w, h, size, selected);
  const still = (i: number) => !!from && same(from[i], tiles[i]);
  const layer = from && stepLayer(canvas, w, h, size, tiles, selected, from);
  const { ctx } = prepare(canvas, w * size, h * size);
  if (layer) ctx.drawImage(layer, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const above: (() => void)[] = [];
  tiles.forEach((t, i) => {
    if (still(i)) return;
    const [x, y] = tileAt(i, w, size);
    // The tile of the piece whose rule wrote this tile.
    const [sx, sy] = tileAt(src && src[i] >= 0 ? src[i] : i, w, size);
    if (from && k < 1) drawTween(ctx, dpr, x, y, size, from[i], t, k, sx, sy, above);
    else drawTile(ctx, x, y, size, t);
  });
  for (const f of above) f();

  // Draw the grid lines over the pieces in device pixels, so they align with whole pixels.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const lw = Math.max(1, Math.round(dpr));
  ctx.fillStyle = css('--line');
  for (let x = 1; x < w; x++) ctx.fillRect(Math.round(x * size * dpr), 0, lw, canvas.height);
  for (let y = 1; y < h; y++) ctx.fillRect(0, Math.round(y * size * dpr), canvas.width, lw);

  // The selected tile has a blue frame outside it, over the grid lines, as a rule tile with an
  // error has a red one: 3 px of blue, then 1 px of ink next to the tile. At the edge of the board,
  // the frame moves inside the tile.
  if (selected >= 0) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [x, y] = tileAt(selected, w, size);
    const l = Math.max(0, x - 4);
    const t = Math.max(0, y - 4);
    const fw = Math.min(w * size, x + size + 4) - l;
    const fh = Math.min(h * size, y + size + 4) - t;
    ctx.lineWidth = 3;
    ctx.strokeStyle = css('--blue');
    ctx.strokeRect(l + 1.5, t + 1.5, fw - 3, fh - 3);
    ctx.lineWidth = 1;
    ctx.strokeStyle = css('--ink');
    ctx.strokeRect(l + 3.5, t + 3.5, fw - 7, fh - 7);
  }
  // A selection frame on the canvas would be copied into the layer, so then the layer is drawn.
  shown.set(canvas, (from && k < 1) || selected >= 0 ? '' : boardKey(view, tiles));
}

/**
 * A tile of a rule picture: a board tile, `open` for a tile that the condition does not check,
 * `keep` for a tile that the change does not change, or `remove` for a change that removes the
 * piece.
 */
export type PictureTile = Tile | 'open' | 'keep' | 'remove';

/** The mark of a change: a soft equals sign keeps the tile, and a cross removes the piece. */
function drawMark(ctx: CanvasRenderingContext2D, size: number, mark: 'keep' | 'remove') {
  const m = size / 2;
  ctx.strokeStyle = css('--ink');
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (mark === 'keep') {
    const [w, g] = [size * 0.18, size * 0.09];
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = size * 0.07;
    for (const y of [m - g, m + g]) {
      ctx.moveTo(m - w, y);
      ctx.lineTo(m + w, y);
    }
  } else {
    const r = size * 0.2;
    ctx.lineWidth = size * 0.08;
    ctx.moveTo(m - r, m - r);
    ctx.lineTo(m + r, m + r);
    ctx.moveTo(m + r, m - r);
    ctx.lineTo(m - r, m + r);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Draw one tile of a rule picture, or one palette brush, in its own small canvas. A muted brush
 * draws its piece or obstacle in the line color. Brushes outside the palette of the puzzle are
 * muted.
 */
export function drawPictureTile(
  canvas: HTMLCanvasElement,
  size: number,
  tile: PictureTile,
  muted = false,
) {
  const grey = tile === 'open' || tile === 'keep';
  const { ctx, dpr } = prepare(canvas, size, size, grey ? '--line' : '--paper');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (tile === 'obstacle') drawObstacle(ctx, 0, 0, size, muted ? '--line' : undefined);
  else if (tile === 'keep' || tile === 'remove') drawMark(ctx, size, tile);
  else if (typeof tile === 'object') drawPiece(ctx, 0, 0, size, tile, muted ? '--line' : undefined);
}

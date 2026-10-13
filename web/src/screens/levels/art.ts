import { STD2 } from '@bauplan/engine';
import { css, drawObstacle, drawPiece, easeInOut } from '../../components/board.ts';
import type { Art } from './layout.ts';

/**
 * A part of the composition on its own canvas: columns x0 to x1. A large canvas is slow, and some
 * devices cannot show it, so the composition is in parts. A part gets its `ctx` when it is near
 * the view.
 */
export interface Chunk {
  canvas: HTMLCanvasElement;
  ctx?: CanvasRenderingContext2D;
  x0: number;
  x1: number;
}

/** The composition on its canvases. The screen keeps it so that shapes can move on it. */
export interface Scene {
  chunks: Chunk[];
  /** Set the transform of a chunk, so that it draws in composition coordinates. */
  place(ctx: CanvasRenderingContext2D, x0: number): void;
  tile: number;
  cols: number;
  rows: number;
  art: Art[];
  /** The tiles that a panel or a shape uses. */
  taken: Uint8Array;
  near(x: number, y: number): boolean;
}

/** Draw a shape of the composition at its position. */
export function drawArt(ctx: CanvasRenderingContext2D, tile: number, a: Art) {
  if (a.k === 0) drawObstacle(ctx, a.x * tile, a.y * tile, tile);
  else drawPiece(ctx, a.x * tile, a.y * tile, a.k * tile, { s: a.s, c: 0, d: a.d }, a.c);
}

/**
 * Draw tiles x..x+w by y..y+h again on each chunk that has them: the paper, then `draw`, then the
 * grid lines on top. A chunk that is not near the view yet is drawn when it comes into view.
 */
export function paint(
  sc: Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const { tile } = sc;
  for (const c of sc.chunks) {
    const ctx = c.ctx;
    if (!ctx || c.x1 <= x || c.x0 >= x + w) continue;
    sc.place(ctx, c.x0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x * tile, y * tile, w * tile, h * tile);
    ctx.clip();
    ctx.fillStyle = css('--paper');
    ctx.fillRect(x * tile, y * tile, w * tile, h * tile);
    draw(ctx);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = css('--line');
    for (let i = Math.max(1, x); i < x + w; i++) ctx.fillRect(i * tile, y * tile, 1, h * tile);
    for (let j = Math.max(1, y); j < y + h; j++) ctx.fillRect(x * tile, j * tile, w * tile, 1);
    ctx.restore();
  }
}

/**
 * Move one or two single-tile shapes in view one step, as pieces move on a board. A shape that
 * looks different when turned can turn a quarter in place. If it does not turn, it moves into an
 * empty neighbor tile. A shape never moves onto a panel, and a black shape never moves next to a
 * panel. The scene gets the new state immediately. The frames that this function returns draw the
 * move, with k from 0 to 1.
 */
export function stepArt(sc: Scene, left: number, width: number): ((k: number) => void)[] {
  const { tile, cols, rows, art, taken, near } = sc;
  const x0 = Math.floor(left / tile);
  const x1 = Math.ceil((left + width) / tile);
  let pool = art.filter((a) => a.k === 1 && a.x >= x0 && a.x < x1);
  const frames: ((k: number) => void)[] = [];
  for (let n = 1 + Math.floor(Math.random() * 2); n > 0 && pool.length; n--) {
    const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    // Shapes near it do not move this time, so that two moves do not paint over each other.
    pool = pool.filter((b) => Math.abs(b.x - a.x) > 2 || Math.abs(b.y - a.y) > 2);
    const piece = { s: a.s, c: 0, d: a.d };
    if (STD2.periods[a.s] > 1 && Math.random() < 0.5) {
      const d = Math.random() < 0.5 ? 1 : -1;
      const from = a.d;
      a.d = (a.d + d + 4) % 4;
      // The full shape turns, as on a board, and its corners go over the tiles around it. Each
      // frame paints the tiles around it again, then paints the shape on top.
      const around = art.filter(
        (b) =>
          b !== a &&
          b.x <= a.x + 1 &&
          b.x + (b.k || 1) > a.x - 1 &&
          b.y <= a.y + 1 &&
          b.y + (b.k || 1) > a.y - 1,
      );
      frames.push((k) =>
        paint(sc, a.x - 1, a.y - 1, 3, 3, (ctx) => {
          for (const b of around) drawArt(ctx, tile, b);
          drawPiece(ctx, a.x * tile, a.y * tile, tile, piece, a.c, {
            turn: from + d * easeInOut(k),
          });
        }),
      );
      continue;
    }
    const open = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].filter(([dx, dy]) => {
      const nx = a.x + dx;
      const ny = a.y + dy;
      return (
        nx >= 0 &&
        ny >= 0 &&
        nx < cols &&
        ny < rows &&
        !taken[ny * cols + nx] &&
        !(a.c === '--ink' && near(nx, ny))
      );
    });
    if (!open.length) continue;
    const [dx, dy] = open[Math.floor(Math.random() * open.length)];
    const [ox, oy] = [a.x, a.y];
    taken[oy * cols + ox] = 0;
    a.x += dx;
    a.y += dy;
    taken[a.y * cols + a.x] = 1;
    const [rx, ry] = [Math.min(ox, a.x), Math.min(oy, a.y)];
    frames.push((k) =>
      paint(sc, rx, ry, Math.abs(dx) + 1, Math.abs(dy) + 1, (ctx) => {
        const q = easeInOut(k) * tile;
        drawPiece(ctx, ox * tile, oy * tile, tile, piece, a.c, { dx: dx * q, dy: dy * q });
      }),
    );
  }
  return frames;
}

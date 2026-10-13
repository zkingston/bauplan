import { DIRECTIONS, parseToken, rotate, STD2, type Rule } from '@bauplan/engine';
import type { PictureTile } from '../components/board.ts';
import type { Brush } from '../components/palette.ts';

// Boards and rule pictures use tokens: --- open, ... empty, ### obstacle, or a piece such as Wb>.
const OPEN = '--- --- ---';
export const blankRule = (): Rule => ({
  condition: [OPEN, OPEN, OPEN],
  change: [OPEN, OPEN, OPEN],
});
export const isBlank = (r: Rule) => [...r.condition, ...r.change].every((row) => row === OPEN);

export const flat = (rows: string[]) => rows.flatMap((r) => r.split(' '));
export const period = (s: number) => STD2.periods[s];
/**
 * The number of turns in which the center piece of a rule tries the rule: 4 for a square or a
 * circle, 2 for a leaf or an hourglass, and 1 for other pieces and for a blank rule.
 */
export function turnsOf(r: Rule) {
  const s = STD2.shapes.indexOf(flat(r.condition)[4][0]);
  return s < 0 ? 1 : 4 / period(s);
}
export const pieceToken = (s: number, c: number, f: number) =>
  STD2.shapes[s] + STD2.colors[c] + DIRECTIONS[f % period(s)];

const BRUSH_TOKENS: Partial<Record<Brush['kind'], string>> = {
  open: '---',
  empty: '...',
  obstacle: '###',
};
/** The token that brush `b` paints: open, empty, an obstacle, or a piece. A tool paints none. */
export const brushToken = (b: Brush) =>
  b.kind === 'piece' ? pieceToken(b.s, b.c, b.d) : BRUSH_TOKENS[b.kind];

export const tileOf = (t: string): PictureTile =>
  t === '---' ? 'open' : (parseToken(t, STD2) ?? 'empty');

/**
 * The tile that token `t` draws in a rule picture. A change shows open as keep and empty as remove.
 */
export const pictureTile = (t: string, grid: 'condition' | 'change'): PictureTile =>
  grid === 'condition' ? tileOf(t) : t === '---' ? 'keep' : t === '...' ? 'remove' : tileOf(t);

/** The token turned `q` quarters clockwise, if it is a piece with a direction. */
export function turned(t: string, q = 1): string {
  const c = tileOf(t);
  return typeof c === 'object' ? pieceToken(c.s, c.c, c.d + q) : t;
}

/** The new position of tile i when the picture turns `q` quarters clockwise. */
export function moved(i: number, q: number) {
  const [dx, dy] = rotate((i % 3) - 1, ((i / 3) | 0) - 1, q % 4);
  return (dy + 1) * 3 + dx + 1;
}

/** Turn a picture `q` quarters clockwise. Each tile moves around the center and turns. */
export function turnPic(toks: string[], q: number) {
  const out: string[] = [];
  toks.forEach((t, i) => (out[moved(i, q)] = turned(t, q)));
  return out;
}

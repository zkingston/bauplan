import type { Profile } from './profile.ts';

/**
 * A piece as profile indices: its shape, its color, and its direction (0 to 3 = up, right, down,
 * left).
 */
export interface Piece {
  s: number;
  c: number;
  d: number;
}

// Tile values: 0 is empty, 255 is an obstacle, and a piece is 1 + 12*shape + 4*color + direction. A
// tile off the board reads as EDGE. A piece keeps its direction modulo the period of its shape.
// Thus, two pieces that look the same have the same value.
export const EMPTY = 0;
export const OBSTACLE = 255;
export const EDGE = 254;
export const DIRECTIONS = '^>v<';
export const piece = (s: number, c: number, d: number) => 1 + 12 * s + 4 * c + d;
export const isPiece = (v: number) => v !== EMPTY && v !== OBSTACLE && v !== EDGE;
export const shapeOf = (v: number) => ((v - 1) / 12) | 0;
export const colorOf = (v: number) => (((v - 1) % 12) / 4) | 0;
export const directionOf = (v: number) => (v - 1) % 4;

/** A tile as a token gives it: empty, an obstacle, or a piece. */
export type Tile = 'obstacle' | 'empty' | Piece;

/** Parse a board token. A piece must use a direction that its shape has. */
export function parseToken(tok: string, prof: Profile): Tile | null {
  if (tok === '...') return 'empty';
  if (tok === '###') return 'obstacle';
  if (tok.length !== 3) return null;
  const s = prof.shapes.indexOf(tok[0]);
  const c = prof.colors.indexOf(tok[1]);
  const d = DIRECTIONS.indexOf(tok[2]);
  return s < 0 || c < 0 || d < 0 || d >= prof.periods[s] ? null : { s, c, d };
}

export const tileValue = (t: Tile) =>
  t === 'empty' ? EMPTY : t === 'obstacle' ? OBSTACLE : piece(t.s, t.c, t.d);

export function tileToken(v: number, prof: Profile): string {
  if (v === OBSTACLE) return '###';
  if (v === EMPTY) return '...';
  return prof.shapes[shapeOf(v)] + prof.colors[colorOf(v)] + DIRECTIONS[directionOf(v)];
}

/** Tokens in rows of `w`, with spaces between them. The default is 3, for a rule picture. */
export const rowsOf = (tokens: string[], w = 3) =>
  Array.from({ length: tokens.length / w }, (_, y) => tokens.slice(y * w, (y + 1) * w).join(' '));

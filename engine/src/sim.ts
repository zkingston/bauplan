import {
  colorOf,
  EDGE,
  EMPTY,
  directionOf,
  isPiece,
  OBSTACLE,
  piece,
  shapeOf,
  type Piece,
} from './tile.ts';
import type { Profile } from './profile.ts';
import { parseGrid, profileOf, sameGrid, type Puzzle } from './puzzle.ts';
import {
  CENTER,
  tiles,
  parseChange,
  parseCondition,
  type ChangeTile,
  type ConditionTile,
  type Rule,
} from './rules.ts';

/** A run that does not settle or loop stops at this step. Puzzles do not set their own limit. */
export const STEP_LIMIT = 100;

export type Outcome =
  | { kind: 'win'; steps: number }
  | { kind: 'wrong'; steps: number }
  | { kind: 'loop'; steps: number }
  | { kind: 'limit' };

/**
 * Rotate a frame offset (dx to the right, dy behind) onto the board, for a frame with direction d
 * (0 to 3 = up, right, down, left).
 */
export function rotate(dx: number, dy: number, d: number): [number, number] {
  return d === 0 ? [dx, dy] : d === 1 ? [-dy, dx] : d === 2 ? [-dx, -dy] : [dy, -dx];
}

interface CRule {
  s: number;
  c: number;
  turn: number;
  condition: { dx: number; dy: number; tile: ConditionTile }[];
  /** The changes. `open` is true if the condition picture has an open tile there. */
  change: { dx: number; dy: number; tile: ChangeTile; open: boolean }[];
}

function compile(prof: Profile, rules: Rule[]): CRule[] {
  return rules.map((r) => {
    const condition = tiles(r.condition)!.map((t) => parseCondition(t, prof)!);
    const change = tiles(r.change)!.map((t) => parseChange(t, prof)!);
    const at = (i: number) => ({ dx: (i % 3) - 1, dy: ((i / 3) | 0) - 1 });
    const center = condition[CENTER] as { s: number; c: number };
    return {
      s: center.s,
      c: center.c,
      turn: r.turn ?? 0,
      condition: condition.flatMap((tile, i) =>
        i === CENTER || tile.kind === 'any' ? [] : [{ ...at(i), tile }],
      ),
      change: change.flatMap((tile, i) =>
        tile.kind === 'keep' ? [] : [{ ...at(i), tile, open: condition[i].kind === 'any' }],
      ),
    };
  });
}

/** The board value of a picture's piece in a frame. */
const onBoard = (prof: Profile, tile: Piece, frame: number) =>
  piece(tile.s, tile.c, ((frame + tile.d) % 4) % prof.periods[tile.s]);

function matchCondition(prof: Profile, tile: ConditionTile, v: number, frame: number): boolean {
  switch (tile.kind) {
    case 'any':
      return true;
    case 'empty':
      return v === EMPTY;
    case 'obstacle':
      return v === OBSTACLE;
  }
  return v === onBoard(prof, tile, frame);
}

const written = (prof: Profile, tile: ChangeTile, frame: number) =>
  tile.kind === 'piece' ? onBoard(prof, tile, frame) : EMPTY;

type Writes = [tile: number, value: number][];

/**
 * The tiles that a rule changes from center piece i in one frame, or null if its condition does
 * not match.
 */
function tryFrame(
  prof: Profile,
  w: number,
  h: number,
  g: Uint8Array,
  r: CRule,
  i: number,
  frame: number,
): Writes | null {
  const x = i % w;
  const y = (i / w) | 0;
  const index = (dx: number, dy: number) => {
    const [ox, oy] = rotate(dx, dy, frame);
    const xx = x + ox;
    const yy = y + oy;
    return xx < 0 || yy < 0 || xx >= w || yy >= h ? -1 : yy * w + xx;
  };
  for (const { dx, dy, tile } of r.condition) {
    const j = index(dx, dy);
    if (!matchCondition(prof, tile, j < 0 ? EDGE : g[j], frame)) return null;
  }
  const out: Writes = [];
  for (const { dx, dy, tile, open } of r.change) {
    const j = index(dx, dy);
    // A rule cannot change a tile off the board or an obstacle. An open tile takes a new piece only
    // if it is empty. A rule can empty an open tile only if the tile holds a piece.
    if (j < 0 || g[j] === OBSTACLE) return null;
    if (open && (tile.kind === 'piece' ? g[j] !== EMPTY : !isPiece(g[j]))) return null;
    const v = written(prof, tile, frame);
    if (v !== g[j]) out.push([j, v]);
  }
  return out;
}

interface App {
  center: number;
  rule: number;
  frame: number;
  writes: Writes;
}

/**
 * The frames in which a piece reads a rule, in order. These are all the turns that keep the look of
 * the piece. They start at the rule's `turn` (as the player sees it), then the opposite turn, then
 * the two sides. With no turn, a square or circle tries up, down, right, then left. A leaf or an
 * hourglass tries its direction, then the opposite. All other pieces try only their direction,
 * with any turn.
 */
function frames(period: number, direction: number, turn = 0): number[] {
  return [0, 2, 1, 3].map((d) => (turn + d) % 4).filter((d) => (d - direction + 4) % period === 0);
}

/**
 * Find the first rule that can fire for each piece. The piece tries each rule in its frames, in
 * order. Only that one application occurs, so a square makes one copy in a step, not four.
 */
function select(prof: Profile, w: number, h: number, g: Uint8Array, rules: CRule[]): App[] {
  const apps: App[] = [];
  for (let i = 0; i < g.length; i++) {
    if (!isPiece(g[i])) continue;
    const s = shapeOf(g[i]);
    const c = colorOf(g[i]);
    const d = directionOf(g[i]);
    search: for (let r = 0; r < rules.length; r++) {
      const rule = rules[r];
      if (rule.s !== s || rule.c !== c) continue;
      for (const frame of frames(prof.periods[s], d, rule.turn)) {
        const writes = tryFrame(prof, w, h, g, rule, i, frame);
        if (writes?.length) {
          apps.push({ center: i, rule: r, frame, writes });
          break search;
        }
      }
    }
  }
  return apps;
}

/**
 * A tile that gets two different values is contested. A rule application that changes a contested
 * tile does nothing. All other applications make all their changes. `source` gives, for each
 * changed tile, the center piece whose rule changed it (-1 if no rule changed it).
 */
function resolve(g: Uint8Array, apps: App[]) {
  const value = new Int16Array(g.length).fill(-1);
  const contested = new Uint8Array(g.length);
  for (const a of apps)
    for (const [j, v] of a.writes) {
      if (value[j] < 0) value[j] = v;
      else if (value[j] !== v) contested[j] = 1;
    }
  const next = g.slice();
  const fired = new Int16Array(g.length).fill(-1);
  const blocked = new Uint8Array(g.length);
  const source = new Int32Array(g.length).fill(-1);
  for (const a of apps) {
    if (a.writes.some(([j]) => contested[j])) {
      blocked[a.center] = 1;
      continue;
    }
    for (const [j, v] of a.writes) {
      next[j] = v;
      if (source[j] < 0) source[j] = a.center;
    }
    fired[a.center] = a.rule;
  }
  return { next, fired, blocked, source };
}

/**
 * The step function of a rule list, for a w×h grid of any size. A tile off the grid reads as EDGE,
 * as on a puzzle board. `source` gives, for each changed tile, the piece whose rule changed it.
 */
export function stepper(prof: Profile, rules: Rule[]) {
  const cr = compile(prof, rules);
  return (g: Uint8Array, w: number, h: number) => resolve(g, select(prof, w, h, g, cr));
}

export function step(
  p: Puzzle,
  g: Uint8Array,
  rules: Rule[],
): { next: Uint8Array; fired: Int16Array } {
  const { next, fired } = stepper(profileOf(p), rules)(g, p.w, p.h);
  return { next, fired };
}

const key = (g: Uint8Array) => String.fromCharCode(...g);

/**
 * `history` holds each different state of the run, starting with the start board. sources[k]
 * describes the step from history[k] to history[k + 1]: the piece that changed each tile. Neither
 * includes the repeat at a fixed point or the state that closes a loop.
 */
export function run(
  p: Puzzle,
  rules: Rule[],
): { outcome: Outcome; history: Uint8Array[]; sources: Int32Array[] } {
  const next = stepper(profileOf(p), rules);
  const target = parseGrid(p, p.target);
  let g = parseGrid(p);
  const history = [g];
  const sources: Int32Array[] = [];
  const seen = new Set([key(g)]);
  for (let t = 0; t <= STEP_LIMIT; t++) {
    const s = next(g, p.w, p.h);
    if (s.fired.every((r) => r < 0)) {
      // No rule changed a tile, so the state did not change. This is a fixed point.
      const kind = sameGrid(g, target) ? 'win' : 'wrong';
      return { outcome: { kind, steps: t }, history, sources };
    }
    const k = key(s.next);
    if (seen.has(k)) return { outcome: { kind: 'loop', steps: t + 1 }, history, sources };
    seen.add(k);
    history.push(s.next);
    sources.push(s.source);
    g = s.next;
  }
  return { outcome: { kind: 'limit' }, history, sources };
}

/**
 * What happens to a piece in the step from state g: the rule that it uses (-1 for none), the frame
 * of that rule, and whether a contested tile blocks it.
 */
export function explain(
  p: Puzzle,
  g: Uint8Array,
  rules: Rule[],
  tile: number,
): { rule: number; frame: number; blocked: boolean } {
  const prof = profileOf(p);
  const apps = select(prof, p.w, p.h, g, compile(prof, rules));
  const mine = apps.find((a) => a.center === tile);
  return {
    rule: mine?.rule ?? -1,
    frame: mine?.frame ?? -1,
    blocked: resolve(g, apps).blocked[tile] === 1,
  };
}

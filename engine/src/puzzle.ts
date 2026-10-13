import { tileValue, tileToken, parseToken, rowsOf, type Tile } from './tile.ts';
import { getProfile, type Profile } from './profile.ts';
import { upgradeRules, type Rule } from './rules.ts';

export interface ValidationError {
  path: string;
  message: string;
}

export interface Limits {
  rules: number;
  /** The maximum number of condition tiles in a rule. The center tile does not count. */
  conds: number;
}

export interface Palette {
  shapes: string[];
  colors: string[];
  /** If this is absent, the palette has all of the profile's tools. */
  tools?: string[];
}

export interface Puzzle {
  v: 3;
  profile: string;
  title?: string;
  author?: string;
  w: number;
  h: number;
  start: string[];
  target: string[];
  limits: Limits;
  palette: Palette;
  hint?: string;
  /** A rule list that wins. The code that plays it must check it; `parsePuzzle` does not. */
  solution?: Rule[];
}

export const PALETTE_KEYS = ['shapes', 'colors', 'tools'] as const;

/** Whether a palette has a tool. A palette with no tool list has all the tools. */
export const hasTool = (pal: Palette, tool: string) => pal.tools?.includes(tool) ?? true;

export function profileOf(p: Puzzle): Profile {
  const prof = getProfile(p.profile);
  if (!prof) throw new Error(`unknown profile ${p.profile}`);
  return prof;
}

export function parseGrid(p: Puzzle, rows: string[] = p.start): Uint8Array {
  const prof = profileOf(p);
  return Uint8Array.from(
    rows.flatMap((r) => r.split(' ')),
    (tok) => {
      const t = parseToken(tok, prof);
      if (t === null) throw new Error(`bad grid token ${tok}`);
      return tileValue(t);
    },
  );
}

export function formatGrid(p: Puzzle, g: Uint8Array): string[] {
  const prof = profileOf(p);
  return rowsOf(
    Array.from(g, (v) => tileToken(v, prof)),
    p.w,
  );
}

export const sameGrid = (a: Uint8Array, b: Uint8Array) => a.every((v, i) => v === b[i]);

const TOP_KEYS = [
  'v',
  'profile',
  'title',
  'author',
  'w',
  'h',
  'start',
  'target',
  'limits',
  'palette',
  'hint',
  'solution',
];
export const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown, lo: number, hi: number): x is number =>
  Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;

/**
 * Change a puzzle in the format from before the terminology change to the current format. The
 * old format has `seed` for `start`, and rules with `pre` and `post` for `condition` and `change`.
 */
function upgradePuzzle(json: Record<string, unknown>): Record<string, unknown> {
  const { seed, ...rest } = json;
  return {
    ...rest,
    ...(rest.start === undefined && seed !== undefined && { start: seed }),
    ...(rest.solution !== undefined && { solution: upgradeRules(rest.solution) }),
  };
}

export function parsePuzzle(input: unknown): Puzzle | ValidationError[] {
  const errs: ValidationError[] = [];
  const err = (path: string, message: string) => errs.push({ path, message });
  if (!isObj(input)) return [{ path: '', message: 'puzzle must be an object' }];
  const json = upgradePuzzle(input);
  for (const k of Object.keys(json)) if (!TOP_KEYS.includes(k)) err(k, 'unknown field');
  if (json.v !== 3) err('v', 'must be 3');
  const prof = typeof json.profile === 'string' ? getProfile(json.profile) : undefined;
  if (!prof) return [...errs, { path: 'profile', message: 'unknown profile' }];

  for (const k of ['title', 'author'] as const) {
    const s = json[k];
    if (s !== undefined && (typeof s !== 'string' || [...s].length > 40))
      err(k, 'must be a string of at most 40 characters');
  }
  const { w, h } = json;
  if (!isInt(w, 1, prof.maxSize)) err('w', `must be an integer from 1 to ${prof.maxSize}`);
  if (!isInt(h, 1, prof.maxSize)) err('h', `must be an integer from 1 to ${prof.maxSize}`);

  const limits = json.limits;
  const keys = isObj(limits) ? Object.keys(limits).sort().join() : '';
  if (!isObj(limits) || keys !== 'conds,rules') err('limits', 'must have exactly rules and conds');
  else {
    if (!isInt(limits.rules, 1, prof.maxRules))
      err('limits.rules', `must be 1 to ${prof.maxRules}`);
    if (!isInt(limits.conds, 0, prof.maxConds))
      err('limits.conds', `must be 0 to ${prof.maxConds}`);
  }

  const palette = {} as Palette;
  const pal = json.palette ?? {};
  if (!isObj(pal)) err('palette', 'must be an object');
  else {
    for (const k of Object.keys(pal))
      if (!(PALETTE_KEYS as readonly string[]).includes(k)) err(`palette.${k}`, 'unknown field');
    for (const k of PALETTE_KEYS) {
      const list = pal[k] ?? prof[k];
      if (!Array.isArray(list) || list.some((t) => !prof[k].includes(t)))
        err(`palette.${k}`, `must be a subset of ${prof[k].join(', ')}`);
      else if (new Set(list).size !== list.length) err(`palette.${k}`, 'has duplicates');
      else palette[k] = prof[k].filter((t) => list.includes(t));
    }
  }
  if (json.hint !== undefined && (typeof json.hint !== 'string' || [...json.hint].length > 200))
    err('hint', 'must be a string of at most 200 characters');
  if (json.solution !== undefined && !Array.isArray(json.solution))
    err('solution', 'must be a list of rules');

  if (errs.length) return errs;
  const W = w as number;
  const H = h as number;

  const grids: Partial<Record<'start' | 'target', Tile[]>> = {};
  for (const k of ['start', 'target'] as const) {
    const rows = json[k];
    if (!Array.isArray(rows) || rows.length !== H) {
      err(k, `must be ${H} rows`);
      continue;
    }
    const tiles: Tile[] = [];
    rows.forEach((row, y) => {
      const toks = typeof row === 'string' ? row.split(' ') : [];
      if (toks.length !== W)
        return err(`${k}[${y}]`, `must be ${W} tokens separated by single spaces`);
      toks.forEach((tok, x) => {
        const t = parseToken(tok, prof);
        if (t === null) return err(`${k}[${y}]`, `bad token ${JSON.stringify(tok)} at column ${x}`);
        tiles.push(t);
      });
    });
    grids[k] = tiles;
  }
  if (errs.length) return errs;

  const start = grids.start!;
  const target = grids.target!;
  start.forEach((s, i) => {
    if ((s === 'obstacle') !== (target[i] === 'obstacle'))
      err('target', `obstacles must coincide with the start's (tile ${i})`);
  });
  if (errs.length) return errs;

  const p: Puzzle = {
    v: 3,
    profile: prof.id,
    ...(json.title !== undefined && { title: json.title as string }),
    ...(json.author !== undefined && { author: json.author as string }),
    w: W,
    h: H,
    start: [...(json.start as string[])],
    target: [...(json.target as string[])],
    limits: { ...(limits as unknown as Limits) },
    palette,
    ...(json.hint !== undefined && { hint: json.hint as string }),
    ...(json.solution !== undefined && { solution: json.solution as Rule[] }),
  };
  if (start.every((c, i) => tileValue(c) === tileValue(target[i])))
    return [{ path: 'start', message: 'start already matches target' }];
  return p;
}

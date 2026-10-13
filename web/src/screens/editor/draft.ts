import {
  canonicalRules,
  parsePuzzle,
  parseToken,
  rowsOf,
  run,
  STD2,
  upgradeRules,
  validateRules,
  type Puzzle,
  type Rule,
} from '@bauplan/engine';
import { loadEditor, saveEditor } from '../../lib/store.ts';

/** The working copy of the editor: puzzle fields, with flat token grids. */
export interface Draft {
  title: string;
  author: string;
  w: number;
  h: number;
  start: string[];
  target: string[];
  hint?: string;
  /** The rules that won TEST last. Each edit removes them. */
  solution?: Rule[];
}

/** The limits of the levels, also for editor puzzles: 12 rules, two conditions for each rule. */
const LEVEL_LIMITS = { rules: 12, conds: 2 };

/** An editor puzzle plays as a level: all shapes and colors, with the limits of the levels. */
export const FULL = {
  limits: LEVEL_LIMITS,
  palette: { shapes: [...STD2.shapes], colors: [...STD2.colors] },
};

export const blank = (): Draft => ({
  title: '',
  author: '',
  w: 5,
  h: 5,
  start: Array(25).fill('...'),
  target: Array(25).fill('...'),
});

export const draftJson = (d: Draft) => ({
  v: 3,
  profile: 'std2',
  ...(d.title && { title: d.title }),
  ...(d.author && { author: d.author }),
  w: d.w,
  h: d.h,
  start: rowsOf(d.start, d.w),
  target: rowsOf(d.target, d.w),
  ...FULL,
  ...(d.hint && { hint: d.hint }),
  ...(d.solution && { solution: d.solution }),
});

/**
 * A draft from saved or imported JSON. During an edit, a draft can be an invalid puzzle (for
 * example, the start is equal to the target). This function checks only the structure. Unknown
 * tokens become empty tiles. Old JSON with `seed` and `pre`/`post` keys also loads.
 */
export function toDraft(j: Record<string, unknown>): Draft | undefined {
  const { w, h } = j;
  const size = (n: unknown): n is number =>
    Number.isInteger(n) && (n as number) >= 1 && (n as number) <= STD2.maxSize;
  if (!size(w) || !size(h)) return undefined;
  const grid = (r: unknown) =>
    Array.isArray(r) &&
    r.length === h &&
    r.every((s) => typeof s === 'string' && s.split(' ').length === w)
      ? (r as string[]).flatMap((s) => s.split(' ')).map((t) => (parseToken(t, STD2) ? t : '...'))
      : undefined;
  const start = grid(j.start ?? j.seed);
  const target = grid(j.target);
  if (!start || !target) return undefined;
  return {
    title: typeof j.title === 'string' ? j.title : '',
    author: typeof j.author === 'string' ? j.author : '',
    w,
    h,
    start,
    target,
    ...(typeof j.hint === 'string' && { hint: j.hint }),
    ...(Array.isArray(j.solution) && { solution: upgradeRules(j.solution) as Rule[] }),
  };
}

/** True if the solution in a puzzle is valid and wins. */
export const solves = (p: Puzzle) =>
  !!p.solution && !validateRules(p, p.solution).length && run(p, p.solution).outcome.kind === 'win';

export function editorPuzzle(): Puzzle | undefined {
  // Use a draft, so that a puzzle saved with older limits plays with the limits of the levels.
  const s = loadEditor();
  const d = s && toDraft(s.puzzle);
  const p = d && parsePuzzle(draftJson(d));
  return p && !Array.isArray(p) ? p : undefined;
}

export function markVerified(rules: Rule[]) {
  const s = loadEditor();
  if (s) saveEditor({ puzzle: { ...s.puzzle, solution: canonicalRules(rules) }, verified: true });
}

/**
 * Replace the editor draft with an imported or saved puzzle. A solution that wins verifies the
 * puzzle. A solution that does not win is removed.
 */
export function loadIntoEditor(puzzle: Record<string, unknown>) {
  const d = toDraft(puzzle);
  const p = d && parsePuzzle(draftJson(d));
  const verified = !!p && !Array.isArray(p) && solves(p);
  if (d && !verified) delete d.solution;
  saveEditor({ puzzle: d ? draftJson(d) : puzzle, verified });
}

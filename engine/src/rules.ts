import { parseToken, rowsOf, type Piece } from './tile.ts';
import { canCut, type Profile } from './profile.ts';
import { hasTool, profileOf, type Puzzle, type ValidationError } from './puzzle.ts';

/**
 * A rule is two 3x3 pictures in the frame of the center piece. The center piece has direction up.
 * Row 0 is the row ahead of it. Each row is three tokens, with spaces between them.
 *
 * condition: --- any tile   ... empty   ### obstacle   or a piece such as Cb^, its direction
 *            relative to the center piece. The center is a piece with direction ^.
 * change:    --- unchanged   ... removes the piece there   or a piece to put there.
 *
 * A change on an open tile of the condition needs an empty tile (to copy a piece) or a piece (to
 * remove it). If a change cannot occur, the rule does not fire. A piece copies only its own shape,
 * and a rule adds one new piece at most. A shape changes only with a cut, so new shapes come from
 * cuts.
 *
 * turn: 0 to 3 quarter turns clockwise, 0 if absent. The player sees the rule turned this far. A
 * piece that looks the same when turned tries the rule as the player sees it first (see `frames`).
 */
export interface Rule {
  condition: string[];
  change: string[];
  turn?: number;
}

export type ConditionTile =
  { kind: 'any' } | { kind: 'empty' } | { kind: 'obstacle' } | ({ kind: 'piece' } & Piece);
export type ChangeTile = { kind: 'keep' } | { kind: 'empty' } | ({ kind: 'piece' } & Piece);

/** Parse a token of a condition picture. `---` matches any tile. */
export function parseCondition(tok: string, prof: Profile): ConditionTile | null {
  if (tok === '---') return { kind: 'any' };
  const t = parseToken(tok, prof);
  return t === null ? null : typeof t === 'object' ? { kind: 'piece', ...t } : { kind: t };
}

/** Parse a token of a change picture. `---` keeps the tile, and an obstacle is not allowed. */
export function parseChange(tok: string, prof: Profile): ChangeTile | null {
  if (tok === '---') return { kind: 'keep' };
  // The other tokens read as in a condition: empty, a piece, or an obstacle.
  const t = parseCondition(tok, prof);
  return t?.kind === 'obstacle' ? null : (t as ChangeTile | null);
}

/** The 3x3 tiles of a rule picture in row-major order, or null if the picture has a bad shape. */
export function tiles(rows: unknown): string[] | null {
  if (!Array.isArray(rows) || rows.length !== 3) return null;
  const out = rows.flatMap((r) => (typeof r === 'string' ? r.split(' ') : []));
  return out.length === 9 ? out : null;
}

export const CENTER = 4;

/**
 * Why piece a cannot change into a different piece b with one action, or null if it can. The
 * action is a new color, a quarter turn, or a cut to a child shape with the same color and
 * direction. A cut keeps the direction only as far as the symmetry of the old shape allows. A
 * square has no direction, so a cut can give a quarter circle with any direction. A cut of a leaf
 * or an hourglass can give a shape with its direction or the opposite direction. Directions are
 * relative, as in a rule picture.
 */
function actionError(prof: Profile, a: Piece, b: Piece): string | null {
  if (a.s === b.s && a.d === b.d) return null;
  if (a.s === b.s) {
    if (a.c !== b.c) return 'a piece cannot both turn and recolor';
    // Directions are below the period of their shape, so only a shape with four can turn a half.
    return (b.d - a.d + 4) % 4 === 2 ? 'a piece can only turn a quarter' : null;
  }
  if (!canCut(prof, a.s, b.s)) return `${prof.shapes[a.s]} cannot be cut into ${prof.shapes[b.s]}`;
  if (a.c !== b.c) return 'a piece cannot both cut and recolor';
  for (let k = 0; k < 4; k += prof.periods[a.s])
    if ((a.d + k) % prof.periods[b.s] === b.d) return null;
  return 'a piece cannot both cut and turn';
}

/**
 * Make a rule from its center piece in the condition and the change, and from other tiles by
 * row-major index around it (1 is the tile ahead). All other tiles are open.
 */
export function rule(
  center: string,
  centerAfter: string,
  condition: Record<number, string> = {},
  change: Record<number, string> = {},
): Rule {
  const picture = (center: string, at: Record<number, string>) => {
    const g = Array<string>(9).fill('---');
    g[CENTER] = center;
    for (const [i, t] of Object.entries(at)) g[+i] = t;
    return rowsOf(g);
  };
  return { condition: picture(center, condition), change: picture(centerAfter, change) };
}

/**
 * Change rules in the format from before the terminology change: `pre` and `post` become
 * `condition` and `change`. Other values do not change.
 */
export function upgradeRules(rules: unknown): unknown {
  if (!Array.isArray(rules)) return rules;
  return rules.map((r) => {
    if (typeof r !== 'object' || r === null || !('pre' in r || 'post' in r)) return r;
    const { pre, post, ...rest } = r as Record<string, unknown>;
    return { condition: pre, change: post, ...rest };
  });
}

/** The number of condition tiles around the center piece. */
export const condCount = (r: Rule) =>
  (tiles(r.condition) ?? []).filter((t, i) => i !== CENTER && t !== '---').length;

export function validateRules(p: Puzzle, rules: Rule[]): ValidationError[] {
  const prof = profileOf(p);
  const pal = p.palette;
  const errs: ValidationError[] = [];
  if (!Array.isArray(rules)) return [{ path: 'rules', message: 'must be a list' }];
  if (rules.length > p.limits.rules)
    errs.push({ path: 'rules', message: `at most ${p.limits.rules} rules` });

  rules.forEach((rule, k) => {
    const err = (path: string, message: string) =>
      errs.push({ path: `rules[${k}]${path}`, message });
    const condition = tiles(rule?.condition);
    const change = tiles(rule?.change);
    if (!condition || !change)
      return err('', 'must be {condition, change}, each 3 rows of 3 tiles');
    if (rule.turn !== undefined && ![0, 1, 2, 3].includes(rule.turn))
      err('.turn', 'turn must be 0 to 3');
    const at = (g: 'condition' | 'change', i: number) => `.${g}[${(i / 3) | 0}][${i % 3}]`;
    const inPalette = (path: string, c: { s: number; c: number }) => {
      if (!pal.shapes.includes(prof.shapes[c.s]))
        err(path, `${prof.shapes[c.s]} is not in this puzzle's palette`);
      if (!pal.colors.includes(prof.colors[c.c]))
        err(path, `${prof.colors[c.c]} is not in this puzzle's palette`);
    };

    const conds = condition.map((t, i) => {
      const c = parseCondition(t, prof);
      if (!c) err(at('condition', i), `unknown tile ${JSON.stringify(t)}`);
      else if (c.kind === 'piece') inPalette(at('condition', i), c);
      else if (c.kind === 'obstacle' && !hasTool(pal, 'obstacle'))
        err(at('condition', i), "obstacles are not in this puzzle's palette");
      return c;
    });
    const center = conds[CENTER];
    if (center && (center.kind !== 'piece' || center.d !== 0))
      err(at('condition', CENTER), 'the center must be a piece with direction up');

    let writes = 0;
    change.forEach((t, i) => {
      const c = parseChange(t, prof);
      const path = at('change', i);
      if (t === '---') return;
      // A rule does one action: it changes one tile in one way.
      if (++writes > 1) return err(path, 'a rule can only change one tile');
      if (!c) return err(path, `unknown tile ${JSON.stringify(t)}`);
      if (c.kind === 'keep') return;
      const below = conds[i];
      if (!below) return;
      if (below.kind === 'obstacle') return err(path, 'obstacles cannot change');
      // A rule changes only its own piece. In the tiles around it, it can only copy the piece into
      // an empty tile.
      const neighbor = i !== CENTER;
      if (c.kind === 'empty') {
        if (below.kind === 'empty') err(path, 'there is no piece here to remove');
        else if (neighbor) err(path, 'a piece cannot remove other pieces');
        return;
      }
      if (neighbor && below.kind === 'piece')
        return err(path, 'a piece cannot change other pieces');
      inPalette(path, c);
      if (below.kind !== 'piece') {
        // A copy has the same shape, color, and direction as its piece.
        if (center?.kind !== 'piece') return;
        const also = c.s !== center.s ? 'cut' : c.c !== center.c ? 'recolor' : c.d ? 'turn' : '';
        if (also) err(path, `a piece cannot both copy and ${also}`);
        return;
      }
      if (below.s === c.s && below.c === c.c && below.d === c.d)
        return err(path, 'the piece does not change');
      const why = actionError(prof, below, c);
      if (why) err(path, why);
    });
    if (!writes) err('', 'this rule has no change');
    if (condCount(rule) > p.limits.conds)
      err(
        '',
        p.limits.conds
          ? `only ${p.limits.conds} condition${p.limits.conds === 1 ? '' : 's'} per rule`
          : 'no conditions allowed',
      );
  });
  return errs;
}

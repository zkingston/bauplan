import { canCut, STD2 } from '../src/profile.ts';
import { EMPTY, DIRECTIONS, OBSTACLE, piece, rowsOf, tileToken } from '../src/tile.ts';
import { formatGrid, type Puzzle } from '../src/puzzle.ts';
import { CENTER, type Rule } from '../src/rules.ts';

/** mulberry32: a small seeded PRNG, so that the tests give the same result each time. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]) => xs[int(xs.length)];
  return { next, int, pick };
}
type Rng = ReturnType<typeof rng>;

/**
 * Run `check` with n seeds from a fixed sequence. A failure names its seed, so that the case can
 * run again alone. An async check runs one seed at a time.
 */
export async function forSeeds(n: number, check: (seed: number) => void | Promise<void>) {
  const r = rng(n);
  for (let k = 0; k < n; k++) {
    const seed = r.int(2 ** 31);
    try {
      await check(seed);
    } catch (e) {
      if (e instanceof Error) e.message = `seed ${seed}: ${e.message}`;
      throw e;
    }
  }
}

/** A minimal puzzle to use with step(). Its start and target are placeholders. */
export function shell(w: number, h: number): Puzzle {
  const row = Array(w).fill('***').join(' ');
  return {
    v: 3,
    profile: 'std2',
    w,
    h,
    start: Array(h).fill(row),
    target: Array(h).fill(row),
    limits: { rules: 12, conds: 8 },
    palette: { shapes: STD2.shapes, colors: STD2.colors },
  };
}

/** The shape and color indices to choose from. Small palettes make random rules apply often. */
interface Pal {
  shapes: number[];
  colors: number[];
}
const ALL: Pal = { shapes: [0, 1, 2, 3, 4, 5, 6, 7], colors: [0, 1, 2] };
const smallPal = (r: Rng): Pal => ({
  shapes: [r.int(8), r.int(8)],
  colors: [r.int(3)],
});

const randomPiece = (r: Rng, pal = ALL) => {
  const s = r.pick(pal.shapes);
  return piece(s, r.pick(pal.colors), r.int(STD2.periods[s]));
};

function randomGrid(r: Rng, w: number, h: number, pObstacle = 0.1, pPiece = 0.4, pal = ALL) {
  return Uint8Array.from({ length: w * h }, () => {
    const u = r.next();
    return u < pObstacle ? OBSTACLE : u < pObstacle + pPiece ? randomPiece(r, pal) : EMPTY;
  });
}

/** A random piece token. */
const pieceTok = (r: Rng, pal = ALL) => tileToken(randomPiece(r, pal), STD2);

/**
 * A random action on piece token `tok`, the center piece of a rule: remove, recolor, turn, or cut.
 */
function actOn(r: Rng, tok: string, pal: Pal): string {
  const s = STD2.shapes.indexOf(tok[0]);
  const c = STD2.colors.indexOf(tok[1]);
  const f = DIRECTIONS.indexOf(tok[2]);
  const per = STD2.periods[s];
  const options: string[] = ['...'];
  for (const c2 of pal.colors) if (c2 !== c) options.push(tok[0] + STD2.colors[c2] + tok[2]);
  if (per > 1)
    for (const d of per === 2 ? [1] : [1, 3])
      options.push(tok.slice(0, 2) + DIRECTIONS[(f + d) % per]);
  // A cut keeps the direction only as far as the symmetry of the old shape allows.
  for (const s2 of pal.shapes)
    if (s2 !== s && canCut(STD2, s, s2))
      for (let k = 0; k < 4; k += per)
        options.push(STD2.shapes[s2] + tok[1] + DIRECTIONS[(f + k) % STD2.periods[s2]]);
  return r.pick(options);
}

/** A valid rule picture, with a few conditions around the center piece and one action. */
function randomRule(r: Rng, maxConds = 3, pal = ALL): Rule {
  const condition = Array(9).fill('---');
  const change = Array(9).fill('---');
  condition[CENTER] = STD2.shapes[r.pick(pal.shapes)] + STD2.colors[r.pick(pal.colors)] + '^';
  const n = r.int(maxConds + 1);
  for (let k = 0; k < n; k++) {
    const i = r.pick([0, 1, 2, 3, 5, 6, 7, 8]);
    condition[i] = r.pick(['...', '...', '###', 'piece', 'piece']);
    if (condition[i] === 'piece') condition[i] = pieceTok(r, pal);
  }
  // Make one change: a copy of the center piece into an open or empty tile, or an action on the
  // center piece. A rule can change only these.
  const free = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(
    (i) => condition[i] === '...' || condition[i] === '---',
  );
  const i = r.pick(free);
  if (i === CENTER || r.next() < 0.3) change[CENTER] = actOn(r, condition[CENTER], pal);
  else change[i] = condition[CENTER];
  const turn = r.int(4);
  return { condition: rowsOf(condition), change: rowsOf(change), ...(turn && { turn }) };
}

export function randomRules(r: Rng, maxRules = 4, maxConds = 3, pal = ALL): Rule[] {
  return Array.from({ length: 1 + r.int(maxRules) }, () => randomRule(r, maxConds, pal));
}

/**
 * A random case for a step: a board of 1 to `size` tiles on each side, and 1 to `maxRules` rules
 * with up to 4 conditions. A small palette makes the rules apply often.
 */
export function randomCase(r: Rng, size: number, maxRules: number) {
  const w = 1 + r.int(size);
  const h = 1 + r.int(size);
  const pal = smallPal(r);
  const rules = randomRules(r, maxRules, 4, pal);
  return { w, h, rules, g: randomGrid(r, w, h, 0.1, 0.5, pal) };
}

/** The rows of a random start board. */
function randomRows(r: Rng, w: number, h: number, pObstacle?: number, pPiece?: number, pal = ALL) {
  return formatGrid(shell(w, h), randomGrid(r, w, h, pObstacle, pPiece, pal));
}

const TITLE_CHARS = [...'abcXYZ 09-Ünïcødé✓漢字🙂'];
const targetToken = (r: Rng) => (r.next() < 0.3 ? '...' : pieceTok(r));

/**
 * A random puzzle as JSON. Obstacles are on the same tiles in the start and the target. The start
 * can match the target, but this is rare.
 */
export function randomPuzzleJson(r: Rng, w = 1 + r.int(7), h = 1 + r.int(7), full = false) {
  const start = randomRows(r, w, h);
  const sub = (xs: string[]) => (full ? xs : xs.filter(() => r.next() < 0.6));
  const text = () =>
    Array.from({ length: full ? 40 : r.int(41) }, () => r.pick(TITLE_CHARS)).join('');
  return {
    v: 3,
    profile: 'std2',
    title: text(),
    author: text(),
    w,
    h,
    start,
    target: start.map((row) => row.replace(/[^ #]{3}/g, () => targetToken(r))),
    limits: full ? { rules: 12, conds: 8 } : { rules: 1 + r.int(12), conds: r.int(9) },
    palette: { shapes: sub(STD2.shapes), colors: sub(STD2.colors) },
  };
}

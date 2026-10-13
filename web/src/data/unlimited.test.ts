import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { parseToken, plane, STD2, tileValue, validateRules, type Puzzle } from '@bauplan/engine';
import type { Example } from './unlimited.ts';

const dir = new URL('./unlimited/', import.meta.url);
const read = (f: string): Example => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const examples = Object.fromEntries(readdirSync(dir).map((f) => [f, read(f)]));
// As in Unlimited: all of the palette, and no limit of rules or conditions.
const sandbox: Puzzle = {
  v: 3,
  profile: 'std2',
  w: 7,
  h: 7,
  start: [],
  target: [],
  limits: { rules: Infinity, conds: Infinity },
  palette: { shapes: [...STD2.shapes], colors: [...STD2.colors] },
};

/** A plane with the example's rules and start board, and the board as a string after each step. */
function run(ex: Example) {
  const pl = plane(STD2, ex.rules);
  const cells: [number, number, number][] = [];
  ex.start.forEach((row, j) =>
    row.split(' ').forEach((t, i) => {
      const v = parseToken(t, STD2);
      assert.ok(v, `${ex.title}: bad token ${t}`);
      if (v !== 'empty') cells.push([ex.x + i, ex.y + j, tileValue(v)]);
    }),
  );
  pl.set(cells);
  const board = () => {
    const b = pl.bounds();
    if (!b) return '';
    const out: string[] = [];
    for (let y = b[1]; y <= b[3]; y++)
      for (let x = b[0]; x <= b[2]; x++) if (pl.get(x, y)) out.push(`${x},${y},${pl.get(x, y)}`);
    return out.join(' ');
  };
  return { pl, board, n: cells.length };
}

describe('Unlimited examples', () => {
  it('have valid rules, a start board of rows, and a view box', () => {
    for (const ex of Object.values(examples)) {
      assert.deepEqual(validateRules(sandbox, ex.rules), [], ex.title);
      assert.ok(ex.title && ex.about, ex.title);
      const w = ex.start[0].split(' ').length;
      assert.ok(
        ex.start.every((r) => r.split(' ').length === w),
        ex.title,
      );
      assert.equal(ex.view.length, 4, ex.title);
      run(ex);
    }
    // The list of the help has each file.
    const list = readFileSync(new URL('./unlimited.ts', import.meta.url), 'utf8');
    for (const f of Object.keys(examples)) assert.ok(list.includes(`./unlimited/${f}`), f);
  });

  it('Shimmer comes back to its start every 6 steps, with each ring of a square in one color', () => {
    const ex = examples['shimmer.json'];
    const { pl, board } = run(ex);
    // The squares: each run of pieces along a row starts a square, unless a piece is above it.
    const at = (x: number, y: number) => ex.start[y - ex.y]?.split(' ')[x - ex.x];
    const squares: [number, number, number][] = [];
    ex.start.forEach((row, j) =>
      row.split(' ').forEach((t, i) => {
        const [x, y] = [ex.x + i, ex.y + j];
        if (t === '...' || ![undefined, '...'].includes(at(x, y - 1))) return;
        if (![undefined, '...'].includes(at(x - 1, y))) return;
        let s = 0;
        while (![undefined, '...'].includes(at(x + s, y))) s++;
        squares.push([x, y, s]);
      }),
    );
    assert.equal(squares.length, 6);
    const start = board();
    for (let t = 1; t <= 12; t++) {
      pl.advance(0);
      assert.equal(board() === start, t % 6 === 0, `step ${t}`);
      for (const [x0, y0, s] of squares) {
        const rings = new Map<number, Set<number>>();
        for (let i = 0; i < s; i++)
          for (let j = 0; j < s; j++) {
            const k = Math.min(i, j, s - 1 - i, s - 1 - j);
            rings.set(k, (rings.get(k) ?? new Set()).add(pl.get(x0 + i, y0 + j)));
          }
        for (const [k, colors] of rings) assert.equal(colors.size, 1, `step ${t}, ring ${k}`);
      }
    }
  });

  it('the sun gun keeps sending out comets', () => {
    const { pl, board, n } = run(examples['sun-gun.json']);
    for (let t = 0; t < 30; t++) pl.advance(0);
    assert.ok(board().split(' ').length > 10 * n);
  });
});

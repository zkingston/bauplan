import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalize, parsePuzzle, step, validateRules, type Puzzle } from '../src/index.ts';
import { STD2 } from '../src/profile.ts';
import { colorOf, directionOf, isPiece, piece, shapeOf } from '../src/tile.ts';
import type { Rule } from '../src/rules.ts';
import { forSeeds, randomCase, randomPuzzleJson, rng, shell } from './random.ts';

/** Change the colors in rule pictures with a map such as {b: 'r', r: 'y', y: 'b'}. */
function relabelRules(rules: Rule[], colors: Record<string, string>): Rule[] {
  const tok = (t: string) => (t[1] in colors ? t[0] + colors[t[1]] + t[2] : t);
  const grid = (rows: string[]) => rows.map((r) => r.split(' ').map(tok).join(' '));
  return rules.map((r) => ({ ...r, condition: grid(r.condition), change: grid(r.change) }));
}

function setup(seed: number) {
  const c = randomCase(rng(seed), 6, 6);
  assert.deepEqual(validateRules(shell(c.w, c.h), c.rules), []);
  return c;
}

describe('step commutes with color relabeling', () => {
  it('relabeling colors', async () => {
    const perms = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    await forSeeds(400, (seed) => {
      const cp = perms[seed % perms.length];
      const { w, h, g, rules } = setup(seed);
      const rel = (v: number) =>
        isPiece(v) ? piece(shapeOf(v), cp[colorOf(v)], directionOf(v)) : v;
      const map = Object.fromEntries(STD2.colors.map((c, i) => [c, STD2.colors[cp[i]]]));
      const a = step(shell(w, h), g, rules);
      const b = step(shell(w, h), g.map(rel), relabelRules(rules, map));
      assert.deepEqual(Array.from(b.next), Array.from(a.next.map(rel)));
      assert.deepEqual(Array.from(b.fired), Array.from(a.fired));
    });
  });
});

it('random rules do something', () => {
  let changed = 0;
  for (let s = 0; s < 200; s++) {
    const { w, h, g, rules } = setup(s);
    changed += step(shell(w, h), g, rules).fired.filter((f) => f >= 0).length;
  }
  assert.ok(changed > 50);
});

it('canonicalize is idempotent', async () => {
  await forSeeds(300, async (seed) => {
    const p = parsePuzzle(randomPuzzleJson(rng(seed)));
    if (Array.isArray(p)) {
      assert.deepEqual(p, [{ path: 'start', message: 'start already matches target' }]);
      return;
    }
    const c = canonicalize(p);
    assert.equal(canonicalize(parsePuzzle(JSON.parse(c)) as Puzzle), c);
    assert.match(c, /^[\x20-\x7e]*$/);
  });
});

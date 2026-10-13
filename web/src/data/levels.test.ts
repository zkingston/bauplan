import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { parsePuzzle, run, validateRules, type Puzzle, type Rule } from '@bauplan/engine';

// The data files, read as levels.ts and the tutorial import them in the game.
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const order = read('./levels.json') as string[];
const pinwheel = read('./tutorial-pinwheel.json');
const build = read('./tutorial-build.json');
const debug = read('./debug-errors.json') as {
  puzzle: object;
  cases: { title: string; puzzle: object; rule: Rule; message: string }[];
};

describe('levels', () => {
  // All the puzzle files, also those that levels.json leaves out.
  const files = readdirSync(new URL('./puzzles/', import.meta.url));
  const puzzles = files.map((f) => parsePuzzle(read(`./puzzles/${f}`)) as Puzzle);

  it('lists puzzle files, each one time', () => {
    for (const name of order) assert.ok(files.includes(`${name}.json`), name);
    assert.equal(new Set(order).size, order.length);
  });

  it('parses, and has a hint and a winning solution', () => {
    for (const p of puzzles) {
      const name = String(p.title);
      assert.equal(Array.isArray(p), false);
      assert.ok(p.hint, name);
      assert.deepEqual(validateRules(p, p.solution!), [], name);
      assert.equal(run(p, p.solution!).outcome.kind, 'win', name);
    }
  });

  it('runs the tutorial’s pinwheel and its first rule to their targets', () => {
    for (const j of [pinwheel, build]) {
      const p = parsePuzzle(j) as Puzzle;
      assert.deepEqual(validateRules(p, p.solution!), [], String(p.title));
      assert.equal(run(p, p.solution!).outcome.kind, 'win', String(p.title));
    }
  });

  it('gives each case of the debug page its error', () => {
    for (const c of debug.cases) {
      const p = parsePuzzle({ ...debug.puzzle, ...c.puzzle }) as Puzzle;
      assert.equal(validateRules(p, [c.rule])[0]?.message, c.message, c.title);
    }
  });
});

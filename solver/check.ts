// The engine's answers for rule lists from check.py: for each case, the tiles equal to the target
// at the end, the most at any step, the tiles of the target that one step keeps, the step at which
// the board stopped changing (255 if it did not), and the mask of the slots whose rule fired. A
// rule list that the engine does not accept (with room for 16 rules) gives "invalid".
// Usage: node check.ts cases.json > results.json
import { readFileSync } from 'node:fs';
import {
  parseGrid,
  parsePuzzle,
  step,
  STEP_LIMIT,
  validateRules,
  type Puzzle,
  type Rule,
} from '../engine/src/index.ts';

interface Case {
  level: string;
  rules: Rule[];
  slots: number[];
}

const cases: Case[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const puzzles: Record<string, Puzzle> = {};
const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../web/src/data/puzzles/${name}.json`, import.meta.url), 'utf8'),
  );

const out = cases.map(({ level, rules, slots }) => {
  const p = (puzzles[level] ??= parsePuzzle(read(level)) as Puzzle);
  if (validateRules({ ...p, limits: { ...p.limits, rules: 16 } }, rules).length) return 'invalid';
  const target = parseGrid(p, p.target);
  const matches = (g: Uint8Array) => g.filter((v, i) => v === target[i]).length;
  let g = parseGrid(p);
  let best = matches(g);
  let settled = 255;
  let fired = 0;
  for (let t = 0; t < STEP_LIMIT; t++) {
    const s = step(p, g, rules);
    if (s.fired.every((r) => r < 0)) {
      settled = t;
      break;
    }
    for (const r of s.fired) if (r >= 0) fired |= 1 << slots[r];
    g = s.next;
    best = Math.max(best, matches(g));
  }
  const stable = matches(step(p, target, rules).next);
  return [matches(g), best, stable, settled, fired];
});
process.stdout.write(JSON.stringify(out));

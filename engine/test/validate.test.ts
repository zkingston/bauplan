import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parsePuzzle,
  puzzleId,
  validateRules,
  type Puzzle,
  type Rule,
  type ValidationError,
} from '../src/index.ts';
import { FRAME, R } from './examples.ts';

const p = parsePuzzle(FRAME) as Puzzle;
const msgs = (rules: Rule[], q = p) =>
  validateRules(q, rules).map((e) => `${e.path}: ${e.message}`);

describe('parsePuzzle', () => {
  const bad = (patch: object) => parsePuzzle({ ...FRAME, ...patch }) as ValidationError[];

  it('rejects malformed puzzles', () => {
    assert.equal(bad({ v: 2 })[0].path, 'v');
    assert.equal(bad({ profile: 'std1' })[0].path, 'profile');
    assert.equal(bad({ w: 17 })[0].path, 'w');
    assert.equal(bad({ extra: 1 })[0].path, 'extra');
    assert.equal(bad({ limits: { rules: 13, conds: 1 } })[0].path, 'limits.rules');
    assert.equal(bad({ limits: { rules: 3, conds: 1, steps: 20 } })[0].path, 'limits');
    assert.equal(bad({ palette: { shapes: ['S', 'S'] } })[0].message, 'has duplicates');
    // A square has only the direction ^. A leaf has ^ and >. Targets must match exactly.
    const start = (t: string) => FRAME.start.map((r) => r.replace('Qb>', t));
    assert.equal(bad({ start: start('Sb>') })[0].path, 'start[4]');
    assert.equal(bad({ start: start('Lbv') })[0].path, 'start[4]');
    assert.equal(
      bad({ target: FRAME.target.map((r) => r.replace('Tb^', 'Tb?')) })[0].path,
      'target[1]',
    );
    assert.match(
      bad({ target: FRAME.target.map((r) => r.replace('Tb^', '###')) })[0].message,
      /obstacles/,
    );
    assert.match(bad({ target: FRAME.start })[0].message, /already matches/);
  });

  it('orders the palette, and the ID ignores title and palette order', () => {
    const q = parsePuzzle({
      ...FRAME,
      title: 'Other',
      palette: { shapes: ['L', 'Q', 'T'], colors: ['b'] },
    }) as Puzzle;
    assert.deepEqual(q.palette.shapes, ['Q', 'T', 'L']);
    assert.equal(puzzleId(q), puzzleId(p));
    assert.match(puzzleId(p), /^[0-9a-f]{16}$/);
  });

  it('keeps the ID when the palette lists every tool, and changes it when tools are left out', () => {
    const tools = (list: string[]) =>
      puzzleId(parsePuzzle({ ...FRAME, palette: { ...FRAME.palette, tools: list } }) as Puzzle);
    assert.equal(tools(['obstacle']), puzzleId(p));
    assert.notEqual(tools([]), puzzleId(p));
    assert.equal(bad({ palette: { tools: ['paint'] } })[0].path, 'palette.tools');
  });
});

describe('validateRules', () => {
  it('allows obstacles only when the palette has that tool', () => {
    const none = parsePuzzle({ ...FRAME, palette: { ...FRAME.palette, tools: [] } }) as Puzzle;
    const turnRight = R('Qb^', 'Qb>', { 1: '###' });
    assert.deepEqual(msgs([turnRight]), []);
    assert.deepEqual(msgs([turnRight], none), [
      "rules[0].condition[0][1]: obstacles are not in this puzzle's palette",
    ]);
  });

  it('flags each invalid picture', () => {
    assert.deepEqual(msgs([R('Qb^', 'Tb^')]), []);
    assert.deepEqual(msgs([R('Sb^', 'Qb^')]), [
      "rules[0].condition[1][1]: S is not in this puzzle's palette",
    ]);
    // A cut goes one level down the tree: a square to a quarter circle, not directly to a leaf.
    const cuts = parsePuzzle({ ...FRAME, palette: { shapes: ['S', 'Q', 'L'] } }) as Puzzle;
    assert.deepEqual(msgs([R('Sb^', 'Qb^')], cuts), []);
    assert.deepEqual(msgs([R('Sb^', 'Lb^')], cuts), [
      'rules[0].change[1][1]: S cannot be cut into L',
    ]);
    assert.deepEqual(msgs([R('...', 'Tb^')]), [
      'rules[0].condition[1][1]: the center must be a piece with direction up',
    ]);
    assert.deepEqual(msgs([R('Qb>', 'Tb>')]), [
      'rules[0].condition[1][1]: the center must be a piece with direction up',
    ]);
    assert.deepEqual(msgs([R('Qb^', '---')]), ['rules[0]: this rule has no change']);
    assert.deepEqual(msgs([R('Qb^', 'Qb^')]), ['rules[0].change[1][1]: the piece does not change']);
    assert.deepEqual(msgs([R('Tb^', 'Qb^')]), ['rules[0].change[1][1]: T cannot be cut into Q']);
    assert.deepEqual(msgs([R('Qb^', '---', { 1: '###' }, { 1: 'Tb^' })]), [
      'rules[0].change[0][1]: obstacles cannot change',
    ]);
    assert.deepEqual(msgs([R('Qb^', '---', { 1: '...' }, { 1: '...' })]), [
      'rules[0].change[0][1]: there is no piece here to remove',
    ]);
    assert.deepEqual(msgs([R('Qb^', 'Qb?')]), ['rules[0].change[1][1]: unknown tile "Qb?"']);
    assert.deepEqual(msgs([R('Qb^', 'Tb^', { 0: '...', 1: '...', 2: '...' })]), [
      'rules[0]: only 2 conditions per rule',
    ]);
    assert.deepEqual(msgs(Array(4).fill(R('Qb^', 'Tb^'))), ['rules: at most 3 rules']);
    // A rule does one action: copy, remove, recolor, turn a quarter, or cut.
    assert.deepEqual(msgs([R('Qb^', '---', {}, { 1: 'Qb^' })]), []);
    assert.deepEqual(msgs([R('Qb^', '---', {}, { 1: 'Qb>' })]), [
      'rules[0].change[0][1]: a piece cannot both copy and turn',
    ]);
    const red = parsePuzzle({
      ...FRAME,
      palette: { ...FRAME.palette, colors: ['b', 'r'] },
    }) as Puzzle;
    assert.deepEqual(msgs([R('Qb^', '---', {}, { 1: 'Qr^' })], red), [
      'rules[0].change[0][1]: a piece cannot both copy and recolor',
    ]);
    assert.deepEqual(msgs([R('Qb^', '---', {}, { 1: 'Tb^' })]), [
      'rules[0].change[0][1]: a piece cannot both copy and cut',
    ]);
    assert.deepEqual(msgs([R('Qb^', 'Tb^', {}, { 1: 'Qb^' })]), [
      'rules[0].change[1][1]: a rule can only change one tile',
    ]);
    assert.deepEqual(msgs([R('Qb^', 'Qb>')]), []);
    // A rule changes only its own piece. In the tiles around it, it can only copy the piece into
    // an empty tile.
    assert.deepEqual(msgs([R('Qb^', '---', { 1: 'Tb^' }, { 1: 'Tr^' })]), [
      'rules[0].change[0][1]: a piece cannot change other pieces',
    ]);
    assert.deepEqual(msgs([R('Qb^', '---', {}, { 1: '...' })]), [
      'rules[0].change[0][1]: a piece cannot remove other pieces',
    ]);
    assert.deepEqual(msgs([R('Qb^', '...')]), []);
    assert.deepEqual(msgs([R('Qb^', 'Qbv')]), [
      'rules[0].change[1][1]: a piece can only turn a quarter',
    ]);
    assert.deepEqual(msgs([R('Qb^', 'Qr>')], red), [
      'rules[0].change[1][1]: a piece cannot both turn and recolor',
    ]);
    assert.deepEqual(msgs([R('Qb^', 'Tb>')]), [
      'rules[0].change[1][1]: a piece cannot both cut and turn',
    ]);
    assert.deepEqual(msgs([R('Qb^', 'Tr^')], red), [
      'rules[0].change[1][1]: a piece cannot both cut and recolor',
    ]);
  });
});

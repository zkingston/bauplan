import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  explain,
  formatGrid,
  parseGrid,
  parsePuzzle,
  run,
  step,
  validateRules,
  type Puzzle,
  type Rule,
} from '../src/index.ts';
import { FRAME, FRAME_RULES, copy, R } from './examples.ts';
import { shell } from './random.ts';

/** The rows after one step from a start board. */
function after(start: string[], rules: Rule[]) {
  const p = { ...shell(start[0].split(' ').length, start.length), start };
  assert.deepEqual(validateRules(p, rules), []);
  return formatGrid(p, step(p, parseGrid(p), rules).next);
}

describe('rule pictures', () => {
  it('Frame wins at step 19, one action per rule: copy, cut behind, turn at the corner', () => {
    const p = parsePuzzle(FRAME) as Puzzle;
    assert.deepEqual(validateRules(p, FRAME_RULES), []);
    const { outcome, history } = run(p, FRAME_RULES);
    assert.deepEqual(outcome, { kind: 'win', steps: 19 });
    assert.deepEqual(formatGrid(p, history[5]), [
      '... ... ... ... ...',
      '... ### ### ### ...',
      '... ### ### ### ...',
      '... ### ### ### ...',
      'Tb> Tb> Tb> Tb> Qb^',
    ]);
  });

  it('ends a run in a win, a wrong result, a loop, or the step limit', () => {
    const p = parsePuzzle(FRAME) as Puzzle;
    assert.equal(run(p, FRAME_RULES).outcome.kind, 'win');
    assert.equal(run(p, FRAME_RULES.slice(0, 2)).outcome.kind, 'wrong');
    assert.equal(run(p, [R('Qb^', 'Qb>')]).outcome.kind, 'loop');
    const row = '... ... ... ... ... ... ...';
    const coil = parsePuzzle({
      ...FRAME,
      w: 7,
      h: 7,
      start: ['Qy> ... ... ... ... ... ...', ...Array(6).fill(row)],
      target: Array(7).fill(row.replaceAll('...', 'Ty^')),
      limits: { rules: 6, conds: 2 },
      palette: { shapes: ['Q', 'T'], colors: ['b', 'r', 'y'] },
    }) as Puzzle;
    const slow = [
      R('Qy^', 'Ty^', { 1: 'Qy^' }),
      R('Qy^', 'Qb^', { 7: 'Qy^' }),
      R('Qb^', 'Qr^'),
      R('Qr^', 'Qy^'),
      copy('Qy^', 'Qy^'),
      R('Qy^', 'Qy>'),
    ];
    assert.deepEqual(validateRules(coil, slow), []);
    assert.equal(run(coil, slow).outcome.kind, 'limit');
  });

  it('reads an oriented piece in its own frame only', () => {
    assert.deepEqual(after(['... Wb> ...'], [copy('Wb^', 'Wb^')]), ['... Wb> Wb>']);
    assert.deepEqual(after(['... Wb< ...'], [copy('Wb^', 'Wb^')]), ['Wb< Wb< ...']);
  });

  it('copies a circle up first, and an hourglass in its direction', () => {
    assert.deepEqual(after(['... ... ...', '... Cb^ ...', '... ... ...'], [copy('Cb^', 'Cb^')]), [
      '... Cb^ ...',
      '... Cb^ ...',
      '... ... ...',
    ]);
    assert.deepEqual(after(['... ... ...', '... Hb> ...', '... ... ...'], [copy('Hb^', 'Hb^')]), [
      '... ... ...',
      '... Hb> Hb>',
      '... ... ...',
    ]);
  });

  it('merges equal changes and blocks rules that change a contested tile', () => {
    // Two circles copy into the middle tile: one copies right and one copies left. The two values are
    // equal, so they merge.
    assert.deepEqual(after(['Cb^ ... Cb^'], [R('Cb^', '---', {}, { 5: 'Cb^' })]), ['Cb^ Cb^ Cb^']);
    // Two wedges that face each other contest the middle tile. Neither wedge then tries recolor.
    assert.deepEqual(after(['Wb> ... Wb<'], [copy('Wb^', 'Wb^'), R('Wb^', 'Wr^')]), [
      'Wb> ... Wb<',
    ]);
  });

  it('fails a rule whose change cannot happen, and falls through to the next', () => {
    const recolor = R('Wb^', 'Wr^');
    // A wedge cannot copy off the board, into a piece, or into an obstacle, so it turns red.
    assert.deepEqual(after(['... Wb>'], [copy('Wb^', 'Wb^'), recolor]), ['... Wr>']);
    assert.deepEqual(after(['Wb> Cy^'], [copy('Wb^', 'Wb^'), recolor]), ['Wr> Cy^']);
    assert.deepEqual(after(['Wb> ###'], [copy('Wb^', 'Wb^'), recolor]), ['Wr> ###']);
  });

  it('tries a square’s rules up, down, right, then left, and applies the first that fits', () => {
    const point = R('Sb^', 'Qb^', { 1: '###' });
    assert.deepEqual(after(['... ### ...', '... Sb^ ...'], [point]), [
      '... ### ...',
      '... Qb^ ...',
    ]);
    assert.deepEqual(after(['### Sb^'], [point]), ['### Qb<']);
    // With obstacles above and to the right, the up frame comes first.
    assert.deepEqual(after(['### ...', 'Sb^ ###'], [point]), ['### ...', 'Qb^ ###']);
    // One copy in each step: a circle that can copy in all directions copies only up.
    assert.deepEqual(
      after(['... ... ...', '... Cb^ ...', '... ... ...'], [R('Cb^', '---', {}, { 1: 'Cb^' })]),
      ['... Cb^ ...', '... Cb^ ...', '... ... ...'],
    );
  });

  it('tries a symmetric piece’s rule first as the player sees it turned', () => {
    const start = ['... ... ...', '... Sb^ ...', '... ... ...'];
    const copyRule = copy('Sb^', 'Sb^');
    const dirs = [0, 1, 2, 3].map((turn) => after(start, [{ ...copyRule, turn }]));
    assert.deepEqual(dirs, [
      ['... Sb^ ...', '... Sb^ ...', '... ... ...'],
      ['... ... ...', '... Sb^ Sb^', '... ... ...'],
      ['... ... ...', '... Sb^ ...', '... Sb^ ...'],
      ['... ... ...', 'Sb^ Sb^ ...', '... ... ...'],
    ]);
    // A leaf tries the rule as the player sees it, then turned around. A wedge tries only its
    // direction.
    assert.deepEqual(after(['... Lb^ ...'], [{ ...copy('Lb^', 'Lb^'), turn: 1 }]), ['... Lb^ ...']);
    assert.deepEqual(after(['...', 'Lb^', '...'], [{ ...copy('Lb^', 'Lb^'), turn: 2 }]), [
      '...',
      'Lb^',
      'Lb^',
    ]);
    assert.deepEqual(after(['Wb> ...'], [{ ...copy('Wb^', 'Wb^'), turn: 3 }]), ['Wb> Wb>']);
    assert.equal(
      validateRules(shell(1, 1), [{ ...copyRule, turn: 4 }])[0].message,
      'turn must be 0 to 3',
    );
  });

  it('tries a leaf’s rules in its direction, then the opposite', () => {
    const point = R('Lb^', 'Lr^', { 1: '###' });
    assert.deepEqual(after(['Lb^', '###'], [point]), ['Lr^', '###']);
    assert.deepEqual(after(['###', 'Lb^'], [point]), ['###', 'Lr^']);
    assert.deepEqual(after(['### Lb^ ...'], [point]), ['### Lb^ ...']);
  });

  it('moves a piece in two steps: copy it ahead, then remove the one behind', () => {
    const move = [R('Wb^', '...', { 1: 'Wb^' }), copy('Wb^', 'Wb^')];
    assert.deepEqual(after(['Wb> ... ...'], move), ['Wb> Wb> ...']);
    assert.deepEqual(after(['Wb> Wb> ...'], move), ['... Wb> Wb>']);
  });

  it('uses each piece’s first rule that changes something', () => {
    assert.deepEqual(after(['Wb^ Wr^'], [R('Wb^', 'Wr^'), R('Wr^', 'Wy^')]), ['Wr^ Wy^']);
    assert.deepEqual(after(['Wb^'], [R('Wb^', 'Wr^'), R('Wb^', 'Wy^')]), ['Wr^']);
  });

  it('explains a tile', () => {
    const p = { ...shell(3, 1), start: ['Wb> ... Wb<'] };
    const rules = [copy('Wb^', 'Wb^')];
    assert.deepEqual(explain(p, parseGrid(p), rules, 0), {
      rule: 0,
      frame: 1,
      blocked: true,
    });
    assert.deepEqual(explain(p, parseGrid(p), rules, 1), {
      rule: -1,
      frame: -1,
      blocked: false,
    });
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plane, step, STD2, type Plane, type Rule } from '../src/index.ts';
import { EMPTY } from '../src/tile.ts';
import { forSeeds, randomCase, rng, shell } from './random.ts';

/**
 * Board g of w×h tiles, stepped t times on a dense grid with a margin of t + 3, so that the board
 * grows (one tile per step at most) without reading the edges.
 */
function dense(rules: Rule[], g: Uint8Array, w: number, h: number, t: number) {
  const m = t + 3;
  const [W, H] = [w + 2 * m, h + 2 * m];
  let d: Uint8Array = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y + m) * W + x + m] = g[y * w + x];
  const p = shell(W, H);
  for (let k = 0; k < t; k++) d = step(p, d, rules).next;
  return { d, W, H, m };
}

function setup(seed: number) {
  const r = rng(seed);
  const { w, h, rules, g } = randomCase(r, 10, 8);
  const [x0, y0] = [r.int(40) - 20, r.int(40) - 20];
  // A small node limit, so that runs collect nodes.
  const pl = plane(STD2, rules, 3000);
  const cells: [number, number, number][] = [];
  g.forEach((v, i) => v !== EMPTY && cells.push([x0 + (i % w), y0 + Math.floor(i / w), v]));
  pl.set(cells);
  return { rules, g, w, h, x0, y0, pl, r };
}

/** Whether the plane equals the dense grid, and has no tile outside it. */
function same(pl: Plane, D: ReturnType<typeof dense>, x0: number, y0: number) {
  const win = pl.window(x0 - D.m, y0 - D.m, D.W, D.H);
  const filled = (a: Uint8Array) => a.filter((v) => v !== EMPTY).length;
  const b = pl.bounds();
  const inside =
    !b || (b[0] >= x0 - D.m && b[1] >= y0 - D.m && b[2] < x0 - D.m + D.W && b[3] < y0 - D.m + D.H);
  return inside && filled(win) === filled(D.d) && win.every((v, i) => v === D.d[i]);
}

describe('plane', () => {
  it('matches dense steps, one at a time and in jumps', async () => {
    await forSeeds(150, async (seed) => {
      const { rules, g, w, h, x0, y0, pl, r } = setup(seed);
      const t = 1 + r.int(40);
      const D = dense(rules, g, w, h, t);
      // A random mix of jumps of 2^j steps that adds up to t.
      let left = t;
      while (left) {
        const j = r.int(Math.floor(Math.log2(left)) + 1);
        pl.advance(j);
        left -= 2 ** j;
      }
      assert.equal(pl.gen, t);
      assert.equal(same(pl, D, x0, y0), true);
    });
  });

  it('goes back, restarts, saves, and loads', async () => {
    await forSeeds(60, async (seed) => {
      const { rules, g, w, h, x0, y0, pl } = setup(seed);
      const saved = pl.save();
      for (let k = 0; k < 5; k++) pl.advance(0);
      pl.back();
      pl.back();
      assert.equal(pl.gen, 3);
      assert.equal(same(pl, dense(rules, g, w, h, 3), x0, y0), true);
      pl.restart();
      assert.equal(same(pl, dense(rules, g, w, h, 0), x0, y0), true);
      const other = plane(STD2, rules);
      other.load(saved);
      other.advance(2);
      assert.equal(same(other, dense(rules, g, w, h, 4), x0, y0), true);
    });
  });

  it('undoes paint and a clear, back to the step before', async () => {
    await forSeeds(60, async (seed) => {
      const { rules, g, w, h, x0, y0, pl } = setup(seed);
      for (let k = 0; k < 6; k++) pl.advance(0);
      pl.keep();
      pl.set([[x0 - 30, y0, 1]]);
      for (let k = 0; k < 20; k++) pl.advance(0);
      pl.keep();
      pl.load({ nodes: [] });
      assert.equal(pl.undo(), true);
      assert.equal(pl.gen, 20);
      pl.restart();
      assert.equal(pl.get(x0 - 30, y0), 1);
      assert.equal(pl.undo(), true);
      assert.equal(pl.gen, 6);
      assert.equal(same(pl, dense(rules, g, w, h, 6), x0, y0), true);
      assert.equal(pl.undo(), false);
      // A state kept under other rules comes back at its start.
      pl.keep();
      pl.set([[x0 - 30, y0, 1]]);
      pl.setRules(rules);
      pl.undo();
      assert.equal(pl.gen, 0);
      assert.equal(same(pl, dense(rules, g, w, h, 0), x0, y0), true);
    });
  });

  it('does not load data that save cannot make', () => {
    const pl = plane(STD2, []);
    for (const nodes of [
      [1, 0, 0, 254, 0],
      [0, 0, 0, 0, 0],
      [2, 300, 0, 0, 0],
      [1, 1, 1],
      [1, 0.5, 0, 0, 0],
    ])
      assert.throws(() => pl.load({ nodes }), /bad board/);
    pl.load({ nodes: [1, 1, 0, 0, 255, 2, 256, 0, 0, 0, 3, 0, 0, 0, 257] });
    assert.deepEqual([pl.get(0, 0), pl.get(1, 1), pl.pieces], [1, 255, 1]);
  });

  it('runs a growing board far ahead, and a coarse window shows the pieces in each cell', () => {
    // A square copies itself ahead, or behind, or to a side: the first side that is empty. The
    // board grows up and down by one tile in each step.
    const grow: Rule = {
      condition: ['--- ... ---', '--- Sb^ ---', '--- --- ---'],
      change: ['--- Sb^ ---', '--- --- ---', '--- --- ---'],
    };
    const pl = plane(STD2, [grow]);
    pl.set([[0, 0, 1]]);
    for (let j = 0; j < 40; j++) pl.advance(j);
    const t = 2 ** 40 - 1;
    assert.equal(pl.gen, t);
    assert.equal(pl.bounds()?.[1], -t);
    assert.ok(pl.pieces > 1e24);
    assert.ok(pl.nodes < 20000);
    assert.deepEqual([...pl.window(-2, -2, 4, 4, 38)], Array(16).fill(1));
  });
});

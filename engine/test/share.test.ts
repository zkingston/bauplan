import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalRules,
  decodeRules,
  decodeShare,
  decodeUnlimited,
  encodeRules,
  encodeShare,
  encodeUnlimited,
  parsePuzzle,
  type Puzzle,
  type ValidationError,
} from '../src/index.ts';
import { stableStringify } from '../src/canonical.ts';
import { deflateText, shareJson } from '../src/share.ts';
import { FRAME_RULES } from './examples.ts';
import { randomPuzzleJson, randomRules, rng, forSeeds } from './random.ts';

const msg = (d: unknown) => (d as ValidationError[])[0].message;

describe('share codec', () => {
  it('round-trips 1,000 random puzzles and rule lists exactly', async () => {
    let n = 0;
    await forSeeds(1000, async (seed) => {
      const r = rng(seed);
      const full = r.next() < 0.5;
      const p = parsePuzzle(randomPuzzleJson(r, undefined, undefined, full));
      if (Array.isArray(p)) return;
      n++;
      const rules = full ? randomRules(r, 12, 8) : undefined;
      const d = await decodeShare(await encodeShare(p, rules));
      assert.deepEqual(d, rules ? { puzzle: p, rules: canonicalRules(rules) } : { puzzle: p });
    });
    assert.ok(n > 950);
  });

  it('keeps worst-case links within the 2,000-character URL budget', async () => {
    let worst = 0;
    for (let s = 0; s < 100; s++) {
      const r = rng(s);
      const p = parsePuzzle(randomPuzzleJson(r, 7, 7, true)) as Puzzle;
      const rules = Array.from({ length: 12 }, () => randomRules(r, 1, 8)[0]);
      worst = Math.max(worst, (await encodeShare(p, rules)).length);
    }
    // Keep 100 characters for the origin and the path.
    assert.ok(worst <= 1900);
  });

  it('round-trips the rules of a level, and refuses rules that the level does not allow', async () => {
    const p = parsePuzzle(randomPuzzleJson(rng(7), 5, 5, true)) as Puzzle;
    const rules = [...randomRules(rng(8), 2, 2), ...randomRules(rng(11), 2, 2)];
    assert.deepEqual(await decodeRules(await encodeRules(rules), p), canonicalRules(rules));
    const tight = { ...p, limits: { ...p.limits, rules: 1 } };
    assert.match(msg(await decodeRules(await encodeRules(rules), tight)), /at most 1 rule/);
    assert.match(msg(await decodeRules('broken!', p)), /^link is damaged/);
  });

  it('keeps the solution of a shared puzzle, so the link shows it as verified', async () => {
    const p = parsePuzzle(randomPuzzleJson(rng(9), 5, 5, true)) as Puzzle;
    const solution = canonicalRules(randomRules(rng(10), 3, 2));
    const d = await decodeShare(await encodeShare({ ...p, solution }));
    assert.deepEqual((d as { puzzle: Puzzle }).puzzle.solution, solution);
  });

  it('rejects damaged, oversized, and invalid links with an error', async () => {
    assert.equal(msg(await decodeShare('#/x/abc')), 'not a puzzle link');
    assert.equal(msg(await decodeShare('#/p/' + 'A'.repeat(9000))), 'link is too long');
    assert.match(msg(await decodeShare('#/p/AAAA')), /damaged/);
    assert.match(
      msg(await decodeShare('#/p/' + (await deflateText(' '.repeat(100000))))),
      /exceeds 8192/,
    );
    assert.equal(
      msg(await decodeShare('#/p/' + (await deflateText('{"v":3}')))),
      'unknown profile',
    );
    const ok = await encodeShare(parsePuzzle(randomPuzzleJson(rng(1), 3, 3, true)) as Puzzle);
    assert.equal(
      msg(await decodeShare(ok + '/s/' + (await deflateText('[{"pre":1}]')))),
      'must be {condition, change}, each 3 rows of 3 tiles',
    );
  });

  it('reads links in the old format, with seed, pre, and post', async () => {
    const p = parsePuzzle(randomPuzzleJson(rng(2), 4, 4, true)) as Puzzle;
    const rules = randomRules(rng(3), 4, 8);
    const { start, ...rest } = JSON.parse(shareJson(p));
    const old = rules.map(({ condition, change, ...r }) => ({
      pre: condition,
      post: change,
      ...r,
    }));
    const P = await deflateText(stableStringify({ ...rest, seed: start }));
    const S = await deflateText(stableStringify(old));
    assert.deepEqual(await decodeShare(`#/p/${P}/s/${S}`), {
      puzzle: p,
      rules: canonicalRules(rules),
    });
  });
});

describe('Unlimited links', () => {
  it('give back the setup, and refuse a damaged or long link', async () => {
    const setup = {
      slots: FRAME_RULES,
      board: { nodes: [1, 1, 0, 0, 255] },
      cam: { x: 1, y: 2, z: 32 },
    };
    const link = await encodeUnlimited(setup);
    assert.match(link ?? '', /^#\/u\/[A-Za-z0-9_-]+$/);
    assert.deepEqual(await decodeUnlimited(link ?? ''), setup);
    await assert.rejects(decodeUnlimited('#/u/!!'));
    await assert.rejects(decodeUnlimited(`#/u/${'A'.repeat(1 << 16)}`), /too long/);
    // A board that does not compress to 64 kB has no link.
    const r = rng(7);
    const noise = Array.from({ length: 200000 }, () => r.int(1000));
    assert.equal(await encodeUnlimited({ board: { nodes: noise } }), null);
  });
});

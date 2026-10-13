"""Motif library: runs of consecutive rules from other levels' solutions, carried over to a puzzle by
a color permutation, an optional left-right mirror, and a one-to-one shape map.
The runs that are valid in the puzzle (palette, conditions, changes) go to the GA, which writes
them into a few children each generation.
Usage: uv run library.py LEVEL   (prints the size of the library and checks it on the reference)
"""

import functools
import itertools
import sys

import torch

from gpu import EMPTY, PERIOD, PERMS, Puzzle, dev, levels, pack, piece, unpiece

MAXRUN = 6


@functools.cache
def _map(p, r, t, shape):
    """A packed rule (tuple of 8 ints) under transform t (see ga.py) and a shape map (tuple of
    pairs); None if it is not valid in puzzle p."""
    perm, mirror, shape = PERMS[t % 6], t >= 6, dict(shape)
    s, c, turn = r[0] & 7, r[0] >> 3 & 3, r[0] >> 5 & 3
    out = [shape[s] | perm[c] << 3 | (-turn % 4 if mirror else turn) << 5 | 0x80, *r[1:]]
    for i in (1, 3, 5):
        if mirror:
            out[i] += 2 - 2 * (out[i] % 3)
    for i in (2, 4, 6):
        if 1 <= out[i] <= 96:
            s, c, d = unpiece(out[i])
            out[i] = piece(shape[s], perm[c], (-d % 4 if mirror else d) % PERIOD[shape[s]])
    if out[3] != 4 and (out[1] == 4 or out[3] < out[1]):  # conditions in position order, as pack writes them
        out[1:5] = out[3:5] + out[1:3]
    return tuple(out) if _valid(p, out) else None


def _valid(p, r):
    s, c = r[0] & 7, r[0] >> 3 & 3
    if (s, c) not in p.centers or any(r[i] != 4 and r[i + 1] not in p.vocab for i in (1, 3)):
        return False
    if sum(r[i] != 4 for i in (1, 3)) > p.max_conds or (r[1] != 4 and r[1] == r[3]):
        return False
    if r[5] == 4:
        return r[6] in p.center_changes(s, c)
    return r[6] == piece(s, c, 0) and not any(r[i] == r[5] and r[i + 1] != EMPTY for i in (1, 3))


def _shapes(run):
    return sorted({r[0] & 7 for r in run} | {unpiece(r[i])[0] for r in run for i in (2, 4, 6) if 1 <= r[i] <= 96})


def build(p, sources):
    """Every valid image of every run (up to MAXRUN rules) of the sources' solutions in puzzle p,
    under one-to-one shape maps. Runs grow one rule at a time, keeping the maps that stay valid."""
    _map.cache_clear()
    runs = set()
    for name in sources:
        sol = [tuple(r) for r in pack(Puzzle(name).json['solution'], 16).tolist() if r[0] >> 7]
        for a in range(len(sol)):
            for t in range(12):
                maps = [{}]
                for b in range(a, min(a + MAXRUN, len(sol))):
                    used = _shapes([sol[b]])
                    grown = []
                    for m in maps:
                        new = [s for s in used if s not in m]
                        free = [x for x in p.shapes if x not in m.values()]
                        for img in itertools.permutations(free, len(new)):
                            m2 = {**m, **dict(zip(new, img))}
                            if _map(p, sol[b], t, tuple((s, m2[s]) for s in used)):
                                grown.append(m2)
                    maps = grown
                    for m in maps:
                        runs.add(tuple(_map(p, r, t, tuple((s, m[s]) for s in _shapes([r]))) for r in sol[a : b + 1]))
    runs = sorted(runs)
    lib = torch.zeros(len(runs), MAXRUN, 8, dtype=torch.uint8)
    for i, run in enumerate(runs):
        lib[i, : len(run)] = torch.tensor(run)
    return lib.to(dev), torch.tensor([len(r) for r in runs], device=dev)


def inject(pop, lib, lens, rate, keep):
    """Write a random run of the library at a random place in a share (rate) of the rule lists,
    except the first keep (the elites)."""
    B, K = pop.shape[:2]
    rows = torch.rand(B, device=dev) < rate
    rows[:keep] = False
    c = torch.randint(len(lib), (B,), device=dev)
    n = lens[c]
    k0 = (torch.rand(B, device=dev) * (K - n + 1).clamp(min=1)).long()
    j = torch.arange(K, device=dev)[None] - k0[:, None]
    put = rows[:, None] & (j >= 0) & (j < n[:, None])
    take = lib[c[:, None], j.clamp(0, MAXRUN - 1)]
    return torch.where(put[..., None], take, pop)


if __name__ == '__main__':
    name = sys.argv[1]
    p = Puzzle(name)
    lib, lens = build(p, [x for x in levels() if x != name])
    ref = {tuple(r) for r in pack(p.json['solution'], len(p.json['solution'])).tolist()}
    singles = {tuple(r) for r in lib[lens == 1, 0].tolist()}
    print(f'{name}: {len(lib):,} runs ({len(singles):,} single rules); reference rules in the library: {len(ref & singles)} of {len(ref)}')
    for r in sorted(ref - singles):
        print('  missing', r)

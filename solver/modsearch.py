"""Template search: every module [move, rule, rule, default] for one moving piece, with copies whose
transforms (color permutation and optional mirror) map its color onto the other palette colors.
move: a copy without conditions; rule: at most one condition; default: a center change without
conditions. It solves Quilt (uv run modsearch.py quilt Qb) in about 40 seconds.
Usage: uv run modsearch.py LEVEL PIECE [copies]
"""

import itertools
import sys
import time

import torch

from ga import expand, transforms
from gpu import EMPTY, PERMS, Puzzle, dev, evaluate, piece, save, tok, unpack, unpiece, wins

name, moving = sys.argv[1], sys.argv[2]
copies = int(sys.argv[3]) if len(sys.argv) > 3 else 2
p = Puzzle(name)
s, c, _ = unpiece(tok(moving + '^'))
head = s | c << 3 | 0x80


def rule(cond=None, change=(4, 0)):
    """A packed rule of the moving piece: an optional condition (position, value), and a change."""
    q, val = cond or (4, 0)
    return [head, q, val, 4, 0, change[0], change[1], 0]


# Copies are blocked where a condition asks for a piece or an obstacle.
around = (0, 1, 2, 3, 5, 6, 7, 8)
conds = [None] + [(q, val) for q in around for val in p.vocab]
changes = [(4, x) for x in p.center_changes(s, c)] + [(q, piece(s, c, 0)) for q in around]
ok = lambda cd, ch: ch[0] == 4 or cd is None or cd[0] != ch[0] or cd[1] == EMPTY
move = torch.tensor([rule(None, ch) for ch in changes if ch[0] != 4], dtype=torch.uint8, device=dev)
default = torch.tensor([rule(None, ch) for ch in changes if ch[0] == 4], dtype=torch.uint8, device=dev)
rules = torch.tensor([rule(cd, ch) for cd in conds for ch in changes if ok(cd, ch)], dtype=torch.uint8, device=dev)

others = [x for x in p.colors if x != c]
perms = [t for t in transforms(p) if t < 6]
combos = []
for targets in itertools.permutations(others, copies):
    choices = [[t for t in perms if PERMS[t][c] == tc] for tc in targets]
    for ts in itertools.product(*choices):
        for mirrors in itertools.product((0, 6), repeat=copies):
            combos.append([t + m for t, m in zip(ts, mirrors)])
print(f'{len(move)} moves, {len(rules)} rules, {len(default)} defaults, {len(combos)} transform combinations', flush=True)

pairs = torch.cartesian_prod(torch.arange(len(rules), device=dev), torch.arange(len(rules), device=dev))
chunk, total, t0 = 1 << 20, 0, time.time()
for tc in combos:
    trans = torch.tensor(tc, dtype=torch.uint8, device=dev)
    for mv in move:
        for df in default:
            for a in range(0, len(pairs), chunk):
                pr = pairs[a : a + chunk]
                m = len(pr)
                base = torch.stack([mv.expand(m, 8), rules[pr[:, 0]], rules[pr[:, 1]], df.expand(m, 8)], 1)
                full = expand(base, trans.expand(m, copies), 0, 4)
                o = evaluate(p, full)
                total += m
                win = wins(p, o)
                if bool(win.any()):
                    i = int(win.nonzero()[0])
                    print(f'solved after {total:,} rule lists in {time.time() - t0:.0f} s → {save(p, unpack(full[i]))}')
                    sys.exit()
    print(f'transforms {tc}: {total:,} rule lists, {time.time() - t0:.0f} s', flush=True)
print('no solution in this template')

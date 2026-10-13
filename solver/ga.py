"""Genetic search for rule lists that solve a level, on the GPU.

Each generation evaluates the population and breeds the next one (kernels.cu). What makes it
work:
- Niching: only the few fittest rule lists of each distinct final board keep their fitness, so the
  population does not collapse onto one behavior.
- Free capacity: the search uses 16 rule slots; a win counts when at most the level's limit of
  rules fire, and the rules that never fire are dropped.
- Restarts: a fresh population when the best fitness stalls.
- Structure (optional): free rules, a module, and copies of the module, each copy with a color
  permutation and an optional left-right mirror that evolve with it.
- Motif library (optional, library.py): a few children each generation get a run of rules from
  another level's solution, recolored, mirrored, or with other shapes.

Usage: uv run ga.py [--seconds 60] [--struct F,M,C] [--library] [levels...]   (solutions go to out/)
"""

import argparse
import json
import time

import torch

import library
from gpu import PERIOD, PERMS, Puzzle, breed, dev, evaluate, levels, piece, random_lists, save, unpack, unpiece, wins

TOUR, CX, MUT2 = 3, 0.3, 0.5  # tournament size, crossover and second-mutation chances
ELITE, IMM = 1 / 32, 1 / 32  # shares of the population kept unchanged and replaced by random lists
SLOTS, NICHE, RESTART = 16, 4, 400  # free rule slots, lists kept per final board, stalled generations
LIB = 0.1  # share of the children that get a run of the motif library


def fitness(o, n, rules, limit):
    """Final matches, the best matches at any step, and target stability; fewer active rules; a
    penalty for each fired rule beyond the limit."""
    active = (rules[..., 0] >> 7).sum(1)
    fit = (o['fin'] + 0.3 * o['best'] + 0.5 * o['stable']) / n - 0.02 * active / rules.shape[1]
    return fit - 0.5 * (o['nfired'] - limit).clamp(min=0)


def niche(fit, h, m):
    """Push all but the m fittest rule lists of each final board (hash h) to the bottom."""
    order = torch.argsort(fit, descending=True)
    idx = order[torch.argsort(h[order], stable=True)]
    hs = h[idx]
    rank = torch.empty_like(idx)
    rank[idx] = torch.arange(len(hs), device=dev) - torch.searchsorted(hs, hs)
    return fit - (rank >= m).float() * 100


def _transform_byte(t, i, v):
    """Byte i of a packed rule under transform t. A mirror swaps the left and right columns, turns
    each direction d to -d, and the turn to -turn. Valid rules stay valid."""
    perm, mirror = PERMS[t % 6], t >= 6
    if i == 0:
        c, turn = v >> 3 & 3, v >> 5 & 3
        if c < 3:
            v = v & ~0x18 | perm[c] << 3
        if mirror:
            v = v & ~0x60 | -turn % 4 << 5
    elif i in (1, 3, 5) and mirror and v < 9:
        v += 2 - 2 * (v % 3)
    elif i in (2, 4, 6) and 1 <= v <= 96:
        s, c, d = unpiece(v)
        v = piece(s, perm[c], -d % 4 % PERIOD[s] if mirror else d)
    return v


XF = torch.tensor([[[_transform_byte(t, i, v) for v in range(256)] for i in range(8)] for t in range(12)],
                  dtype=torch.uint8, device=dev)
BYTE = torch.arange(8, device=dev)


def transforms(p):
    """The transforms that keep the puzzle's colors."""
    return [t for t in range(12) if {PERMS[t % 6][c] for c in p.colors} == set(p.colors)]


def expand(base, trans, F, M):
    """Base lists (B, F + M, 8) and transforms (B, C) -> free rules, module, transformed copies."""
    copies = XF[trans.long()[:, :, None, None], BYTE, base[:, None, F : F + M].long()]
    return torch.cat([base, copies.flatten(1, 2)], 1)


def run(p, seconds=60, B=16384, seed=0, struct=None, lib=None):
    """Search for a winning rule list; lib: a motif library (library.build). Returns (info, rules or
    None)."""
    torch.manual_seed(seed)
    rng = torch.Generator().manual_seed(seed)
    new_seed = lambda: int(torch.randint(1 << 62, (1,), generator=rng))
    limit = p.max_rules
    F, M, C = struct or (SLOTS, 0, 0)
    K = F + M
    allowed = torch.tensor(transforms(p), device=dev)
    random_trans = lambda: allowed[torch.randint(len(allowed), (B, C), device=dev)]
    trans = random_trans()
    parent = torch.empty(B, dtype=torch.int32, device=dev)
    pact = min(1.0, 2 / K)
    pop = random_lists(p, B, K, pact, new_seed())
    ne, ni = int(B * ELITE), int(B * IMM)
    elite = torch.full((B,), -1, dtype=torch.int32, device=dev)
    imm = torch.zeros(B, dtype=torch.uint8, device=dev)
    imm[ne : ne + ni] = 1
    t0, gen, restarts, best_seen, last_up = time.time(), 0, 0, -1e9, 0
    while time.time() - t0 < seconds:
        full = expand(pop, trans, F, M) if C else pop
        o = evaluate(p, full)
        fit = fitness(o, p.n, full, limit)
        if gen % 4 == 0:
            win = wins(p, o) & (o['nfired'] <= limit)
            if bool(win.any()):
                b = int(win.nonzero()[0])
                # Rules that never fire in a winning run seldom matter: drop them, if it still wins.
                fired = int(o['fired'][b])
                row = full[b, [k for k in range(full.shape[1]) if fired >> k & 1]]
                if bool(wins(p, evaluate(p, row[None]))[0]):
                    return dict(solved=True, sec=round(time.time() - t0, 2), gen=gen, restarts=restarts), unpack(row)
            top = float(fit.max())
            if top > best_seen + 1e-6:
                best_seen, last_up = top, gen
            elif gen - last_up > RESTART:
                pop, trans = random_lists(p, B, K, pact, new_seed()), random_trans()
                best_seen, last_up, restarts = -1e9, gen, restarts + 1
                continue
        fit = niche(fit, o['hash'], NICHE)
        elite[:ne] = torch.argsort(fit, descending=True)[:ne]
        pop = breed(p, pop, fit, elite, imm, TOUR, CX, MUT2, pact, new_seed(), parent)
        if lib:
            pop = library.inject(pop, *lib, LIB, ne)
        if C:
            # Transforms follow the first parent; immigrants get new ones; a few mutate.
            fresh, pi = random_trans(), parent.long()
            trans = torch.where((pi >= 0)[:, None], trans[pi.clamp(min=0)], fresh)
            trans = torch.where((torch.rand(B, C, device=dev) < 0.05) & (elite < 0)[:, None], fresh, trans)
        gen += 1
    return dict(solved=False, sec=seconds, gen=gen, restarts=restarts, best=round(float(o['fin'].max()) / p.n, 3)), None


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    a.add_argument('levels', nargs='*')
    a.add_argument('--seconds', type=float, default=60)
    a.add_argument('--pop', type=int, default=16384)
    a.add_argument('--seed', type=int, default=0)
    a.add_argument('--struct', type=str, default='', help='F,M,C: F free rules, an M-rule module, C transformed copies')
    a.add_argument('--library', action='store_true', help="use runs of the other levels' solutions")
    o = a.parse_args()
    struct = [int(x) for x in o.struct.split(',')] if o.struct else None
    for name in o.levels or levels():
        p = Puzzle(name)
        lib = library.build(p, [x for x in levels() if x != name]) if o.library else None
        info, rules = run(p, o.seconds, o.pop, o.seed, struct=struct, lib=lib)
        print(name, json.dumps(info), f'→ {save(p, rules)}' if rules else '', flush=True)

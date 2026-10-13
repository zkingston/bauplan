"""The GPU side of the solver: puzzles, packed rule lists, and the CUDA kernels.

A rule list is K rules of 8 bytes (see kernels.cu). The kernels compile on first use with nvcc.
"""

import ctypes
import json
import os
import shutil
import subprocess
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / 'web' / 'src' / 'data'
OUT = ROOT / 'out'
dev = torch.device('cuda')

SHAPES, COLORS, DIRS = 'SQTLCDHW', 'bry', '^>v<'
PERIOD = [1, 4, 4, 2, 1, 4, 2, 4]
CUT_FROM = [-1, 0, 1, 1, 0, 4, 0, 6]
EMPTY, OBSTACLE = 0, 255
# Color permutations; a transform t is PERMS[t % 6] and a left-right mirror if t >= 6.
PERMS = [[0, 1, 2], [1, 2, 0], [2, 0, 1], [1, 0, 2], [0, 2, 1], [2, 1, 0]]


def piece(s, c, d):
    return 1 + 12 * s + 4 * c + d


def unpiece(v):
    return (v - 1) // 12, (v - 1) % 12 // 4, (v - 1) % 4


def tok(t):
    if t == '...':
        return EMPTY
    if t == '###':
        return OBSTACLE
    return piece(SHAPES.index(t[0]), COLORS.index(t[1]), DIRS.index(t[2]))


def untok(v):
    if v == EMPTY:
        return '...'
    if v == OBSTACLE:
        return '###'
    s, c, d = unpiece(v)
    return SHAPES[s] + COLORS[c] + DIRS[d]


def levels():
    return json.loads((DATA / 'levels.json').read_text())


class Puzzle:
    def __init__(self, name):
        self.name = name
        self.json = j = json.loads((DATA / 'puzzles' / f'{name}.json').read_text())
        self.w, self.h = j['w'], j['h']
        self.n = self.w * self.h
        self.start = [tok(t) for row in j['start'] for t in row.split()]
        self.target = [tok(t) for row in j['target'] for t in row.split()]
        pal = j['palette']
        self.shapes = [SHAPES.index(x) for x in pal['shapes']]
        self.colors = [COLORS.index(x) for x in pal['colors']]
        self.centers = [(s, c) for s in self.shapes for c in self.colors]
        self.max_rules, self.max_conds = j['limits']['rules'], j['limits']['conds']
        obstacle = 'obstacle' in pal.get('tools', ['obstacle'])
        self.pieces = [piece(s, c, d) for s, c in self.centers for d in range(PERIOD[s])]
        self.vocab = [EMPTY] + ([OBSTACLE] if obstacle else []) + self.pieces

    def center_changes(self, s, c):
        """The changes of a center piece (s, c) that a rule can make: remove, recolor, a quarter
        turn, or a cut to a child shape (the directions that the parent's symmetry allows)."""
        out = [EMPTY] + [piece(s, c2, 0) for c2 in self.colors if c2 != c]
        out += [piece(s, c, d) for d in ([1, 3] if PERIOD[s] == 4 else [1] if PERIOD[s] == 2 else [])]
        for s2 in self.shapes:
            if CUT_FROM[s2] == s:
                out += [piece(s2, c, d) for d in sorted({k % PERIOD[s2] for k in range(0, 4, PERIOD[s])})]
        return out


# Rule bytes: 0 = s | c << 3 | turn << 5 | active << 7, 1/2 and 3/4 = condition position/value,
# 5/6 = change position/value. Positions are 3x3 indices; 4 is the center or no condition.


def pack(rules, K):
    """Rule dicts -> (K, 8) uint8 (unused slots are zero; for evaluation, not for breeding)."""
    out = torch.zeros(K, 8, dtype=torch.uint8)
    for k, r in enumerate(rules):
        cond, chg = ' '.join(r['condition']).split(), ' '.join(r['change']).split()
        s, c, _ = unpiece(tok(cond[4]))
        row = [s | c << 3 | r.get('turn', 0) << 5 | 0x80, 4, 0, 4, 0, 4, 0, 0]
        conds = [(i, tok(t)) for i, t in enumerate(cond) if i != 4 and t != '---']
        for j, (i, v) in enumerate(conds):
            row[1 + 2 * j], row[2 + 2 * j] = i, v
        x = next(i for i, t in enumerate(chg) if t != '---')
        row[5], row[6] = x, tok(chg[x])
        out[k] = torch.tensor(row)
    return out.to(dev)


def unpack(row):
    """(K, 8) packed rules -> rule dicts of the active rules."""
    out = []
    for r in row.tolist():
        if not r[0] >> 7:
            continue
        cond, chg = ['---'] * 9, ['---'] * 9
        cond[4] = untok(piece(r[0] & 7, (r[0] >> 3) & 3, 0))
        for j in range(2):
            if r[1 + 2 * j] != 4:
                cond[r[1 + 2 * j]] = untok(r[2 + 2 * j])
        chg[r[5]] = untok(r[6])
        rows = lambda t: [' '.join(t[i : i + 3]) for i in (0, 3, 6)]
        rule = {'condition': rows(cond), 'change': rows(chg)}
        if (r[0] >> 5) & 3:
            rule['turn'] = (r[0] >> 5) & 3
        out.append(rule)
    return out


def _load(name):
    """Compile name.cu with nvcc (when the library is missing or older) and load it."""
    src, lib = ROOT / f'{name}.cu', ROOT / 'build' / f'lib{name}.so'
    if not lib.exists() or lib.stat().st_mtime < src.stat().st_mtime:
        lib.parent.mkdir(exist_ok=True)
        nvcc = shutil.which('nvcc') or next(p for p in ('/opt/cuda/bin/nvcc', '/usr/local/cuda/bin/nvcc') if os.path.exists(p))
        major, minor = torch.cuda.get_device_capability()
        tmp = lib.with_suffix('.tmp')
        subprocess.run([nvcc, '-O3', f'-arch=sm_{major}{minor}', '-shared', '-Xcompiler', '-fPIC', '-o', tmp, src], check=True)
        tmp.rename(lib)
    return ctypes.CDLL(str(lib))


_lib = _load('kernels')
P = ctypes.c_void_p
U8 = ctypes.c_uint8
MAXV = 96


class Tables(ctypes.Structure):
    """The puzzle tables of kernels.cu."""

    _fields_ = [('nv', ctypes.c_int), ('ntv', ctypes.c_int), ('w', ctypes.c_int),
                ('vlist', U8 * MAXV), ('tids', U8 * MAXV),
                ('start', ctypes.c_uint64 * MAXV), ('target', ctypes.c_uint64 * MAXV),
                ('vabs', (U8 * 256) * 4), ('shift', (ctypes.c_int8 * 9) * 4),
                ('ncen', ctypes.c_int), ('nvocab', ctypes.c_int), ('maxc', ctypes.c_int),
                ('period', U8 * 8), ('cen', U8 * 24), ('vocab', U8 * 128),
                ('nopt', (U8 * 3) * 8), ('opt', ((U8 * 16) * 3) * 8)]


def _tables(p):
    t = Tables()
    # Compact ids of the tile values that can occur, and the boards as a bit mask per id.
    vals = [EMPTY] + sorted((set(p.start) | set(p.target) | set(p.pieces)) - {EMPTY})
    ids = {v: i for i, v in enumerate(vals)}
    t.nv, t.w = len(vals), p.w
    t.vlist[: len(vals)] = vals
    for board, masks in ((p.start, t.start), (p.target, t.target)):
        for i, v in enumerate(board):
            masks[ids[v]] |= 1 << (i // p.w * 8 + i % p.w)
    tids = sorted({ids[v] for v in p.target})
    t.ntv = len(tids)
    t.tids[: len(tids)] = tids
    # In frame f (a quarter turn f times): picture values, and the board offsets of positions.
    for f in range(4):
        for v in range(256):
            a = v
            if 1 <= v <= 96:
                s, c, d = unpiece(v)
                a = piece(s, c, (f + d) % 4 % PERIOD[s])
            t.vabs[f][v] = ids.get(a, 255)
        for q in range(9):
            dy, dx = q // 3 - 1, q % 3 - 1
            for _ in range(f):
                dy, dx = dx, -dy
            t.shift[f][q] = dy * 8 + dx
    # Breeding: centers, condition values, and center changes.
    t.ncen, t.nvocab, t.maxc = len(p.centers), len(p.vocab), p.max_conds
    t.period[:] = PERIOD
    t.cen[: len(p.centers)] = [s | c << 3 for s, c in p.centers]
    t.vocab[: len(p.vocab)] = p.vocab
    for s, c in p.centers:
        opts = p.center_changes(s, c)
        t.nopt[s][c] = len(opts)
        t.opt[s][c][: len(opts)] = opts
    return t


_current = None


def _use(p):
    global _current
    if _current is not p:
        assert _lib.set_tables(ctypes.byref(_tables(p))) == 0
        _current = p


def _stream():
    return P(torch.cuda.current_stream().cuda_stream)


def evaluate(p, rules, steps=100):
    """Run each packed rule list (B, K, 8) on the puzzle. Returns a dict of (B,) tensors: fin, best,
    stable (tiles equal to the target), settled (255: never), hash, fired (rule mask), nfired."""
    _use(p)
    B, K = rules.shape[:2]
    out = torch.empty(B, 3, dtype=torch.int32, device=dev)
    assert _lib.evaluate(P(rules.data_ptr()), P(out.data_ptr()), B, K, steps, _stream()) == 0
    o = out.view(torch.uint8).long()
    return dict(fin=o[:, 0], best=o[:, 1], stable=o[:, 2], settled=o[:, 3], hash=out[:, 1],
                fired=o[:, 8] | o[:, 9] << 8, nfired=o[:, 10])


def wins(p, o):
    return (o['fin'] == p.n) & (o['stable'] == p.n)


def random_lists(p, B, K, pact, seed):
    """B random rule lists of K valid rules; each rule is active with probability pact."""
    _use(p)
    R = torch.empty(B, K, 8, dtype=torch.uint8, device=dev)
    assert _lib.random_lists(P(R.data_ptr()), B, K, ctypes.c_float(pact), ctypes.c_ulonglong(seed), _stream()) == 0
    return R


def breed(p, pop, fit, elite, imm, tour, cx, mut2, pact, seed, parent=None):
    """The next generation (see kernels.cu)."""
    _use(p)
    B, K = pop.shape[:2]
    out = torch.empty_like(pop)
    fit = fit.float().contiguous()
    assert _lib.breed_lists(P(pop.data_ptr()), P(fit.data_ptr()), P(elite.data_ptr()), P(imm.data_ptr()),
                            P(out.data_ptr()), B, K, tour, ctypes.c_float(cx), ctypes.c_float(mut2),
                            ctypes.c_float(pact), ctypes.c_ulonglong(seed),
                            P(parent.data_ptr()) if parent is not None else None, _stream()) == 0
    return out


def save(p, rules):
    """Write a solution to out/<level>.<rules>.json."""
    OUT.mkdir(exist_ok=True)
    path = OUT / f'{p.name}.{len(rules)}.json'
    path.write_text(json.dumps(rules, indent=2) + '\n')
    return path

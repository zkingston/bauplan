"""Check the GPU kernels against the game's engine.

For each level: random and bred rule lists (all from the breeding kernel, so this also checks that
its rules are valid in the engine), scored on the GPU and by the engine (check.ts), must agree on
every reported number; and the level's reference solution must win on the GPU.
Usage: uv run check.py [cases per level]
"""

import json
import subprocess
import sys
import tempfile

import torch

from gpu import ROOT, Puzzle, breed, dev, evaluate, levels, pack, random_lists, unpack, wins

per = int(sys.argv[1]) if len(sys.argv) > 1 else 128
FIELDS = ('fin', 'best', 'stable', 'settled', 'fired')
imm = torch.zeros(per, dtype=torch.uint8, device=dev)
elite = torch.full((per,), -1, dtype=torch.int32, device=dev)
cases, gpu, losers = [], [], []
for name in levels():
    p = Puzzle(name)
    for K in (6, 12, 16):
        pop = random_lists(p, per, K, 0.6, K)
        # A few generations of breeding with random fitness: crossover and every mutation kind.
        for g in range(5):
            pop = breed(p, pop, torch.rand(per, device=dev), elite, imm, 3, 0.5, 0.5, 0.6, 100 * K + g)
        o = evaluate(p, pop)
        active = (pop[..., 0] >> 7).tolist()
        for b in range(per):
            cases.append({'level': name, 'rules': unpack(pop[b]), 'slots': [k for k in range(K) if active[b][k]]})
        gpu += torch.stack([o[f] for f in FIELDS], 1).tolist()
    if not bool(wins(p, evaluate(p, pack(p.json['solution'], 16)[None]))[0]):
        losers.append(name)

with tempfile.NamedTemporaryFile('w', suffix='.json') as f:
    json.dump(cases, f)
    f.flush()
    engine = json.loads(subprocess.run(['node', str(ROOT / 'check.ts'), f.name], capture_output=True, text=True, check=True).stdout)
bad = [(c['level'], g, e) for c, g, e in zip(cases, gpu, engine) if g != e]
for level, g, e in bad[:5]:
    print('MISMATCH', level, 'gpu', g, 'engine', e)
print(f'{len(cases) - len(bad)} of {len(cases)} rule lists agree with the engine')
print(f'reference solutions that do not win: {", ".join(losers) or "none"}')
sys.exit(1 if bad or losers else 0)

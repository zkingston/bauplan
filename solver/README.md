# Solver

GPU search for rule lists that solve bauplan levels. It needs an NVIDIA GPU, the CUDA toolkit
(`nvcc`), and [uv](https://docs.astral.sh/uv/). The kernels compile on first use.

```sh
cd solver
uv run ga.py --seconds 60 frame contour        # search; solutions go to out/
uv run ga.py --library --struct 8,4,1 phoenix  # with other levels' rules and a module + copy
uv run modsearch.py quilt Qb                   # template search over rule modules (Quilt)
uv run check.py                                # the kernels against the game's engine
```

| File                   | What it does                                                               |
| ---------------------- | -------------------------------------------------------------------------- |
| `kernels.cu`           | Runs rule lists (one warp per list, the board as bitmasks) and breeds them |
| `gpu.py`               | Puzzles, packed rule lists, and the kernel tables and calls                |
| `ga.py`                | The genetic search: niching, free rule slots, restarts, structured copies  |
| `library.py`           | Runs of rules from the other levels' solutions, mapped to a level          |
| `modsearch.py`         | Exhaustive search over one template of rule modules                        |
| `check.py`, `check.ts` | Compare the GPU results with the engine                                    |

The GA solves 28 of the 30 levels within 30 s each (most in under a second). The other two need
a structured genome and `--library`, which writes runs of rules from the other levels' solutions
(recolored, mirrored, or with other shapes) into a few children each generation: Quilt with
`--struct 4,4,2` (under a second), Phoenix with `--struct 8,4,1` (5–76 s).

// The solver's kernels, for one puzzle at a time (set_tables): evaluation of rule lists, one warp
// per list with all steps on the chip, and breeding of the next generation, one thread per child.
//
// Rule bytes: 0 = s | c << 3 | turn << 5 | active << 7, 1 = condition position, 2 = its value,
// 3 = second condition position, 4 = its value, 5 = change position, 6 = written value, 7 unused.
// Positions are 3x3 indices in the frame of the center piece (4 = the center, or no condition).
// Values: 0 empty, 1..96 pieces (1 + 12 s + 4 c + d, d relative to the frame), 255 obstacle.
#include <cstdint>
#include <cuda_runtime.h>

#define MAXK 16
#define MAXV 96
#define MAXOPT 16
#define EMPTY 0
#define WARPS 4
#define FULL 0xffffffffu

// The puzzle, from gpu.py.
struct Tables {
  // Evaluation: compact ids of the tile values that can occur.
  int nv, ntv, w;
  uint8_t vlist[MAXV];     // compact id -> tile value
  uint8_t tids[MAXV];      // the ids in the target
  uint64_t start[MAXV];    // start mask of each id
  uint64_t target[MAXV];   // target mask of each id
  uint8_t vabs[4][256];    // compact id of picture value v in frame f (255: cannot occur)
  int8_t shift[4][9];      // bit shift of frame position p in frame f
  // Breeding: the centers (s | c << 3), the condition values, and the center changes of each
  // center (remove, recolor, quarter turn, cut).
  int ncen, nvocab, maxc;
  uint8_t period[8];
  uint8_t cen[24];
  uint8_t vocab[128];
  uint8_t nopt[8][3];
  uint8_t opt[8][3][MAXOPT];
};
__device__ Tables TB;

extern "C" int set_tables(const Tables* t) { return (int)cudaMemcpyToSymbol(TB, t, sizeof(Tables)); }

// ---- Evaluation ----
//
// The board is a 64-bit mask per tile value, in shared memory (bit y * 8 + x; column 7 stays
// empty, so a shift by one column never wraps into the next row). Lane l owns rule-frames 2l and
// 2l + 1 (rule k = e / 4, frame order e % 4), compiled into registers. In a step, each lane matches
// its rule-frames across the whole board at once. A prefix OR over the lanes, in priority order,
// removes the tiles that an earlier rule-frame took. Copies that put different values on one tile
// block each other. The writes are shared-memory atomics.
//
// Output, 12 bytes per rule list: 0 tiles equal to the target at the end, 1 the most tiles equal at
// any step, 2 tiles of the target that one step keeps, 3 the step at which the board stopped
// changing (255 if it did not), 4..7 a hash of the final board, 8..9 a mask of the rules that
// fired, 10 their number. A win: byte 0 and byte 2 both equal the number of tiles.

// One rule in one frame: compact ids (-1 for none) and bit shifts (read tile t + s).
struct Entry {
  int cen, c0, c1, wid;
  int s0, s1, sx;
  bool valid, copy;
};

__device__ __forceinline__ uint64_t sh(uint64_t m, int s) { return s >= 0 ? m >> s : m << -s; }
__device__ __forceinline__ uint64_t unsh(uint64_t m, int s) { return s >= 0 ? m << s : m >> -s; }

__device__ Entry compile(const uint8_t* R, int K, int e) {
  Entry x = {-1, -1, -1, -1, 0, 0, 0, false, false};
  int k = e >> 2, o = e & 3;
  if (k >= K) return x;
  const uint8_t* r = R + k * 8;
  if (!(r[0] >> 7)) return x;
  int turn = r[0] >> 5 & 3;
  int f = (turn + (0x3120 >> 4 * o & 3)) & 3;  // frame order: as shown, opposite, right, left
  const uint8_t* V = TB.vabs[f];
  const int8_t* S = TB.shift[f];
  x.cen = V[1 + 12 * (r[0] & 7) + 4 * (r[0] >> 3 & 3)];
  if (x.cen == 255) return x;
  if (r[1] != 4) {
    x.c0 = V[r[2]];
    x.s0 = S[r[1]];
    if (x.c0 == 255) return x;
  }
  if (r[3] != 4) {
    x.c1 = V[r[4]];
    x.s1 = S[r[3]];
    if (x.c1 == 255) return x;
  }
  if (r[5] == 4) {
    x.wid = V[r[6]];
    if (x.wid == 255) return x;
  } else {
    x.copy = true;
    x.wid = x.cen;
    x.sx = S[r[5]];
  }
  x.valid = true;
  return x;
}

__device__ __forceinline__ uint64_t raw_match(const uint64_t* M, const Entry& e) {
  if (!e.valid) return 0;
  uint64_t m = M[e.cen];
  if (e.c0 >= 0) m &= sh(M[e.c0], e.s0);
  if (e.c1 >= 0) m &= sh(M[e.c1], e.s1);
  if (e.copy) m &= sh(M[EMPTY], e.sx);
  return m;
}

// One step of the warp's board. Returns whether any rule fired (the same in all lanes).
__device__ bool step(uint64_t* M, const Entry& e0, const Entry& e1, int lane, uint32_t& fired) {
  uint64_t m0 = raw_match(M, e0), m1 = raw_match(M, e1);
  // Prefix OR of the earlier lanes' matches: the union of the earlier raw matches equals the
  // union of the earlier final matches.
  uint64_t inc = m0 | m1;
  for (int d = 1; d < 32; d <<= 1) {
    uint64_t v = __shfl_up_sync(FULL, inc, d);
    if (lane >= d) inc |= v;
  }
  uint64_t before = __shfl_up_sync(FULL, inc, 1);
  if (lane == 0) before = 0;
  uint64_t a0 = m0 & ~before, a1 = m1 & ~(before | m0);
  // Copy targets. A tile with two of them (rare): more targets than target tiles.
  uint64_t t0 = e0.copy ? unsh(a0, e0.sx) : 0, t1 = e1.copy ? unsh(a1, e1.sx) : 0;
  int n = __reduce_add_sync(FULL, __popcll(t0) + __popcll(t1));
  uint64_t u = t0 | t1;
  if (n > __popc(__reduce_or_sync(FULL, (uint32_t)u)) + __popc(__reduce_or_sync(FULL, u >> 32))) {
    // Each lane compares its targets with every target of another value.
    uint64_t conflict = 0;
    for (int j = 0; j < 2; j++) {
      uint64_t tj = j ? t1 : t0;
      int wj = j ? e1.wid : e0.wid;
      for (unsigned bits = __ballot_sync(FULL, tj != 0); bits; bits &= bits - 1) {
        int l = __ffs(bits) - 1;
        uint64_t tl = __shfl_sync(FULL, tj, l);
        int wl = __shfl_sync(FULL, wj, l);
        if (e0.wid != wl) conflict |= t0 & tl;
        if (e1.wid != wl) conflict |= t1 & tl;
      }
    }
    if (e0.copy) a0 &= ~sh(conflict, e0.sx);
    if (e1.copy) a1 &= ~sh(conflict, e1.sx);
  }
  __syncwarp();
  // Center changes and copies touch different tiles, so the order of the writes does not matter.
  unsigned long long* U = reinterpret_cast<unsigned long long*>(M);
  if (a0) {
    uint64_t t = e0.copy ? unsh(a0, e0.sx) : a0;
    atomicAnd(&U[e0.copy ? EMPTY : e0.cen], ~t);
    atomicOr(&U[e0.wid], t);
  }
  if (a1) {
    uint64_t t = e1.copy ? unsh(a1, e1.sx) : a1;
    atomicAnd(&U[e1.copy ? EMPTY : e1.cen], ~t);
    atomicOr(&U[e1.wid], t);
  }
  if (a0 | a1) fired |= 1u << (lane >> 1);
  __syncwarp();
  return __any_sync(FULL, (a0 | a1) != 0);
}

__global__ void run(const uint8_t* __restrict__ rules, uint8_t* __restrict__ out, int B, int K,
                    int steps) {
  __shared__ uint64_t Ms[WARPS][MAXV];
  int lane = threadIdx.x & 31, g = blockIdx.x * WARPS + (threadIdx.x >> 5);
  if (g >= B) return;
  uint64_t* M = Ms[threadIdx.x >> 5];
  const uint8_t* R = rules + (size_t)g * K * 8;
  Entry e0 = compile(R, K, 2 * lane), e1 = compile(R, K, 2 * lane + 1);
  int nv = TB.nv, ntv = TB.ntv;
  // Each lane counts the tiles of up to three target values.
  int ti[3];
  uint64_t tm[3];
#pragma unroll
  for (int j = 0; j < 3; j++) {
    int i = lane + 32 * j;
    ti[j] = i < ntv ? TB.tids[i] : EMPTY;
    tm[j] = i < ntv ? TB.target[ti[j]] : 0;
  }
  auto matches = [&] {
    int c = 0;
#pragma unroll
    for (int j = 0; j < 3; j++)
      if (32 * j < ntv) c += __popcll(M[ti[j]] & tm[j]);
    return __reduce_add_sync(FULL, c);
  };

  for (int i = lane; i < nv; i += 32) M[i] = TB.start[i];
  __syncwarp();
  int best = matches(), settled = 255;
  uint32_t fired = 0;
  for (int t = 0; t < steps; t++) {
    if (!step(M, e0, e1, lane, fired)) {
      settled = t;
      break;
    }
    best = max(best, matches());
  }
  int fin = matches();
  // Hash of the final board: a sum of mixed (value, position) terms, one per tile.
  uint32_t hash = 0;
  for (int id = lane; id < nv; id += 32)
    for (uint64_t m = M[id]; m; m &= m - 1) {
      int b = __ffsll(m) - 1;
      uint32_t h = TB.vlist[id] * 0x9E3779B1u + ((b >> 3) * TB.w + (b & 7)) * 0x85EBCA77u;
      h ^= h >> 15;
      h *= 0x2C1B3C6Du;
      h ^= h >> 12;
      h *= 0x297A2D39u;
      h ^= h >> 15;
      hash += h;
    }
  hash = __reduce_add_sync(FULL, hash);
  fired = __reduce_or_sync(FULL, fired);
  // Stability: one step from the target.
  __syncwarp();
  for (int i = lane; i < nv; i += 32) M[i] = TB.target[i];
  __syncwarp();
  uint32_t ignored = 0;
  step(M, e0, e1, lane, ignored);
  int stable = matches();
  if (lane == 0) {
    uint8_t* o = out + (size_t)g * 12;
    o[0] = fin;
    o[1] = best;
    o[2] = stable;
    o[3] = settled;
    *reinterpret_cast<uint32_t*>(o + 4) = hash;
    *reinterpret_cast<uint16_t*>(o + 8) = fired;
    o[10] = __popc(fired);
    o[11] = 0;
  }
}

extern "C" int evaluate(const uint8_t* rules, uint8_t* out, int B, int K, int steps,
                        cudaStream_t stream) {
  if (K > MAXK) return -1;
  run<<<(B + WARPS - 1) / WARPS, WARPS * 32, 0, stream>>>(rules, out, B, K, steps);
  return (int)cudaGetLastError();
}

// ---- Breeding ----
//
// Tournament selection, per-rule crossover, one or two mutations, elites, and random immigrants.
// Every rule it writes is valid for the puzzle.

struct Rng {
  uint64_t s;
  __device__ Rng(uint64_t seed, int i) : s(seed ^ 0x9E3779B97F4A7C15ull * (uint64_t)(i + 1)) {
    for (int w = 0; w < 4; w++) next();
  }
  __device__ uint32_t next() {
    s ^= s << 13;
    s ^= s >> 7;
    s ^= s << 17;
    return (uint32_t)(s >> 16);
  }
  __device__ int below(int n) { return (int)((uint64_t)next() * n >> 32); }
  __device__ float unit() { return next() * (1.0f / 4294967296.0f); }
};

// A valid change for the rule's center and conditions: a center change, or a copy to a neighbor
// where no condition asks for a piece or an obstacle.
__device__ void sample_change(uint8_t* r, Rng& g) {
  int s = r[0] & 7, c = r[0] >> 3 & 3;
  int no = TB.nopt[s][c];
  bool copy_ok[9];
  int ncopy = 0;
  for (int q = 0; q < 9; q++) {
    copy_ok[q] = q != 4 && !(r[1] == q && r[2] != EMPTY) && !(r[3] == q && r[4] != EMPTY);
    ncopy += copy_ok[q];
  }
  int k = g.below(no + ncopy);
  if (k < no) {
    r[5] = 4;
    r[6] = TB.opt[s][c][k];
    return;
  }
  k -= no;
  for (int q = 0; q < 9; q++)
    if (copy_ok[q] && k-- == 0) {
      r[5] = q;
      r[6] = 1 + 12 * s + 4 * c;
      return;
    }
}

__device__ bool change_valid(const uint8_t* r) {
  int s = r[0] & 7, c = r[0] >> 3 & 3;
  if (r[5] == 4) {
    for (int k = 0; k < TB.nopt[s][c]; k++)
      if (TB.opt[s][c][k] == r[6]) return true;
    return false;
  }
  return r[6] == 1 + 12 * s + 4 * c && !(r[1] == r[5] && r[2] != EMPTY) &&
         !(r[3] == r[5] && r[4] != EMPTY);
}

__device__ void random_cond(uint8_t* r, int j, Rng& g) {
  int q = g.below(8);
  r[1 + 2 * j] = q >= 4 ? q + 1 : q;
  r[2 + 2 * j] = TB.vocab[g.below(TB.nvocab)];
}

// At most maxc conditions, at different positions.
__device__ void fix_conds(uint8_t* r) {
  if (TB.maxc < 2) r[3] = 4;
  if (TB.maxc < 1) r[1] = 4;
  if (r[3] != 4 && r[3] == r[1]) r[3] = 4;
}

__device__ int random_turn(int ci, Rng& g) { return TB.period[ci & 7] < 4 ? g.below(4) : 0; }

__device__ void random_rule(uint8_t* r, Rng& g, bool active) {
  int ci = TB.cen[g.below(TB.ncen)];
  r[0] = ci | random_turn(ci, g) << 5 | (active ? 0x80 : 0);
  r[1] = r[3] = 4;
  r[2] = r[4] = 0;
  int nc = g.below(TB.maxc + 1);
  for (int j = 0; j < nc; j++) random_cond(r, j, g);
  fix_conds(r);
  sample_change(r, g);
  r[7] = 0;
}

// One mutation of rule list L (K rules), in place.
__device__ void mutate(uint64_t* L, int K, Rng& g) {
  int k = g.below(K);
  uint8_t* r = reinterpret_cast<uint8_t*>(L + k);
  switch (g.below(8)) {
    case 0:  // a new rule
      random_rule(r, g, true);
      return;
    case 1: {  // a new center
      int ci = TB.cen[g.below(TB.ncen)];
      int turn = TB.period[ci & 7] < 4 ? r[0] >> 5 & 3 : 0;
      r[0] = ci | turn << 5 | (r[0] & 0x80);
      sample_change(r, g);
      return;
    }
    case 2:  // a new condition
      if (TB.maxc == 0) return;
      random_cond(r, TB.maxc >= 2 ? g.below(2) : 0, g);
      fix_conds(r);
      break;
    case 3:  // drop a condition
      r[1 + 2 * g.below(2)] = 4;
      break;
    case 4:  // a new change
      sample_change(r, g);
      return;
    case 5:  // a new turn
      r[0] = (r[0] & ~0x60) | random_turn(r[0], g) << 5;
      return;
    case 6:  // on or off
      r[0] ^= 0x80;
      return;
    case 7: {  // swap with another rule
      int b = g.below(K);
      uint64_t t = L[k];
      L[k] = L[b];
      L[b] = t;
      return;
    }
  }
  if (!change_valid(r)) sample_change(r, g);
}

__device__ int tournament(const float* fit, int B, int tour, Rng& g) {
  int best = g.below(B);
  for (int i = 1; i < tour; i++) {
    int c = g.below(B);
    if (fit[c] > fit[best]) best = c;
  }
  return best;
}

// elite[i]: a rule list to copy unchanged into slot i (-1 for none). imm[i]: slot i gets a random
// rule list. parent[i] (if not null): the rule list that child i came from (-1 for an immigrant).
__global__ void breed(const uint64_t* __restrict__ pop, const float* __restrict__ fit,
                      const int* __restrict__ elite, const uint8_t* __restrict__ imm,
                      uint64_t* __restrict__ out, int B, int K, int tour, float cx, float mut2,
                      float pact, uint64_t seed, int* __restrict__ parent) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= B) return;
  Rng g(seed, i);
  uint64_t L[MAXK];
  int from = -1;
  if (elite[i] >= 0) {
    from = elite[i];
    for (int k = 0; k < K; k++) L[k] = pop[(size_t)from * K + k];
  } else if (imm[i]) {
    for (int k = 0; k < K; k++) random_rule(reinterpret_cast<uint8_t*>(L + k), g, g.unit() < pact);
  } else {
    from = tournament(fit, B, tour, g);
    int mate = g.unit() < cx ? tournament(fit, B, tour, g) : from;
    for (int k = 0; k < K; k++) L[k] = pop[(size_t)(g.unit() < 0.5f ? mate : from) * K + k];
    mutate(L, K, g);
    if (g.unit() < mut2) mutate(L, K, g);
  }
  for (int k = 0; k < K; k++) out[(size_t)i * K + k] = L[k];
  if (parent) parent[i] = from;
}

__global__ void randomize(uint8_t* out, int B, int K, float pact, uint64_t seed) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= B) return;
  Rng g(seed, i);
  for (int k = 0; k < K; k++) random_rule(out + ((size_t)i * K + k) * 8, g, g.unit() < pact);
}

extern "C" int breed_lists(const uint64_t* pop, const float* fit, const int* elite,
                           const uint8_t* imm, uint64_t* out, int B, int K, int tour, float cx,
                           float mut2, float pact, unsigned long long seed, int* parent,
                           cudaStream_t stream) {
  if (K > MAXK) return -1;
  breed<<<(B + 127) / 128, 128, 0, stream>>>(pop, fit, elite, imm, out, B, K, tour, cx, mut2,
                                             pact, seed, parent);
  return (int)cudaGetLastError();
}

extern "C" int random_lists(uint8_t* out, int B, int K, float pact, unsigned long long seed,
                            cudaStream_t stream) {
  if (K > MAXK) return -1;
  randomize<<<(B + 127) / 128, 128, 0, stream>>>(out, B, K, pact, seed);
  return (int)cudaGetLastError();
}

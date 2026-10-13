import type { Profile } from './profile.ts';
import type { Rule } from './rules.ts';
import { stepper } from './sim.ts';
import { EMPTY, isPiece, parseToken, tileToken } from './tile.ts';

/**
 * An unbounded board, empty outside the tiles that are set, stepped with HashLife.
 *
 * The board is a quadtree. A node of level k is a square of 2^k tiles, made of four nodes of level
 * k - 1. Each different node exists one time, so a board that repeats itself is small. A node of
 * level 0 is a tile value, and its id is that value. Other ids start at 256.
 *
 * A piece reads the 3×3 around it and changes one tile in it, so the next value of a tile depends
 * only on the tiles at most 2 away. Thus the center half of a node of level k (a margin of 2^(k-2))
 * is known 2^(k-3) steps later. A node of level 3 (8×8 tiles) gives its center 4×4 after one step
 * with the rules. A higher node gets its result from the results of its parts, and keeps it.
 *
 * Coordinates are tiles. The root node has its center at (0, 0), and it grows as the board does.
 * When there are more than `limit` nodes, the nodes that the boards do not use are removed.
 */
export function plane(prof: Profile, rules: Rule[], limit = 1 << 20) {
  let step = stepper(prof, rules);
  const LEAVES = 256;
  // The nodes, by id. `reset` makes the arrays, and `grow` makes them larger.
  let cap: number;
  let n: number;
  let kids!: Int32Array;
  let lvl!: Uint8Array;
  /** The result 2^(k-3) steps later. */
  let full!: Int32Array;
  /** The result 2^partJ steps later, for a node with k - 3 > partJ. */
  let part!: Int32Array;
  let partJ: number;
  /** The number of tiles that are not empty, and the number of pieces. */
  let filled!: Float64Array;
  let pieces!: Float64Array;
  /** A tile value that represents the node: a piece if it has one, else an obstacle or empty. */
  let rep!: Uint8Array;
  /** The hash table of the nodes: the id of a node, or 0 for an empty place. */
  let table: Int32Array;
  /** The empty node of each level. */
  let empties: number[];

  function grow(size: number) {
    const more = <T extends Int32Array | Uint8Array | Float64Array>(a: T, k = 1) => {
      const b = new (a.constructor as new (n: number) => T)(size * k);
      b.set(a);
      return b;
    };
    kids = more(kids, 4);
    lvl = more(lvl);
    full = more(full);
    part = more(part);
    filled = more(filled);
    pieces = more(pieces);
    rep = more(rep);
    full.fill(-1, cap);
    part.fill(-1, cap);
    cap = size;
  }

  const hash = (a: number, b: number, c: number, d: number) => {
    let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77);
    h ^= Math.imul(c, 0xc2b2ae3d) ^ Math.imul(d, 0x27d4eb2f);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    return h ^ (h >>> 13);
  };

  function rehash(size: number) {
    table = new Int32Array(size);
    const mask = size - 1;
    for (let id = LEAVES; id < n; id++) {
      const o = id * 4;
      let i = hash(kids[o], kids[o + 1], kids[o + 2], kids[o + 3]) & mask;
      while (table[i]) i = (i + 1) & mask;
      table[i] = id;
    }
  }

  /** Start with no nodes but the tile values. */
  function reset() {
    cap = 0;
    [kids, full, part] = [new Int32Array(), new Int32Array(), new Int32Array()];
    [lvl, rep] = [new Uint8Array(), new Uint8Array()];
    [filled, pieces] = [new Float64Array(), new Float64Array()];
    grow(1 << 16);
    for (let v = 1; v < LEAVES; v++) {
      filled[v] = 1;
      pieces[v] = isPiece(v) ? 1 : 0;
      rep[v] = v;
    }
    n = LEAVES;
    table = new Int32Array(1 << 17);
    empties = [EMPTY];
    partJ = -1;
  }
  reset();

  /** The node with these four parts (top left, top right, bottom left, bottom right). */
  function node(a: number, b: number, c: number, d: number): number {
    const mask = table.length - 1;
    let i = hash(a, b, c, d) & mask;
    for (let id = table[i]; id; id = table[(i = (i + 1) & mask)]) {
      const o = id * 4;
      if (kids[o] === a && kids[o + 1] === b && kids[o + 2] === c && kids[o + 3] === d) return id;
    }
    if (n === cap) grow(cap * 2);
    const id = n++;
    table[i] = id;
    const o = id * 4;
    kids[o] = a;
    kids[o + 1] = b;
    kids[o + 2] = c;
    kids[o + 3] = d;
    lvl[id] = lvl[a] + 1;
    filled[id] = filled[a] + filled[b] + filled[c] + filled[d];
    pieces[id] = pieces[a] + pieces[b] + pieces[c] + pieces[d];
    let r = 0;
    for (const x of [a, b, c, d]) {
      if (isPiece(rep[x])) {
        r = rep[x];
        break;
      }
      r ||= rep[x];
    }
    rep[id] = r;
    if ((n - LEAVES) * 2 > table.length) rehash(table.length * 2);
    return id;
  }

  const empty = (k: number): number => {
    while (empties.length <= k) {
      const e = empties[empties.length - 1];
      empties.push(node(e, e, e, e));
    }
    return empties[k];
  };
  const nw = (id: number) => kids[id * 4];
  const ne = (id: number) => kids[id * 4 + 1];
  const sw = (id: number) => kids[id * 4 + 2];
  const se = (id: number) => kids[id * 4 + 3];
  /** The four parts of a node, in the order of `node`. */
  const quads = (id: number) => [nw(id), ne(id), sw(id), se(id)];
  /** Half the side of a node, in tiles. */
  const halfOf = (id: number) => 2 ** (lvl[id] - 1);
  /** The center half of a node, at the same time. */
  const centre = (id: number) => node(se(nw(id)), sw(ne(id)), ne(sw(id)), nw(se(id)));
  /** A node one level up, with this node at its center. */
  const pad = (id: number) => {
    const e = empty(lvl[id] - 1);
    return node(
      node(e, e, e, nw(id)),
      node(e, e, ne(id), e),
      node(e, sw(id), e, e),
      node(se(id), e, e, e),
    );
  };

  const buf = new Uint8Array(64);
  function paint(id: number, x: number, y: number) {
    if (lvl[id] === 0) return void (buf[y * 8 + x] = id);
    const h = 1 << (lvl[id] - 1);
    paint(nw(id), x, y);
    paint(ne(id), x + h, y);
    paint(sw(id), x, y + h);
    paint(se(id), x + h, y + h);
  }
  /** The node of level k from grid g of side s, at (x, y). */
  function build(g: Uint8Array, s: number, x: number, y: number, k: number): number {
    if (k === 0) return g[y * s + x];
    const h = 1 << (k - 1);
    return node(
      build(g, s, x, y, k - 1),
      build(g, s, x + h, y, k - 1),
      build(g, s, x, y + h, k - 1),
      build(g, s, x + h, y + h, k - 1),
    );
  }

  /** The center half of node id, 2^j steps later, for j <= k - 3. */
  function result(id: number, j: number): number {
    // Without pieces, nothing changes.
    if (!isPiece(rep[id])) return centre(id);
    const k = lvl[id];
    const atFull = j === k - 3;
    const known = atFull ? full[id] : part[id];
    if (known >= 0) return known;
    let r: number;
    if (k === 3) {
      buf.fill(EMPTY);
      paint(id, 0, 0);
      r = build(step(buf, 8, 8).next, 8, 2, 2, 2);
    } else {
      const a = nw(id);
      const b = ne(id);
      const c = sw(id);
      const d = se(id);
      const parts = [
        a,
        node(ne(a), nw(b), se(a), sw(b)),
        b,
        node(sw(a), se(a), nw(c), ne(c)),
        node(se(a), sw(b), ne(c), nw(d)),
        node(sw(b), se(b), nw(d), ne(d)),
        c,
        node(ne(c), nw(d), se(c), sw(d)),
        d,
      ];
      // At full speed, both halves of the time pass in the two stages. For a shorter time, the
      // first stage only takes the centers.
      const s = parts.map((x) => (atFull ? result(x, j - 1) : centre(x)));
      const jj = atFull ? j - 1 : j;
      r = node(
        result(node(s[0], s[1], s[3], s[4]), jj),
        result(node(s[1], s[2], s[4], s[5]), jj),
        result(node(s[3], s[4], s[6], s[7]), jj),
        result(node(s[4], s[5], s[7], s[8]), jj),
      );
    }
    // A new node can grow the arrays, so set the result after.
    if (atFull) full[id] = r;
    else part[id] = r;
    return r;
  }

  let root = empty(3);
  let gen = 0;
  /** The board as the player set it, and the earlier states of the run, for a step back. */
  let start = root;
  let marks: { root: number; gen: number }[] = [];
  const MARKS = 1000;
  /** The states before the last changes of the board, for `undo`. */
  let undos: { start: number; root: number; gen: number }[] = [];
  const UNDOS = 100;
  /** Make a board the start, and the run starts from it again. */
  const begin = (board: number) => {
    start = root = board;
    gen = 0;
    marks = [];
  };

  /** Keep only the nodes of the current, start, and marked boards. Results are lost. */
  function collect() {
    const old = { kids, n };
    const map = new Int32Array(old.n).fill(-1);
    reset();
    const copy = (id: number): number => {
      if (id < LEAVES) return id;
      if (map[id] < 0) {
        const o = id * 4;
        const k = old.kids;
        map[id] = node(copy(k[o]), copy(k[o + 1]), copy(k[o + 2]), copy(k[o + 3]));
      }
      return map[id];
    };
    root = copy(root);
    start = copy(start);
    marks = marks.map((m) => ({ ...m, root: copy(m.root) }));
    undos = undos.map((u) => ({ ...u, start: copy(u.start), root: copy(u.root) }));
    // If the boards alone are large, collect less often.
    if (n * 2 > limit) limit *= 2;
  }

  const half = () => halfOf(root);

  function setIn(id: number, x: number, y: number, v: number): number {
    if (lvl[id] === 0) return v;
    const h = halfOf(id);
    const [qx, qy] = [x >= h ? 1 : 0, y >= h ? 1 : 0];
    const q = quads(id);
    q[qy * 2 + qx] = setIn(q[qy * 2 + qx], x - qx * h, y - qy * h, v);
    return node(q[0], q[1], q[2], q[3]);
  }

  function getIn(id: number, x: number, y: number): number {
    while (lvl[id] > 0) {
      if (filled[id] === 0) return EMPTY;
      const h = halfOf(id);
      const [qx, qy] = [x >= h ? 1 : 0, y >= h ? 1 : 0];
      id = kids[id * 4 + qy * 2 + qx];
      x -= qx * h;
      y -= qy * h;
    }
    return id;
  }

  /**
   * The cells of a window, row by row: w×h cells from cell (cx, cy). A cell is a square of 2^lod
   * tiles, so lod 0 gives the tiles. A larger cell gives the value that represents its tiles.
   */
  function windowOf(cx: number, cy: number, w: number, h: number, lod = 0) {
    const out = new Uint8Array(w * h);
    const S = 2 ** lod;
    const walk = (id: number, x: number, y: number, size: number) => {
      // x, y, and size are in cells. A node smaller than a cell does not occur.
      if (filled[id] === 0 || x >= cx + w || y >= cy + h || x + size <= cx || y + size <= cy)
        return;
      if (size === 1) return void (out[(y - cy) * w + (x - cx)] = rep[id]);
      const s = size / 2;
      walk(nw(id), x, y, s);
      walk(ne(id), x + s, y, s);
      walk(sw(id), x, y + s, s);
      walk(se(id), x + s, y + s, s);
    };
    // The parts of the root fall on the cells, so each part must be at least one cell.
    let id = root;
    while (halfOf(id) < S) id = pad(id);
    const o = -halfOf(id) / S;
    walk(id, o, o, -2 * o);
    return out;
  }

  /** The smallest box of the tiles that are not empty, or null for an empty board. */
  function bounds(): [x0: number, y0: number, x1: number, y1: number] | null {
    if (filled[root] === 0) return null;
    // The least offset of a filled tile from the left of node id, and the same for the other sides
    // by mirror order of the parts.
    const side = (order: [number, number, number, number]) => {
      const memo = new Map<number, number>();
      const least = (id: number): number => {
        if (filled[id] === 0) return Infinity;
        if (lvl[id] === 0) return 0;
        let m = memo.get(id);
        if (m === undefined) {
          const q = quads(id);
          const near = Math.min(least(q[order[0]]), least(q[order[1]]));
          m =
            near < Infinity ? near : halfOf(id) + Math.min(least(q[order[2]]), least(q[order[3]]));
          memo.set(id, m);
        }
        return m;
      };
      return least(root);
    };
    const r = half();
    const size = 2 * r;
    return [
      -r + side([0, 2, 1, 3]),
      -r + side([0, 1, 2, 3]),
      -r + size - 1 - side([1, 3, 0, 2]),
      -r + size - 1 - side([2, 3, 0, 1]),
    ];
  }

  return {
    get gen() {
      return gen;
    },
    get pieces() {
      return pieces[root];
    },
    get nodes() {
      return n - LEAVES;
    },
    /** Whether `back` can go back. */
    get canBack() {
      return marks.length > 0;
    },
    get canUndo() {
      return undos.length > 0;
    },
    /** Keep the state, so that `undo` can go back to it. A stroke of paint keeps it once. */
    keep() {
      undos.push({ start, root, gen });
      if (undos.length > UNDOS) undos.shift();
    },
    /** Go back to the last kept state. The steps before it are lost. Returns false if there is none. */
    undo() {
      const u = undos.pop();
      if (!u) return false;
      ({ start, root, gen } = u);
      marks = [];
      return true;
    },
    get(x: number, y: number) {
      const r = half();
      return x < -r || y < -r || x >= r || y >= r ? EMPTY : getIn(root, x + r, y + r);
    },
    /**
     * Set tiles. The board then becomes the start: the run starts again from it, at step 0.
     */
    set(cells: [x: number, y: number, v: number][]) {
      for (const [x, y, v] of cells) {
        while (Math.max(Math.abs(x + 0.5), Math.abs(y + 0.5)) > half()) root = pad(root);
        const r = half();
        root = setIn(root, x + r, y + r, v);
      }
      begin(root);
    },
    /** Use new rules. The run starts again from the start board. */
    setRules(next: Rule[]) {
      step = stepper(prof, next);
      full.fill(-1);
      part.fill(-1);
      partJ = -1;
      begin(start);
      // A kept state from other rules starts again from its start board.
      undos = undos.map((u) => ({ ...u, root: u.start, gen: 0 }));
    },
    /** Advance 2^j steps. Returns whether the board changed. */
    advance(j: number) {
      if (n > limit) collect();
      if (j !== partJ) {
        part.fill(-1);
        partJ = j;
      }
      // Room for the growth of the board, at most one tile per step: all its tiles must be in the
      // center quarter of the root.
      while (lvl[root] < j + 3 || filled[centre(centre(root))] !== filled[root]) root = pad(root);
      const before = root;
      marks.push({ root, gen });
      if (marks.length > MARKS) marks.shift();
      root = pad(result(root, j));
      gen += 2 ** j;
      return root !== before;
    },
    /** Go back to the board before the last advance. Returns false if there is none. */
    back() {
      const m = marks.pop();
      if (!m) return false;
      ({ root, gen } = m);
      return true;
    },
    /** Go back to the start board. */
    restart: () => begin(start),
    window: windowOf,
    bounds,
    /** The start board, in a compact form: the nodes in order, each as its level and four parts. */
    save(): { nodes: number[] } {
      const index = new Map<number, number>();
      const nodes: number[] = [];
      const add = (id: number): number => {
        if (id < LEAVES) return id;
        if (filled[id] === 0) return 0;
        let i = index.get(id);
        if (i === undefined) {
          const q = quads(id).map(add);
          nodes.push(lvl[id], ...q);
          i = LEAVES + nodes.length / 5 - 1;
          index.set(id, i);
        }
        return i;
      };
      add(start);
      return { nodes };
    },
    /** Load a board from `save` as the start board. Throws on data that `save` cannot make. */
    load({ nodes }: { nodes: number[] }) {
      const tile = (v: number) => v === EMPTY || parseToken(tileToken(v, prof), prof) !== null;
      const ids: number[] = [];
      for (let i = 0; i < nodes.length; i += 5) {
        const k = nodes[i];
        if (!Number.isInteger(k) || k < 1 || k > 60) throw new Error('bad board');
        const q = nodes.slice(i + 1, i + 5).map((x) => {
          if (k === 1 && Number.isInteger(x) && tile(x)) return x;
          if (k > 1 && x === 0) return empty(k - 1);
          const id = ids[x - LEAVES];
          if (k > 1 && Number.isInteger(x) && id !== undefined && lvl[id] === k - 1) return id;
          throw new Error('bad board');
        });
        if (q.length < 4) throw new Error('bad board');
        ids.push(node(q[0], q[1], q[2], q[3]));
      }
      let board = ids.length ? ids[ids.length - 1] : empty(3);
      while (lvl[board] < 3) board = pad(board);
      begin(board);
    },
  };
}

export type Plane = ReturnType<typeof plane>;

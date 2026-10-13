/**
 * The worker that holds the plane of Unlimited. Each request gets one reply, in order, with the
 * tiles of the current view.
 */
import { plane, STD2, type Rule } from '@bauplan/engine';

/** A window of the plane: w×h cells from cell (cx, cy). A cell is 2^lod tiles on a side. */
export interface View {
  cx: number;
  cy: number;
  w: number;
  h: number;
  lod: number;
}

export type Request =
  /** A new plane with the rules that the worker has: empty, or a saved board. */
  | { kind: 'load'; board?: { nodes: number[] } }
  | { kind: 'rules'; rules: Rule[] }
  /** `first` starts a stroke: undo goes back to the board before it. */
  | { kind: 'paint'; cells: [x: number, y: number, v: number][]; first: boolean }
  | { kind: 'clear' }
  | { kind: 'undo' }
  | { kind: 'advance'; j: number }
  | { kind: 'back' }
  | { kind: 'restart' }
  | { kind: 'view'; view: View }
  | { kind: 'fit' }
  | { kind: 'save' };

export interface Reply {
  kind: Request['kind'];
  gen: number;
  pieces: number;
  canBack: boolean;
  canUndo: boolean;
  /** False when an advance did not change the board. */
  changed: boolean;
  view: View;
  tiles: Uint8Array;
  bounds?: [x0: number, y0: number, x1: number, y1: number] | null;
  board?: { nodes: number[] };
  /** A request that failed: a saved board that does not load, or a run beyond the memory. */
  error?: string;
}

let rules: Rule[] = [];
let pl = plane(STD2, rules);
let view: View = { cx: 0, cy: 0, w: 1, h: 1, lod: 0 };

/** Do a request. Returns the parts of the reply that only some requests have. */
function handle(m: Request): Partial<Reply> {
  switch (m.kind) {
    case 'load':
      pl = plane(STD2, rules);
      if (m.board) pl.load(m.board);
      return {};
    case 'rules':
      rules = m.rules;
      pl.setRules(rules);
      return {};
    case 'paint':
      if (m.first) pl.keep();
      pl.set(m.cells);
      return {};
    case 'clear':
      pl.keep();
      pl.load({ nodes: [] });
      return {};
    case 'undo':
      pl.undo();
      return {};
    case 'advance':
      return { changed: pl.advance(m.j) };
    case 'back':
      return { changed: pl.back() };
    case 'restart':
      pl.restart();
      return {};
    case 'view':
      view = m.view;
      return {};
    case 'fit':
      return { bounds: pl.bounds() };
    case 'save':
      return { board: pl.save() };
  }
}

self.onmessage = (e: MessageEvent<Request>) => {
  const m = e.data;
  let part: Partial<Reply>;
  try {
    part = handle(m);
  } catch (err) {
    part = { error: String(err) };
    // A board that does not load starts empty.
    if (m.kind === 'load') pl = plane(STD2, rules);
  }
  const { cx, cy, w, h, lod } = view;
  const reply: Reply = {
    kind: m.kind,
    gen: pl.gen,
    pieces: pl.pieces,
    canBack: pl.canBack,
    canUndo: pl.canUndo,
    changed: true,
    view,
    tiles: pl.window(cx, cy, w, h, lod),
    ...part,
  };
  // The tiles move to the page, without a copy.
  self.postMessage(reply, { transfer: [reply.tiles.buffer] });
};

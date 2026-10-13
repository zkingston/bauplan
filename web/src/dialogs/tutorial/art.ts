import {
  formatGrid,
  parseGrid,
  parsePuzzle,
  rowsOf,
  rule as R,
  step,
  type Tile,
  type Puzzle,
  type Rule,
} from '@bauplan/engine';
import { drawBoard, drawPictureTile, type PictureTile } from '../../components/board.ts';
import { h } from '../../lib/dom.ts';
import { arrows } from '../../lib/icons.ts';
import { flat, pictureTile, tileOf, turnPic, turnsOf } from '../../lib/tokens.ts';

/** The pictures and panels that make the pages of the tutorial. */
export const TILE = 24;
export const SMALL = 18;
export const TINY = 15;

/** A small board from rows of tokens. */
export function board(rows: string[], size = TILE) {
  const c = h('canvas', { class: 'board' });
  const tiles = flat(rows).map(tileOf) as Tile[];
  drawBoard(c, rows[0].split(' ').length, rows.length, size, tiles);
  return c;
}

/** A 3×3 condition or change picture from its rows, as the rule strip draws it. */
export function pic(rows: string[], grid: 'condition' | 'change', size = TILE) {
  return h(
    'div',
    { class: 'pic' },
    ...flat(rows).map((t) => {
      const c = h('canvas');
      drawPictureTile(c, size, pictureTile(t, grid));
      return c;
    }),
  );
}

/** The arrow between two pictures, or between a board before and after. */
export const arrow = (text = '→') => h('span', { class: 'arrow', 'aria-hidden': 'true' }, text);
/**
 * The arrows of a rule card: the turns that its piece tries, in order, for a rule shown at `rot`
 * quarter turns. A piece that looks different in each turn tries one turn, so it has no arrows.
 */
function sym(rule: Rule, rot = rule.turn ?? 0) {
  const turns = turnsOf(rule);
  return turns > 1 ? h('span', { class: 'sym', html: arrows(turns, rot) }) : null;
}

/**
 * A rule as a rule card shows it, shown at `rot` quarter turns: the condition → the change, with
 * the arrows of the rule under the condition. `num` is a rule number before the condition.
 */
export function ruleView(
  r: Rule,
  size: number,
  { num, rot = r.turn ?? 0 }: { num?: string; rot?: number } = {},
) {
  const shown = (rows: string[]) => (rot ? rowsOf(turnPic(flat(rows), rot)) : rows);
  const arrowsEl = sym(r, rot);
  arrowsEl?.style.setProperty('grid-column', num ? '2' : '1');
  return h(
    'div',
    { class: 'rule-view' },
    num ? h('span', { class: 'num' }, num) : null,
    pic(shown(r.condition), 'condition', size),
    arrow(),
    pic(shown(r.change), 'change', size),
    arrowsEl,
  );
}
/** A palette brush as the palette shows it, or the mark of a change: keep (=) or remove (×). */
export function tool(tile: PictureTile, size = TILE) {
  const c = h('canvas');
  drawPictureTile(c, size, tile);
  return h('span', { class: 'tool' }, c);
}
export const row = (...kids: Node[]) => h('div', { class: 'row' }, ...kids);
export const labeled = (label: string, art: Node) =>
  h('div', { class: 'labeled' }, h('span', { class: 'kw' }, label), art);
export const panel = (title: string, art: Node[], text: string) =>
  h('section', {}, h('div', { class: 'art' }, ...art), h('h3', {}, title), h('p', {}, text));

/**
 * An animation of a tutorial page: `frame` draws the time `t` in ms since the start. The result
 * starts it from the beginning. It stops when the tutorial closes or the page of `el` is off.
 */
export function loop(el: Element, frame: (t: number) => void) {
  let id = 0;
  return () => {
    cancelAnimationFrame(id);
    const t0 = performance.now();
    const tick = (now: number) => {
      if (!el.closest('dialog')?.open || el.closest('.page.off')) return;
      frame(now - t0);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
  };
}

export const copy = (center: string, i = 1) => R(center, '---', {}, { [i]: center });

/** The rows of a board after `n` steps. The engine runs the rules, so the pictures are correct. */
export function after(rows: string[], rules: Rule[], n: number) {
  const p = parsePuzzle({
    v: 3,
    profile: 'std2',
    w: rows[0].split(' ').length,
    h: rows.length,
    start: rows,
    target: rows.map((r) => r.replace(/[A-Z][a-z][\^><v]/g, '...')),
    limits: { rules: 12, conds: 2 },
  }) as Puzzle;
  let g = parseGrid(p);
  for (let k = 0; k < n; k++) g = step(p, g, rules).next;
  return formatGrid(p, g);
}

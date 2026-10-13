import { hasTool, SHAPE_NAMES, STD2, type Palette, type Puzzle } from '@bauplan/engine';
import { colorName } from '../lib/colors.ts';
import { drawPictureTile, type PictureTile } from './board.ts';
import { h } from '../lib/dom.ts';
import { PAN_ICON, TURN_ICON } from '../lib/icons.ts';
import { period } from '../lib/tokens.ts';

/** The brush that paints rule pictures. The shape, color, and direction are profile indices. */
export interface Brush {
  /**
   * `turn` does not paint. It turns the piece under it a quarter, as right-click and R do. `pan`
   * does not paint either: in Unlimited, it moves the board.
   */
  kind: 'open' | 'empty' | 'obstacle' | 'piece' | 'turn' | 'pan';
  s: number;
  c: number;
  d: number;
}
export const defaultBrush = (p: Puzzle): Brush => ({
  kind: 'piece',
  s: STD2.shapes.indexOf(p.palette.shapes[0]),
  c: STD2.colors.indexOf(p.palette.colors[0]),
  d: 0,
});

const BRUSH = 36;

/** The time of the last drop. The click that follows the release of a drag does not select. */
let dropped = 0;

/**
 * Drag brush `b` out of the palette. After the pointer moves 6 px, a copy of the brush follows it.
 * On release over a drop target (an element with data-drop), the target gets a `brushdrop` event
 * with the brush and the position, and then `select` makes it the current brush.
 */
function dragBrush(
  e: PointerEvent,
  from: HTMLElement,
  art: () => Node,
  b: Brush,
  select: () => void,
) {
  if (e.button !== 0) return;
  const [x0, y0] = [e.clientX, e.clientY];
  let ghost: HTMLElement | undefined;
  let over: Element | null = null;
  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      ghost = document.body.appendChild(h('div', { class: 'drag-ghost' }, art()));
    }
    ghost.style.translate = `${ev.clientX}px ${ev.clientY}px`;
    const t = document
      .elementFromPoint(ev.clientX, ev.clientY)
      ?.closest('[data-drop]:not(:disabled)');
    if (t === over) return;
    over?.classList.remove('drop-over');
    t?.classList.add('drop-over');
    over = t ?? null;
  };
  const end = (ev: PointerEvent) => {
    from.removeEventListener('pointermove', move);
    from.removeEventListener('pointerup', end);
    from.removeEventListener('pointercancel', end);
    over?.classList.remove('drop-over');
    if (!ghost) return;
    ghost.remove();
    dropped = performance.now();
    if (ev.type !== 'pointerup' || !over) return;
    const detail = { brush: b, x: ev.clientX, y: ev.clientY };
    over.dispatchEvent(new CustomEvent('brushdrop', { detail }));
    select();
  };
  from.setPointerCapture(e.pointerId);
  from.addEventListener('pointermove', move);
  from.addEventListener('pointerup', end);
  from.addEventListener('pointercancel', end);
}

/** The data of a `brushdrop` event: the brush and the position of the release. */
export type BrushDrop = CustomEvent<{ brush: Brush; x: number; y: number }>;

export interface PaletteProps {
  /** The shapes and colors of the puzzle. The tiles outside it are disabled. */
  palette: Palette;
  brush: Brush;
  onBrush(b: Brush): void;
  /** Set to allow the open brush, for rule pictures. The editor paints only full tiles. */
  open?: boolean;
  /** Set to show the pan tool, which moves the board of Unlimited. */
  pan?: boolean;
}

/** The palette: a column of tile brushes, the shapes in their cut tree, and a column of colors. */
export function renderPalette(
  el: HTMLElement,
  { palette, brush, onBrush, open = true, pan = false }: PaletteProps,
) {
  /**
   * A brush button. `art` draws its picture, muted when the puzzle does not allow it. A click
   * selects `next`, and a drag drops `drag`.
   */
  const brushButton = (
    key: string,
    label: string,
    art: (muted: boolean) => Node,
    on: boolean,
    enabled: boolean,
    next: Brush,
    drag = next,
  ) => {
    const ghost = () => h('span', { class: 'brush' }, art(false));
    const b: HTMLButtonElement = h(
      'button',
      {
        class: on ? 'brush on' : 'brush',
        'data-k': key,
        'aria-label': label,
        'aria-pressed': String(on),
        title: enabled ? label : `${label} (not in this puzzle)`,
        disabled: !enabled,
        onclick: () => performance.now() - dropped > 300 && onBrush(next),
        onpointerdown: (e: PointerEvent) => dragBrush(e, b, ghost, drag, () => onBrush(drag)),
      },
      art(!enabled),
    );
    return b;
  };
  /** The picture of a tile brush. */
  const tile = (t: PictureTile) => (muted: boolean) => {
    const c = h('canvas');
    drawPictureTile(c, BRUSH, t, muted);
    return c;
  };
  /** A brush of a tile that is not a piece. */
  const kind = (k: 'open' | 'empty' | 'obstacle', label: string, enabled: boolean) =>
    brushButton(`b.${k}`, label, tile(k), brush.kind === k, enabled, { ...brush, kind: k });
  const piece = brush.kind === 'piece';
  const shape = (s: string) => {
    const i = STD2.shapes.indexOf(s);
    const on = piece && brush.s === i;
    const turns = on && period(i) > 1;
    const label = turns ? `${SHAPE_NAMES[s]}: click again to turn` : SHAPE_NAMES[s];
    // A click on the current shape turns it. A drag uses the shape as the palette shows it.
    const drag: Brush = { ...brush, kind: 'piece', s: i };
    return brushButton(
      `b.s${s}`,
      label,
      tile({ s: i, c: brush.c, d: brush.d % period(i) }),
      on,
      palette.shapes.includes(s),
      turns ? { ...drag, d: (brush.d + 1) % 4 } : drag,
      drag,
    );
  };
  // The shapes in their cut tree: the square connects to the quarter circle, circle, and
  // hourglass. Each of those connects to the shapes that are cut from it.
  const fork = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  fork.setAttribute('class', 'fork');
  fork.setAttribute('viewBox', '0 0 20 3');
  fork.setAttribute('preserveAspectRatio', 'none');
  fork.innerHTML =
    '<path d="M0 1.5H10M10 0.5V2.5M10 0.5H20M10 1.5H20M10 2.5H20" vector-effect="non-scaling-stroke"/>';
  const link = () => h('span', { class: 'link', 'aria-hidden': 'true' });
  const branch = (from: string, ...cuts: string[]) =>
    h('div', { class: 'branch' }, shape(from), link(), ...cuts.map(shape));
  const section = (label: string, ...kids: Node[]) =>
    h('div', { class: 'pal-section' }, h('span', { class: 'pal-label' }, label), ...kids);
  const swatch = (c: string, i: number) => {
    const enabled = palette.colors.includes(c);
    const on = piece && brush.c === i;
    return h(
      'button',
      {
        class: on ? 'swatch on' : 'swatch',
        'data-k': `b.c${c}`,
        'aria-label': colorName(c),
        'aria-pressed': String(on),
        title: enabled ? colorName(c) : `${colorName(c)} (not in this puzzle)`,
        disabled: !enabled,
        onclick: () => onBrush({ ...brush, kind: 'piece', c: i }),
      },
      h('span', { class: `chip c-${c}` }),
    );
  };
  /** A tool with an icon: it does something to the board, but does not paint. */
  const tool = (k: 'turn' | 'pan', label: string, icon: string) =>
    brushButton(
      `b.${k}`,
      label,
      () => h('span', { html: icon }).firstElementChild!,
      brush.kind === k,
      true,
      { ...brush, kind: k },
    );
  el.replaceChildren(
    section(
      'TILE',
      h(
        'div',
        { class: 'column' },
        kind('open', 'open: any tile in the condition, unchanged in the change', open),
        kind('empty', 'empty', true),
        kind('obstacle', 'obstacle', hasTool(palette, 'obstacle')),
      ),
    ),
    section(
      'SHAPES',
      h(
        'div',
        { class: 'tree' },
        shape('S'),
        fork,
        h('div', { class: 'branches' }, branch('Q', 'T', 'L'), branch('C', 'D'), branch('H', 'W')),
      ),
    ),
    section('COLOR', h('div', { class: 'column' }, ...STD2.colors.map(swatch))),
    // The turn tool is for players who cannot right-click. In Unlimited, the pan tool is under it.
    section(
      pan ? 'TOOLS' : 'TURN',
      h(
        'div',
        { class: 'column' },
        tool('turn', 'turn: tap a piece to turn it a quarter', TURN_ICON),
        pan && tool('pan', 'pan: drag to move the board', PAN_ICON),
      ),
    ),
  );
}

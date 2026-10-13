import { parsePuzzle, run, type Puzzle } from '@bauplan/engine';
import { drawBoard, drawPictureTile, easeInOut, toTiles } from '../../components/board.ts';
import { h, reduceMotion } from '../../lib/dom.ts';
import { glyph } from '../../lib/icons.ts';
import { flat, pictureTile, tileOf, turnPic } from '../../lib/tokens.ts';
import build from '../../data/tutorial-build.json';
import { arrow, labeled, loop, tool } from './art.ts';

const STEPS: [string, string][] = [
  ['PICK A BRUSH', 'Click a brush in the palette. You can also drag it onto a tile.'],
  ['PAINT THE CONDITION', 'Click the center of the condition. The rule is for the piece there.'],
  ['PAINT THE CHANGE', 'Click a tile of the change. Here, the wedge puts a copy of itself ahead.'],
  ['PLAY', 'Click play. Each step, every piece uses its first rule that applies.'],
];

// The time line of one loop, in ms. A step starts at its time. The cursor moves to its target in
// MOVE ms, and it clicks CLICK ms after the start. The board moves for TWEEN ms after the click on
// play.
const START = [700, 2000, 3300, 4600];
const [MOVE, CLICK, TWEEN, LOOP] = [450, 500, 450, 8000];

/** The size of a rule tile and a brush, and of a board tile, in px. */
const [MOCK, BOARD] = [32, 60];

const CURSOR =
  '<svg viewBox="0 0 12 17" aria-hidden="true"><path d="M1 1V14L4.4 10.7L6.9 16L9.2 15L6.7 9.8H11.5Z"/></svg>';

/**
 * The page between How to play and Rules: the parts of the play screen in small, as the screen
 * places them. A cursor makes a rule (data/tutorial-build.json) in four steps, and then the rule
 * plays on a board of one by two tiles. The list of steps under it shows the current step.
 */
export function buildPage() {
  const p = parsePuzzle(build) as Puzzle;
  const rule = p.solution![0];
  const { history, sources } = run(p, [rule]);
  // The rule as the strip shows it: turned, so the wedge points along the board.
  const turn = rule.turn ?? 0;
  const shown = {
    condition: turnPic(flat(rule.condition), turn),
    change: turnPic(flat(rule.change), turn),
  };
  const painted = (g: string[]) => g.findIndex((t) => t !== '---');
  const at = { condition: painted(shown.condition), change: painted(shown.change) };

  const picture = (grid: 'condition' | 'change') => {
    const tiles = Array.from({ length: 9 }, () => h('canvas'));
    const el = h('div', { class: 'pic' }, ...tiles);
    const draw = (on: boolean) =>
      tiles.forEach((c, i) =>
        drawPictureTile(c, MOCK, pictureTile(on && i === at[grid] ? shown[grid][i] : '---', grid)),
      );
    return { el, tile: tiles[at[grid]], draw };
  };
  const condition = picture('condition');
  const change = picture('change');
  const brushes = [
    tool('open', MOCK),
    tool('empty', MOCK),
    tool(tileOf(shown.condition[at.condition]), MOCK),
  ];
  const wedge = brushes[2];
  const boardC = h('canvas', { class: 'board' });
  const play = h('span', { class: 'mock-play', html: glyph('play') });
  const cursor = h('span', { class: 'cursor', html: CURSOR });
  const steps = STEPS.map(([title, text], i) =>
    h('li', {}, h('span', { class: 'step-tag' }, `${i + 1} ${title}`), h('p', {}, text)),
  );
  const targets = [wedge, condition.tile, change.tile, play];

  const el = h(
    'div',
    { class: 'build' },
    h(
      'div',
      { class: 'mock' },
      h('div', { class: 'mock-top' }, labeled('BOARD', boardC), play),
      h(
        'div',
        { class: 'mock-bottom' },
        labeled('PALETTE', h('div', { class: 'mock-palette' }, ...brushes)),
        labeled(
          'RULES',
          h(
            'div',
            { class: 'mock-card' },
            h('span', { class: 'num' }, '1'),
            condition.el,
            arrow(),
            change.el,
          ),
        ),
      ),
    ),
    h('ol', { class: 'steps' }, ...steps),
    cursor,
  );

  // Draw the first frame now. Until the page shows, it keeps the size of the sheet correct.
  condition.draw(false);
  change.draw(false);
  drawBoard(boardC, p.w, p.h, BOARD, toTiles(history[0]));
  let last = '';
  /**
   * The center of a target, in layout px from the top left of the page. A zoom does not change it.
   */
  const center = (t: HTMLElement) => {
    let [x, y] = [t.offsetWidth / 2, t.offsetHeight / 2];
    for (let e: Element | null = t; e && e !== el; e = (e as HTMLElement).offsetParent) {
      x += (e as HTMLElement).offsetLeft;
      y += (e as HTMLElement).offsetTop;
    }
    return [x, y];
  };
  const animate = loop(el, (ms) => {
    const t = ms % LOOP;
    // The current step (-1 before the first), and if its click occurred.
    const step = START.findLastIndex((s) => t >= s);
    const done = (k: number) => step > k || (step === k && t >= START[k] + CLICK);
    const k = done(3) ? (reduceMotion() ? 1 : Math.min(1, (t - START[3] - CLICK) / TWEEN)) : 0;
    const key = `${step}${[0, 1, 2, 3].map(done).join()}${k}`;
    if (key !== last) {
      last = key;
      wedge.classList.toggle('on', done(0));
      condition.draw(done(1));
      change.draw(done(2));
      play.classList.toggle('on', done(3));
      steps.forEach((li, i) => li.classList.toggle('on', i === step));
      targets.forEach((x, i) => x.classList.toggle('hit', i === step && done(i)));
      // At k = 0, the step shows the start board.
      drawBoard(
        boardC,
        p.w,
        p.h,
        BOARD,
        toTiles(history[1]),
        -1,
        toTiles(history[0]),
        k,
        sources[0],
      );
    }
    // The cursor moves from the previous target to the target of the step. Each frame computes its
    // place from the layout, so it stays on its target when the window or the zoom changes. Before
    // the first step, it fades out on the last target, and then it shows at the first one.
    const i = step < 0 ? START.length - 1 : step;
    const [x1, y1] = center(targets[i]);
    const [x0, y0] = i ? center(targets[i - 1]) : [x1, y1];
    const m = step < 0 || reduceMotion() ? 1 : easeInOut(Math.min(1, (t - START[i]) / MOVE));
    cursor.style.translate = `${x0 + (x1 - x0) * m}px ${y0 + (y1 - y0) * m}px`;
    const target = targets[i].getBoundingClientRect();
    // The cursor shows only when its target is in view: below the title and above the page
    // buttons. A phone scrolls the page between them.
    const dialog = el.closest('dialog')!;
    const top = dialog.querySelector('.head')?.getBoundingClientRect().bottom ?? -Infinity;
    const bottom = dialog.querySelector('.page-nav')?.getBoundingClientRect().top ?? Infinity;
    cursor.classList.toggle('away', step < 0 || target.top < top || target.bottom > bottom);
  });
  return { el, play: animate };
}

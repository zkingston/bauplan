import { parseGrid, parsePuzzle, run, type Puzzle } from '@bauplan/engine';
import { drawBoard, toTiles } from '../../components/board.ts';
import { h, isPhone, reduceMotion } from '../../lib/dom.ts';
import { labeled, loop } from './art.ts';
import pinwheel from '../../data/tutorial-pinwheel.json';

/**
 * The first page: the pinwheel puzzle (data/tutorial-pinwheel.json). A walker in each corner moves
 * clockwise along the edge, then spirals in around the sun. A walker of each color copies itself
 * ahead and leaves its trail behind it (blue and yellow leaves, red triangles). If it is blocked
 * just after a move, it takes the next color. If the trail of the last color is behind it, it turns
 * right. The pinwheel grows into its target one step at a time, and starts again while the tutorial
 * is open. The target is next to it, and the goal text is under both.
 */
export function introPage() {
  const p = parsePuzzle(pinwheel) as Puzzle;
  const { history, sources } = run(p, p.solution!);
  // On a phone, one board is above the other. This first size is an upper bound. When the page
  // shows, `fit` makes the boards smaller until the page fits without a scroll.
  const most = Math.min(innerWidth - 64, (innerHeight - 340) / 2) / p.w;
  let size = isPhone() ? Math.max(16, Math.min(40, Math.floor(most))) : 52;
  const boardC = h('canvas', { class: 'board' });
  const targetC = h('canvas', { class: 'board' });
  const draw = () => {
    drawBoard(boardC, p.w, p.h, size, toTiles(history[0]));
    drawBoard(targetC, p.w, p.h, size, toTiles(parseGrid(p, p.target)));
  };
  draw();
  const fit = () => {
    const d = boardC.closest('dialog');
    while (d && isPhone() && size > 16 && d.scrollHeight > d.clientHeight) {
      size--;
      draw();
      // The animation draws its board again at the new size.
      still = -1;
    }
  };
  // Show the start board, then each step as it moves in, then the final board for a time. Then
  // start again.
  const n = history.length - 1;
  const [HOLD, STEP, TWEEN, END] = [900, 420, 300, 2400];
  // A board that does not move (in a hold, or after a step) is drawn one time, not each frame.
  let still = -1;
  const animate = loop(boardC, (ms) => {
    const t = (ms % (HOLD + n * STEP + END)) - HOLD;
    const i = Math.floor(t / STEP);
    const k = reduceMotion() ? 1 : Math.min(1, (t - i * STEP) / TWEEN);
    const at = t < 0 ? 0 : i >= n ? n : k >= 1 ? i + 1 : -1;
    if (at >= 0) {
      if (at !== still) drawBoard(boardC, p.w, p.h, size, toTiles(history[at]));
      still = at;
      return;
    }
    still = -1;
    drawBoard(
      boardC,
      p.w,
      p.h,
      size,
      toTiles(history[i + 1]),
      -1,
      toTiles(history[i]),
      k,
      sources[i],
    );
  });
  const play = () => {
    fit();
    still = -1;
    animate();
  };
  const el = h(
    'div',
    { class: 'intro' },
    h('div', { class: 'art' }, labeled('BOARD', boardC), labeled('TARGET', targetC)),
    h(
      'p',
      {},
      'Your goal is to design rules that transform the start board to the target. These rules can only look at neighbors around a piece to decide how to change. Rules apply until nothing on the board changes.',
    ),
  );
  return { el, play, fit };
}

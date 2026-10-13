import {
  decodeUnlimited,
  EMPTY,
  encodeUnlimited,
  explain,
  isPiece,
  OBSTACLE,
  parseToken,
  shapeOf,
  STD2,
  tileValue,
  validateRules,
  type Puzzle,
  type Rule,
  type ValidationError,
} from '@bauplan/engine';
import { toTile } from '../../components/board.ts';
import { confirmButton, resetRulesButton } from '../../components/confirm.ts';
import {
  BOARD_KEYS,
  controlsList,
  helpToggle,
  PALETTE_KEYS,
  RULE_KEYS,
  RUN_KEYS,
} from '../../components/help.ts';
import { linkError, openingLink } from '../../components/importer.ts';
import { renderPalette, type Brush, type BrushDrop } from '../../components/palette.ts';
import {
  bySlot,
  markUsed,
  renderRuleStrip,
  showSlot,
  slotRules,
  usedSlot,
  type Slot,
} from '../../components/ruleStrip.ts';
import EXAMPLES, { type Example } from '../../data/unlimited.ts';
import { copyLink, h, isPhone, transportKeys, undoKeys } from '../../lib/dom.ts';
import { glyphButton, setGlyph } from '../../lib/icons.ts';
import { inspectText, ruleErrorText, turnHint } from '../../lib/messages.ts';
import {
  loadUnlimited,
  parseUnlimited,
  saveUnlimited,
  type UnlimitedState,
} from '../../lib/store.ts';
import { blankRule, isBlank, period } from '../../lib/tokens.ts';
import PlaneWorker from './worker.ts?worker&inline';
import type { Reply, Request } from './worker.ts';
import { planeView } from './view.ts';
import '../../styles/unlimited.css';

/**
 * Unlimited has all of the palette, and no limit of rules or conditions. The engine reads its w and
 * h only to explain a tile, in a window of 7×7 tiles.
 */
const SANDBOX: Puzzle = {
  v: 3,
  profile: 'std2',
  w: 7,
  h: 7,
  start: [],
  target: [],
  limits: { rules: Infinity, conds: Infinity },
  palette: { shapes: [...STD2.shapes], colors: [...STD2.colors] },
};

/** 2^j in short form: 2, 512, 1K, 2M. */
const binary = (j: number) => `${2 ** (j % 10)}${['', 'K', 'M', 'G'][Math.floor(j / 10)]}`;

/** The speeds, from slow to fast: steps each second, and then 2^j steps in each frame. */
// ponytail: 2^30 steps per frame at most. A board that does not repeat can need memory beyond
// the node limit inside one jump; a limit inside the jump would allow more.
const SPEEDS: { label: string; rate?: number; j?: number }[] = [
  { label: '2/S', rate: 2 },
  { label: '5/S', rate: 5 },
  { label: '15/S', rate: 15 },
  { label: '60/S', rate: 60 },
  ...Array.from({ length: 30 }, (_, k) => ({ label: `${binary(k + 1)}/FRAME`, j: k + 1 })),
];

/** The glyphs of CLEAR and UNDO on a phone: an empty tile, and an arrow that turns back. */
const CLEAR =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10"/></svg>';
const UNDO =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 5H7.5A2.75 2.75 0 0 1 7.5 10.5H4M4.5 2.5L2 5L4.5 7.5"/></svg>';

/** The pieces and obstacles of an example's start board, as tiles to paint. */
function exampleCells(ex: Example) {
  const cells: [number, number, number][] = [];
  ex.start.forEach((row, j) =>
    row.split(' ').forEach((t, i) => {
      if (t !== '...') cells.push([ex.x + i, ex.y + j, tileValue(parseToken(t, STD2)!)]);
    }),
  );
  return cells;
}

/**
 * The brush. At first it is the pan tool, so a drag moves the board. It stays when the player leaves
 * the screen and comes back.
 */
let brush: Brush = { kind: 'pan', s: 0, c: 0, d: 0 };

/**
 * Mount the Unlimited screen: a board without edges, and rules without a limit. The board runs in
 * a worker (worker.ts) and draws in a view that moves and zooms (view.ts). The strip and the
 * palette are the ones of Play. Returns a cleanup function.
 */
export function mountUnlimited(root: HTMLElement): () => void {
  const saved = loadUnlimited();
  let slots: Slot[] = saved.slots.length ? saved.slots : [blankRule()];
  let board = saved.board;
  let rules: Rule[] = [];
  let slotOf: number[] = [];
  let errors: ValidationError[] = [];
  /** The rules that the worker has, as JSON. A change of only blank or off slots keeps the run. */
  let sent = '';
  /** The step, and whether there is a step back and an undo, from the last reply. */
  let at = { gen: 0, canBack: false, canUndo: false };
  let hint = '';
  let stopped = '';
  let playing = false;
  let speed = 1;
  let raf = 0;
  let due = 0;
  let hover: [number, number] | null = null;
  /** A link is on the way: the next saved board goes into it. */
  let sharing = false;
  const phone = isPhone();

  const worker = new PlaneWorker();
  /** The requests without a reply. A run sends the next step only when there are none. */
  let pending = 0;
  const post = (m: Request) => {
    pending++;
    worker.postMessage(m);
  };

  const box = h('section', { class: 'plane', 'aria-label': 'board' });
  const view = planeView(
    box,
    {
      onView: (v) => post({ kind: 'view', view: v }),
      onPaint,
      onTurn: turnAt,
      onHover: (t) => {
        hover = t;
        renderInspect();
      },
      panning: () => brush.kind === 'pan',
    },
    saved.cam,
  );

  const tool = (label: string, aria: string, fn: () => void) =>
    h('button', { 'aria-label': aria, title: aria, onclick: fn }, label);
  // A brush dropped from the palette paints the tile under it, as a click with that brush does.
  box.dataset.drop = '';
  box.addEventListener('brushdrop', (e) => {
    const { brush: b, x, y } = (e as BrushDrop).detail;
    brush = b;
    onPaint([view.tileAt({ clientX: x, clientY: y })], true);
  });

  // The help (?), under the tools: what Unlimited is, examples to load, and on a desktop, the
  // controls.
  const help = helpToggle(
    h(
      'div',
      {},
      h(
        'p',
        {},
        'A board without edges and no limit to rules, a full cellular automaton! Paint pieces on the board for the initial state, add rules with +, and press play.',
      ),
      h('h3', { class: 'kw' }, 'EXAMPLES'),
      ...EXAMPLES.map((ex) =>
        h(
          'div',
          { class: 'example' },
          h('button', { onclick: () => loadExample(ex) }, ex.title.toUpperCase()),
          h('span', {}, ex.about),
        ),
      ),
    ),
    phone ? null : controlsList([RUN_KEYS, BOARD_KEYS, RULE_KEYS, PALETTE_KEYS]),
  );
  // Zoom, fit, share, and help, over the top right corner of the board. They are not part of the
  // board, so a brush that drops on them does not paint.
  const tools = h(
    'div',
    { class: 'plane-tools' },
    tool('+', 'zoom in', () => view.zoom(1)),
    tool('−', 'zoom out', () => view.zoom(-1)),
    tool('FIT', 'show all of the board', () => post({ kind: 'fit' })),
    tool('SHARE', 'copy a link to these rules and this board', () => {
      sharing = true;
      post({ kind: 'save' });
    }),
    help.button,
    help.box,
  );

  // One message at the top of the board, as the status line of Play shows it: an error, a paint
  // hint, the tile under the mouse, or why the run stopped.
  const statusEl = h('div', { class: 'status', role: 'status', hidden: true });
  let inspectLine = '';
  const stripEl = h('section', { class: 'strip', 'aria-label': 'rules' });
  const paletteEl = h('section', { class: 'palette', 'aria-label': 'palette' });

  /** A move of the board removes the message: the board then shows something new. */
  const move = (fn: () => void) => () => {
    hint = '';
    stopped = '';
    fn();
    renderStatus();
  };
  const restart = move(() => (stop(), post({ kind: 'restart' })));
  const back = move(() => (stop(), post({ kind: 'back' })));
  const once = move(() => (stop(), advance()));
  const restartB = glyphButton('reset', 'back to the start', restart);
  const backB = glyphButton('back', 'step back', back);
  const playB = glyphButton('play', 'play', () => toggle());
  const stepB = glyphButton('step', 'step', once);
  const speedEl = h('span', { class: 'speed' });
  const slower = tool('−', 'slower', () => setSpeed(speed - 1));
  const faster = tool('+', 'faster', () => setSpeed(speed + 1));
  function setSpeed(i: number) {
    speed = Math.max(0, Math.min(SPEEDS.length - 1, i));
    speedEl.textContent = SPEEDS[speed].label;
    speedEl.title = `speed: ${SPEEDS[speed].label.toLowerCase()}`;
    slower.disabled = speed === 0;
    faster.disabled = speed === SPEEDS.length - 1;
  }
  setSpeed(speed);

  const clearBoard = confirmButton(
    {
      key: 'clear-board',
      note: 'Click again to clear the board.',
      aria: 'clear the board',
      onArm: () => resetRules.disarm(),
      onConfirm: move(() => {
        stop();
        send();
        post({ kind: 'clear' });
        post({ kind: 'save' });
      }),
    },
    h('span', { class: 'long' }, 'CLEAR'),
    h('span', { class: 'short', 'aria-hidden': 'true', html: CLEAR }),
  );
  const resetRules = resetRulesButton(
    () => clearBoard.disarm(),
    () => onChange([blankRule()]),
  );
  /** Undo the last stroke of paint, or CLEAR. */
  const undo = move(() => {
    stop();
    send();
    post({ kind: 'undo' });
    post({ kind: 'save' });
  });
  const undoB = h(
    'button',
    { 'aria-label': 'undo', title: 'undo (ctrl + Z)', onclick: undo },
    h('span', { class: 'long' }, 'UNDO'),
    h('span', { class: 'short', 'aria-hidden': 'true', html: UNDO }),
  );
  const dock = h('div', { class: 'hint-dock' }, undoB, clearBoard.el, resetRules.el);
  const controls = h(
    'section',
    { class: 'controls', 'aria-label': 'controls' },
    h(
      'div',
      { class: 'transport' },
      restartB,
      backB,
      playB,
      stepB,
      h('span', { class: 'speeds' }, slower, speedEl, faster),
      phone ? dock : null,
    ),
  );
  const stage = h(
    'section',
    { class: 'stage' },
    box,
    tools,
    statusEl,
    controls,
    phone ? null : dock,
  );
  document.body.classList.add('fixed');
  root.replaceChildren(
    h(
      'div',
      { class: 'play unlimited' },
      stage,
      h('div', { class: 'workbench' }, paletteEl, stripEl),
    ),
  );

  /**
   * A stroke that starts on the tile that the brush paints removes it, as a click with the same
   * piece clears a rule tile. That stroke then removes only that tile wherever it goes.
   */
  let erasing = false;
  function onPaint(tiles: [number, number][], first: boolean) {
    if (brush.kind === 'turn') return first ? turnAt(...tiles[0]) : undefined;
    if (brush.kind === 'pan') return;
    if (brush.kind === 'open') {
      // Open is a tile of rule pictures only. The board has pieces, obstacles, and empty tiles.
      if (first) {
        hint = 'Open is for rules. Paint the board with a piece, empty, or an obstacle.';
        renderStatus();
      }
      return;
    }
    const v =
      brush.kind === 'empty'
        ? EMPTY
        : brush.kind === 'obstacle'
          ? OBSTACLE
          : tileValue({ s: brush.s, c: brush.c, d: brush.d % period(brush.s) });
    if (first) erasing = v !== EMPTY && view.valueAt(...tiles[0]) === v;
    const cells = erasing ? tiles.filter(([x, y]) => view.valueAt(x, y) === v) : tiles;
    if (cells.length)
      paint(
        cells.map(([x, y]) => [x, y, erasing ? EMPTY : v]),
        first,
      );
  }

  let saveTimer = 0;
  /**
   * The painted tiles that the worker does not have yet. They go in one request each frame. `fresh`
   * tells that they start a stroke.
   */
  let strokes: [number, number, number][] = [];
  let fresh = false;
  let flush = 0;
  function send() {
    cancelAnimationFrame(flush);
    flush = 0;
    if (strokes.length) post({ kind: 'paint', cells: strokes, first: fresh });
    strokes = [];
    fresh = false;
  }
  function paint(cells: [number, number, number][], first: boolean) {
    hint = '';
    stopped = '';
    view.paintLocal(cells);
    // A new stroke goes in its own request, so that undo removes it alone.
    if (first) send();
    fresh ||= first;
    strokes.push(...cells);
    flush ||= requestAnimationFrame(send);
    // Keep the board when the painting stops for a moment.
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => post({ kind: 'save' }), 400);
  }

  /** Turn the piece at (x, y) a quarter, as the turn brush and a right click do. */
  function turnAt(x: number, y: number) {
    const v = view.around(x, y)?.[24];
    if (v === undefined) return;
    if (!isPiece(v) || period(shapeOf(v)) === 1) {
      hint = turnHint(isPiece(v) ? 'S' : '');
      return renderStatus();
    }
    const t = toTile(v) as { s: number; c: number; d: number };
    paint([[x, y, tileValue({ ...t, d: (t.d + 1) % period(t.s) })]], true);
  }

  const usable = () => !errors.length && rules.length > 0;

  function advance() {
    if (!usable()) return;
    const s = SPEEDS[speed];
    post({ kind: 'advance', j: s.j ?? 0 });
  }

  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    if (pending) return;
    const s = SPEEDS[speed];
    if (s.rate) {
      if (now < due) return;
      due = now + 1000 / s.rate - 4;
    }
    advance();
  }

  function stop() {
    playing = false;
    cancelAnimationFrame(raf);
    renderStatus();
  }

  function toggle() {
    if (playing) return stop();
    if (!usable()) return;
    playing = true;
    due = 0;
    raf = requestAnimationFrame(loop);
    hint = stopped = '';
    renderInspect();
  }

  worker.onmessage = (e: MessageEvent<Reply>) => {
    pending--;
    const r = e.data;
    at = r;
    // For tests and for a look in the inspector: the step and the number of pieces.
    Object.assign(box.dataset, { step: r.gen, pieces: r.pieces });
    view.show(r);
    if (r.board) {
      board = r.board;
      persist();
      if (sharing) void share();
    }
    if (r.bounds) view.fit(...r.bounds);
    else if (r.bounds === null) view.fit();
    if (r.error) {
      if (r.kind === 'load') board = undefined;
      stopped =
        r.kind === 'load' ? 'The saved board could not be read.' : 'The board is too large to run.';
      hint = '';
      stop();
    } else if (r.kind === 'advance' && !r.changed) {
      const { j } = SPEEDS[speed];
      stopped = j
        ? `The board is the same as ${binary(j)} steps before.`
        : 'No rule changes the board.';
      hint = '';
      stop();
    }
    renderInspect();
  };

  function persist() {
    saveUnlimited({ slots, board, cam: view.camera });
  }

  /** Load an example in place of the rules and the board, after a question if they are not empty. */
  function loadExample(ex: Example) {
    const empty = !board?.nodes.length && slots.every(isBlank);
    if (!empty && !confirm('Replace your rules and board with this example?')) return;
    help.show(false);
    stop();
    stopped = '';
    strokes = [];
    // An empty board, then the example painted on it without a step to undo. The reply to save
    // brings the new board.
    board = undefined;
    post({ kind: 'load' });
    post({ kind: 'paint', cells: exampleCells(ex), first: false });
    post({ kind: 'save' });
    const [x0, y0, x1, y1] = ex.view;
    view.fit(x0, y0, x1, y1);
    onChange(ex.rules);
  }

  /** Copy a link to the rules, the start board, and the view. */
  async function share() {
    sharing = false;
    const link = await encodeUnlimited({ slots, board, cam: view.camera });
    hint = link ? await copyLink(link) : 'This board is too large for a link.';
    renderStatus();
  }

  function renderPaletteNow() {
    box.classList.toggle('pan', brush.kind === 'pan');
    renderPalette(paletteEl, {
      palette: SANDBOX.palette,
      brush,
      pan: true,
      onBrush: (b) => {
        brush = b;
        hint = '';
        renderSide();
      },
    });
  }

  /** Draw the strip and the palette again, for new rules or a new brush. */
  function renderSide() {
    renderRuleStrip(stripEl, {
      p: SANDBOX,
      slots,
      errors,
      brush,
      onChange,
      onHint: (m) => {
        hint = m;
        renderStatus();
      },
      onAdd: () => {
        onChange([...slots, blankRule()]);
        showSlot(stripEl, slots.length - 1);
      },
    });
    renderPaletteNow();
    renderInspect();
  }

  /**
   * The line for the tile under the mouse, and the card of the rule that it uses next. A run that
   * plays shows neither.
   */
  function renderInspect() {
    const g = playing || !hover ? null : view.around(...hover);
    const v = g?.[24];
    const ins =
      g && v !== undefined && isPiece(v) && !errors.length
        ? explain(SANDBOX, g, rules, 24)
        : undefined;
    const line = v === undefined || v === EMPTY ? '' : inspectText(toTile(v), ins, slotOf);
    // The line of a new tile replaces the paint hint or the share message.
    if (line && line !== inspectLine) hint = '';
    inspectLine = line;
    markUsed(stripEl, usedSlot(ins, slotOf));
    renderStatus();
  }

  function renderTransport() {
    restartB.disabled = at.gen === 0;
    backB.disabled = !at.canBack;
    undoB.disabled = !at.canUndo;
    playB.disabled = stepB.disabled = !usable();
    setGlyph(playB, playing ? 'pause' : 'play');
  }

  /**
   * The message: a rule error first, then a paint hint, the tile under the mouse (not while the
   * board runs), and why the run stopped.
   */
  function renderStatus() {
    const text = errors[0]
      ? ruleErrorText(errors[0])
      : hint ||
        inspectLine ||
        stopped ||
        (rules.length ? '' : 'Add a rule, and paint pieces on the board.');
    statusEl.textContent = statusEl.title = text;
    statusEl.hidden = !text;
    renderTransport();
  }

  function onChange(next: Slot[]) {
    hint = '';
    slots = next;
    persist();
    recompute();
  }

  function recompute() {
    resetRules.button.disabled = slots.every(isBlank);
    ({ rules, slotOf } = slotRules(slots));
    errors = bySlot(validateRules(SANDBOX, rules), slotOf);
    const json = JSON.stringify(rules);
    if (!errors.length && json !== sent) {
      // New rules start the run again from the start board.
      stop();
      stopped = '';
      sent = json;
      post({ kind: 'rules', rules });
    }
    if (!usable()) stop();
    renderSide();
  }

  const offKeys = transportKeys(toggle, {
    ArrowRight: once,
    ArrowLeft: back,
    r: restart,
    R: restart,
    '+': () => view.zoom(1),
    '=': () => view.zoom(1),
    '-': () => view.zoom(-1),
  });
  const offUndo = undoKeys(undo);
  const resize = new ResizeObserver(() => view.moved());
  resize.observe(box);

  // The worker starts with the saved board and no rules. recompute() then sends the rules.
  post({ kind: 'load', board });
  recompute();
  if (saved.cam) view.moved();
  else view.fit();
  addEventListener('pagehide', persist);

  return () => {
    stop();
    view.stop();
    persist();
    worker.terminate();
    clearTimeout(saveTimer);
    cancelAnimationFrame(flush);
    resize.disconnect();
    clearBoard.off();
    resetRules.off();
    removeEventListener('pagehide', persist);
    offKeys();
    offUndo();
    document.body.classList.remove('fixed');
  };
}

/**
 * Open an Unlimited link: its setup replaces the setup of Unlimited, after a question if that has
 * rules or a board. `current` tells if the player is still on this route after the link loads.
 */
export async function openUnlimitedLink(
  app: HTMLElement,
  fragment: string,
  current: () => boolean,
): Promise<(() => void) | undefined> {
  openingLink(app);
  let shared;
  try {
    shared = parseUnlimited(await decodeUnlimited(fragment));
  } catch (e) {
    if (current()) linkError(app, [(e as Error).message], ['#/unlimited', 'UNLIMITED']);
    return;
  }
  if (!current()) return;
  const mine = loadUnlimited();
  const empty = !mine.board?.nodes.length && mine.slots.every(isBlank);
  const setup = (u: UnlimitedState) => JSON.stringify([u.slots, u.board]);
  const ask = 'Replace your Unlimited rules and board with the ones in this link?';
  if (empty || setup(mine) === setup(shared) || confirm(ask)) saveUnlimited(shared);
  history.replaceState(null, '', '#/unlimited');
  return mountUnlimited(app);
}

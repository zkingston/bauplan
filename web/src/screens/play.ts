import {
  condCount,
  explain,
  parseGrid,
  puzzleId,
  run,
  STEP_LIMIT,
  validateRules,
  type Puzzle,
  type Rule,
  type ValidationError,
} from '@bauplan/engine';
import {
  ARROW_ROOM,
  boardFigure,
  boxTile,
  drawBoard,
  prepareStep,
  tileUnder,
  toTile,
  toTiles,
} from '../components/board.ts';
import {
  copyLink,
  h,
  isPhone,
  reduceMotion,
  setLink,
  transportKeys,
  undoKeys,
  viewTabs,
} from '../lib/dom.ts';
import { gauge, glyphButton, setGlyph, triangle } from '../lib/icons.ts';
import { resetRulesButton } from '../components/confirm.ts';
import {
  boxToggle,
  controlsList,
  helpToggle,
  PALETTE_KEYS,
  PLAY_KEYS,
  RULE_KEYS,
} from '../components/help.ts';
import { defaultBrush, renderPalette, type Brush } from '../components/palette.ts';
import {
  bySlot,
  fillSlots,
  markUsed,
  renderRuleStrip,
  showSlot,
  slotRules,
  usedSlot,
  type Slot,
} from '../components/ruleStrip.ts';
import { isBlank } from '../lib/tokens.ts';
import { count, endText, inspectText, ruleErrorText } from '../lib/messages.ts';
import { loadRules, recordWin, saveRules } from '../lib/store.ts';

/** The speeds, from slow to fast: steps per second, and the angle of the dial needle for each. */
const SPEEDS = [
  { name: 'slow', rate: 2, angle: -60 },
  { name: 'medium', rate: 5, angle: 0 },
  { name: 'fast', rate: 15, angle: 60 },
];

export interface PlayContext {
  heading: string;
  /** A label next to the heading, for example UNVERIFIED for a shared puzzle. */
  note?: string;
  /** The route of the previous puzzle. */
  prev?: string;
  /** The route of the next puzzle. The screen shows it after a win. */
  next?: string;
  /** Show the next puzzle without a win here, because it or this puzzle is solved. */
  nextReady?: boolean;
  /** A link back to the page that the puzzle came from. */
  back?: [href: string, label: string];
  /** A control for the far corner of the workbench, for example the EDIT/TEST switch. */
  corner?: Node;
  /** A brush that another screen also uses. The screen reads it at mount and keeps it current. */
  brush?: { current: Brush };
  onWin?: (rules: Rule[]) => void;
  /** A hint. A button in the bottom-right corner of the stage shows it. */
  hint?: string;
  /** A solution. The strip loads it on request, or at the start when there are no saved rules. */
  solution?: Rule[];
  /** A link to this puzzle with these rules. SHARE, at the top right, copies it. */
  shareRules?: (rules: Rule[]) => Promise<string>;
}

/**
 * Mount the Play screen, a fixed widescreen layout. The board and the target are in the center of
 * the stage, between the previous and next triangles. The controls are under them. Along the
 * bottom, the palette is next to a strip of rule slots that scrolls. Returns a cleanup function.
 */
export function mountPlay(root: HTMLElement, p: Puzzle, ctx: PlayContext): () => void {
  const id = puzzleId(p);
  const start = parseGrid(p);
  const target = parseGrid(p, p.target);
  // All slots of the strip, with the blank slots. The rule list is the non-blank slots, in order.
  const saved = loadRules(id) ?? [];
  let slots = fillSlots(saved);
  let rules: Rule[] = [];
  let slotOf: number[] = [];
  let errors: ValidationError[] = [];
  let result: ReturnType<typeof run> | null = null;
  let t = 0;
  // The last step reached since the rules changed. The timeline shows no step after this one.
  let reached = 0;
  let timer = 0;
  let speed = 1;
  let sel = -1;
  let brush: Brush = ctx.brush?.current ?? defaultBrush(p);

  const boardC = h('canvas', { class: 'board', 'aria-label': 'board' });
  const targetC = h('canvas', { class: 'board', 'aria-label': 'target' });
  // Triangles at the two edges of the stage. One goes to the previous puzzle. The other goes to
  // the next puzzle after a win. Both keep their space when hidden, so the boards stay centered.
  const arrow = (label: string, dir: -1 | 1, href?: string) => {
    const a = h('a', {
      class: 'nav-arrow',
      'aria-label': `${label} puzzle`,
      title: `${label} puzzle`,
      href: dir < 0 && href,
      html: triangle(dir),
    });
    const fig = h('figure', { class: 'nav-fig' }, a, h('figcaption', {}, label.toUpperCase()));
    if (!href) fig.style.visibility = 'hidden';
    return { a, fig };
  };
  const prev = arrow('previous', -1, ctx.prev);
  const next = arrow('next', 1, ctx.next);
  const phone = isPhone();
  // On a phone, the triangles and the tabs are in the title row. On a desktop, the triangles are
  // at the two sides of the boards.
  const boards = h(
    'div',
    { class: 'boards' },
    phone ? null : prev.fig,
    boardFigure('board-fig', boardC, 'BOARD'),
    boardFigure('target-fig', targetC, 'TARGET'),
    phone ? null : next.fig,
  );
  // A phone shows one board at a time. Two tabs between the triangles, or a swipe, change it.
  const tabs = phone ? viewTabs(boards, 'BOARD', 'TARGET', true) : null;
  const view = tabs?.el ?? null;
  function loadSolution() {
    const sol = ctx.solution;
    if (sol) onChange(fillSlots(sol));
  }
  const stage = h(
    'section',
    { class: 'stage' },
    h(
      'h1',
      {},
      phone ? prev.fig : null,
      h('span', { class: 'heading' }, ctx.heading),
      ctx.note ? h('span', { class: 'tag' }, ctx.note) : '',
      ctx.back ? h('a', { class: 'button', href: ctx.back[0] }, ctx.back[1]) : '',
      ctx.solution ? h('button', { onclick: loadSolution }, 'LOAD SOLUTION') : '',
      view,
      phone ? next.fig : null,
    ),
    boards,
  );
  const inspectEl = h('div', { class: 'inspect' });
  const hintEl = h('div', { class: 'hint', role: 'status' });
  const stripEl = h('section', { class: 'strip', 'aria-label': 'rules' });
  const paletteEl = h('section', { class: 'palette', 'aria-label': 'palette' });

  const toStart = () => (stop(), setT(0));
  const stepBack = () => (stop(), setT(t - 1));
  const stepOn = () => (stop(), setT(t + 1));
  const resetB = glyphButton('reset', 'reset', toStart);
  const backB = glyphButton('back', 'step back', stepBack);
  const playB = glyphButton('play', 'play', () => toggle());
  const stepB = glyphButton('step', 'step', stepOn);
  const dial = h('button', { class: 'dial', onclick: () => setSpeed((speed + 1) % SPEEDS.length) });
  function setSpeed(i: number) {
    speed = i;
    const { name, angle } = SPEEDS[i];
    dial.setAttribute('aria-label', `speed: ${name}`);
    dial.title = `speed: ${name}`;
    dial.innerHTML = gauge(
      SPEEDS.map((s) => s.angle),
      angle,
    );
    if (timer) {
      stop();
      toggle();
    }
  }
  setSpeed(speed);
  const scrub = h('input', {
    type: 'range',
    min: '0',
    'aria-label': 'timeline',
    oninput: () => (stop(), setT(Number(scrub.value))),
  });
  const outcomeEl = h('div', { class: 'outcome', role: 'status' });
  // The hint is hidden until the player asks for it. The button shows and hides it. On a desktop,
  // the button shows the word HINT. On a phone, it is a square "?" in the row of transport buttons.
  const hintToggle = boxToggle(
    h('div', { class: 'hint-box', role: 'note', hidden: true }, ctx.hint ?? ''),
    { class: 'hint-button', 'aria-label': 'hint', title: 'hint' },
    h('span', { class: 'long' }, 'HINT'),
    h('span', { class: 'short', 'aria-hidden': 'true' }, '?'),
  );
  // Next to the hint: a button that clears all the rules, after a second click. Each button closes
  // the box of the other.
  const reset = resetRulesButton(
    () => hintToggle.show(false),
    () => onChange(fillSlots()),
  );
  hintToggle.button.addEventListener('click', () => reset.disarm());
  // Undo and redo of the changes to the rules, in the dock of a desktop.
  const undoB = h(
    'button',
    { 'aria-label': 'undo', title: 'undo (ctrl + Z)', disabled: true, onclick: () => undo() },
    'UNDO',
  );
  const redoB = h(
    'button',
    {
      'aria-label': 'redo',
      title: 'redo (ctrl + shift + Z)',
      disabled: true,
      onclick: () => redo(),
    },
    'REDO',
  );
  const hintDock = h(
    'div',
    { class: 'hint-dock' },
    ctx.hint ? hintToggle.box : null,
    phone ? null : undoB,
    phone ? null : redoB,
    reset.el,
    ctx.hint ? hintToggle.button : null,
  );
  const controls = h(
    'section',
    { class: 'controls', 'aria-label': 'controls' },
    h('div', { class: 'timeline' }, scrub),
    h('div', { class: 'transport' }, resetB, backB, playB, stepB, dial, phone ? hintDock : null),
    outcomeEl,
    inspectEl,
    hintEl,
  );
  stage.append(controls);
  if (!phone) {
    stage.append(hintDock);
    // In the top right corner: SHARE, and the ? with the controls that the screen does not show.
    const help = helpToggle(controlsList([PLAY_KEYS, RULE_KEYS, PALETTE_KEYS]));
    const shareB = ctx.shareRules
      ? h('button', { title: 'copy a link to these rules', onclick: () => void share() }, 'SHARE')
      : null;
    stage.append(h('div', { class: 'help-corner' }, shareB, help.button, help.box));
  }

  document.body.classList.add('fixed');
  root.replaceChildren(
    h(
      'div',
      { class: 'play' },
      // As in the editor, the EDIT/TEST switch is in the far corner of the workbench, or at the
      // top on a phone.
      phone ? (ctx.corner ?? '') : '',
      stage,
      h('div', { class: 'workbench' }, paletteEl, stripEl, phone ? '' : (ctx.corner ?? '')),
    ),
  );

  const last = () => (result ? Math.min(result.history.length - 1, STEP_LIMIT) : 0);
  const grid = () => (result ? result.history[t] : start);

  /** The tile size that fills the box between the title row and the controls. */
  const boardSize = () =>
    phone ? boxTile(boards, p.w, p.h, 1, 0) : boxTile(boards, p.w, p.h, 2, ARROW_ROOM);
  /**
   * Draw the boards: two boards between the turn triangles, or one board across a phone. With a
   * step and a k from 0 to 1, draw the board part of the way through that step.
   */
  function draw(step?: { from: Uint8Array; to: Uint8Array; src: Int32Array; k: number }) {
    const size = boardSize();
    drawBoard(
      boardC,
      p.w,
      p.h,
      size,
      toTiles(step?.to ?? grid()),
      sel,
      step && toTiles(step.from),
      step?.k,
      step?.src,
    );
    // The target does not change, so it is drawn again only at a new size or pixel ratio.
    const view = `${size}@${devicePixelRatio}`;
    if (view !== targetView) drawBoard(targetC, p.w, p.h, size, toTiles(target));
    targetView = view;
  }
  let targetView = '';

  const redraw = () => draw();

  // A move of one step forward or back has an animation. A longer jump, or a new run after an
  // edit, does not.
  let anim = 0;
  /** The run that the board shows. A new run after an edit does not animate its first frame. */
  let shownRun: ReturnType<typeof run> | null = null;
  const idle = (fn: () => void) =>
    'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 200 }) : setTimeout(fn);
  /** Prepare the step after step `at`, if the board still shows step `at`. */
  function prepareNext(at: number) {
    if (!result || t !== at || at >= last()) return;
    const { history } = result;
    prepareStep(boardC, p.w, p.h, boardSize(), toTiles(history[at]), toTiles(history[at + 1]), sel);
  }
  function animate(before: number) {
    // Use most of the time of a step at the play speed, so each move stops before the next move.
    const dur = timer ? Math.min(240, 750 / SPEEDS[speed].rate) : 240;
    // A step back plays the forward step in reverse.
    const lo = Math.min(t, before);
    const { history, sources } = result!;
    const step = { from: history[lo], to: history[lo + 1], src: sources[lo] };
    const at = (k: number) => ({ ...step, k: t > before ? k : 1 - k });
    const start = performance.now();
    draw(at(0));
    const frame = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      // The end of a forward step draws only the tiles that changed. A step back draws all.
      if (k === 1) {
        draw(t > before ? at(1) : undefined);
        // While the run plays, prepare the next step when the browser has time.
        if (timer && t < last()) idle(() => prepareNext(t));
        return;
      }
      draw(at(k));
      anim = requestAnimationFrame(frame);
    };
    anim = requestAnimationFrame(frame);
  }

  /** The inspect line reads the next step from the grid on the screen. */
  function inspected() {
    if (sel < 0 || errors.length) return undefined;
    return explain(p, grid(), rules, sel);
  }

  /** The paint hint or the share message of the status line. A new edit or step removes it. */
  const setHint = (m: string) => void (hintEl.textContent = hintEl.title = m);

  function renderPaletteNow() {
    renderPalette(paletteEl, {
      palette: p.palette,
      brush,
      onBrush: (b) => {
        brush = b;
        if (ctx.brush) ctx.brush.current = b;
        setHint('');
        renderSide();
      },
    });
  }

  type Inspected = ReturnType<typeof inspected>;

  /**
   * Draw the strip and the palette again, for new rules, a new brush, or a new selection. Returns
   * what the inspected tile does next.
   */
  function renderSide() {
    const ins = inspected();
    renderRuleStrip(stripEl, {
      p,
      slots,
      errors,
      brush,
      used: usedSlot(ins, slotOf),
      onChange,
      onHint: setHint,
    });
    renderPaletteNow();
    renderInspect(ins);
    return ins;
  }

  /**
   * Show a new step. Only the inspected tile changes: its line, and the card with its next rule.
   * The strip and the palette stay, so a step is fast also on a slow device.
   */
  function renderStep() {
    const ins = inspected();
    const used = usedSlot(ins, slotOf);
    markUsed(stripEl, used);
    renderInspect(ins);
  }

  function renderInspect(ins: Inspected) {
    const text = sel < 0 ? '' : inspectText(toTile(grid()[sel]), ins, slotOf);
    inspectEl.textContent = inspectEl.title = text;
  }

  function renderTransport() {
    const ok = result !== null;
    const L = last();
    for (const b of [resetB, backB]) b.disabled = !ok || t === 0;
    stepB.disabled = !ok || t >= L;
    playB.disabled = !ok;
    setGlyph(playB, timer ? 'pause' : 'play');
    scrub.setAttribute('aria-valuetext', `step ${t}`);
    // The scale matches the run, so the end is where the rules stop. Ticks show only played steps.
    scrub.max = String(L);
    scrub.style.setProperty('--r', String(Math.max(1, reached)));
    scrub.style.setProperty('--reach', String(L ? reached / L : 0));
    const won = result?.outcome.kind === 'win' && rules.length > 0 && t >= L;
    const ready = won || !!ctx.nextReady;
    setLink(next.a, ready ? ctx.next : undefined);
    next.a.setAttribute('aria-disabled', String(!ready));
    scrub.value = String(t);
    scrub.disabled = !ok;

    // One status line. When the text is cut short, the full text shows on hover.
    // Put the text in one span, so that a phone can center one or two lines in the space.
    const say = (...kids: (Node | string)[]) => {
      outcomeEl.replaceChildren(h('span', {}, ...kids));
      outcomeEl.title = outcomeEl.textContent ?? '';
    };
    // An error shows in front of the paint hint and the inspected tile (see play.css).
    outcomeEl.classList.toggle('error', !result && errors.length > 0);
    if (!result) {
      // Show the first error. A rule error names its rule, with the number that the strip shows.
      // Other errors, such as too many rules, get "Error: ".
      const e = errors[0];
      const text = e ? ruleErrorText(e) : '';
      return say(!e || e.path.startsWith('rules[') ? text : `Error: ${text}`);
    }
    if (!rules.length) return say('Add a rule to start.');
    if (t < L) return say();
    const o = result.outcome;
    if (o.kind === 'win') {
      const m = {
        rules: rules.length,
        conds: rules.reduce((a, r) => a + condCount(r), 0),
        steps: o.steps,
      };
      recordWin(id, m);
      ctx.onWin?.(rules);
      say(
        h('strong', {}, 'Win'),
        ` · ${count(m.rules, 'rule')} · ${count(m.conds, 'condition')} · ${count(m.steps, 'step')}`,
      );
    } else say(endText(o));
  }

  function setT(nt: number) {
    const before = t;
    t = Math.max(0, Math.min(last(), nt));
    reached = Math.max(reached, t);
    // A new step brings a new message, so the paint hint or the share message goes. If a phone
    // shows the target, it shows the board again.
    if (t !== before) {
      setHint('');
      tabs?.show(0);
    }
    renderStep();
    renderTransport();
    // Do this last, so the boards fit the space that the strip and the bar leave on the stage.
    cancelAnimationFrame(anim);
    if (result && result === shownRun && Math.abs(t - before) === 1 && !reduceMotion())
      animate(before);
    else draw();
    shownRun = result;
  }

  function stop() {
    window.clearInterval(timer);
    timer = 0;
  }

  function toggle() {
    if (!result) return;
    if (timer) return (stop(), renderTransport());
    tabs?.show(0);
    if (t >= last()) setT(0);
    timer = window.setInterval(
      () => (t >= last() ? (stop(), renderTransport()) : setT(t + 1)),
      1000 / SPEEDS[speed].rate,
    );
    renderTransport();
    idle(() => prepareNext(t));
  }

  /** Copy a link to the puzzle with these rules. */
  async function share() {
    if (!ctx.shareRules) return;
    if (errors.length || !rules.length)
      return setHint(rules.length ? 'Fix the rules first.' : 'Add a rule first.');
    setHint(await copyLink(await ctx.shareRules(rules)));
  }

  // The slots before each change, for undo, and the slots that undo took back, for redo.
  const undos: Slot[][] = [];
  let redos: Slot[][] = [];
  function onChange(next: Slot[]) {
    undos.push(slots);
    if (undos.length > 200) undos.shift();
    redos = [];
    setSlots(next);
  }
  function undo() {
    const prev = undos.pop();
    if (!prev) return;
    redos.push(slots);
    setSlots(prev);
  }
  function redo() {
    const next = redos.pop();
    if (!next) return;
    undos.push(slots);
    setSlots(next);
  }
  function setSlots(next: Slot[]) {
    // A paint hint is for one click. The result of the next edit replaces it.
    setHint('');
    slots = next;
    saveRules(id, slots);
    undoB.disabled = !undos.length;
    redoB.disabled = !redos.length;
    recompute();
  }

  function recompute() {
    stop();
    reset.button.disabled = slots.every(isBlank);
    ({ rules, slotOf } = slotRules(slots));
    errors = bySlot(validateRules(p, rules), slotOf);
    result = errors.length ? null : run(p, rules);
    reached = 0;
    t = 0;
    renderSide();
    setT(0);
  }

  boardC.addEventListener('click', (e) => {
    const [x, y] = tileUnder(boardC, p.w, e);
    const i = y * p.w + x;
    sel = sel === i ? -1 : i;
    setHint('');
    draw();
    // Show the card of the rule that the selected tile uses next, also if a contested tile blocks
    // it.
    const ins = renderSide();
    if (ins && ins.rule >= 0) showSlot(stripEl, slotOf[ins.rule]);
  });

  const offKeys = transportKeys(toggle, {
    ArrowRight: stepOn,
    ArrowLeft: stepBack,
    r: toStart,
    R: toStart,
  });
  const offUndo = undoKeys(undo, redo);
  window.addEventListener('resize', redraw);
  recompute();
  if (!saved.length) loadSolution();

  return () => {
    stop();
    cancelAnimationFrame(anim);
    document.body.classList.remove('fixed');
    offKeys();
    offUndo();
    window.removeEventListener('resize', redraw);
    reset.off();
  };
}

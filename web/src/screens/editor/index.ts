import { encodeShare, parsePuzzle, parseToken, puzzleId, STD2 } from '@bauplan/engine';
import {
  ARROW_ROOM,
  boardFigure,
  boxTile,
  drawBoard,
  tileSize,
  tileUnder,
} from '../../components/board.ts';
import { blank, draftJson, FULL, loadIntoEditor, toDraft } from './draft.ts';
import { copyText, downloadJson, h, isPhone, items, pageUrl, viewTabs } from '../../lib/dom.ts';
import { importBox, readImport } from '../../components/importer.ts';
import { puzzleErrorText, turnHint } from '../../lib/messages.ts';
import { renderPalette, type Brush, type BrushDrop } from '../../components/palette.ts';
import { findCustom, loadCustom, loadEditor, saveCustom, saveEditor } from '../../lib/store.ts';
import { brushToken, turned } from '../../lib/tokens.ts';

/** The brush. EDIT and TEST both use it, so a mode change keeps the selection and its turn. */
export const editorBrush: { current: Brush } = {
  current: { kind: 'piece', s: STD2.shapes.indexOf('C'), c: 0, d: 1 },
};

export function mountEditor(root: HTMLElement): () => void {
  let off = () => {};
  const remount = () => {
    off();
    off = build(root, remount);
  };
  remount();
  return () => off();
}

/**
 * The switch between EDIT, which paints a puzzle, and TEST, which tries rules on it. It is in the
 * far corner of the workbench.
 */
export function modeToggle(mode: 'edit' | 'test') {
  // Use buttons, not links, so that a tab does not show an address on hover.
  const opt = (m: 'edit' | 'test', label: string) =>
    h(
      'button',
      m === mode
        ? { class: 'on', 'aria-current': 'page' }
        : { onclick: () => (location.hash = m === 'edit' ? '#/edit' : '#/edit/test') },
      label,
    );
  const test = opt('test', 'TEST');
  return {
    nav: h('nav', { class: 'mode', 'aria-label': 'editor mode' }, opt('edit', 'EDIT'), test),
    test,
  };
}

function build(root: HTMLElement, remount: () => void): () => void {
  const st = loadEditor();
  let d = (st && toDraft(st.puzzle)) ?? blank();
  let verified = st?.verified ?? false;
  let painting: 'start' | 'target' | null = null;

  const msgs = h('ul', { class: 'errors' });
  const hint = h('p', { class: 'hint' });
  const mode = modeToggle('edit');
  const shareB = h('button', { onclick: () => share() }, 'SHARE');
  // A puzzle is verified when TEST solves it. A link to a verified puzzle has the solution, so the
  // player who opens it sees that the puzzle is verified.
  const verifiedTag = h('span', { class: 'tag' });
  const shareOut = h('input', {
    readonly: true,
    class: 'share-url',
    placeholder: 'SHARE FOR A LINK',
    'aria-label': 'share link',
  });
  const startC = h('canvas', { class: 'board', 'aria-label': 'start' });
  const targetC = h('canvas', { class: 'board', 'aria-label': 'target' });
  const boards = h(
    'div',
    { class: 'boards' },
    boardFigure('board-fig', startC, 'START'),
    boardFigure('target-fig', targetC, 'TARGET'),
  );
  // A phone shows one board at a time, and two tabs change the board. The phone page scrolls.
  const phone = isPhone();

  function edit(fn: () => void) {
    fn();
    delete d.solution;
    verified = false;
    saveEditor({ puzzle: draftJson(d), verified });
    update();
  }

  const num = (
    label: string,
    get: () => number,
    set: (n: number) => void,
    min: number,
    max: number,
  ) => {
    const input = h('input', {
      type: 'number',
      min: String(min),
      max: String(max),
      value: String(get()),
      onchange: () => {
        const n = Math.max(min, Math.min(max, Math.round(Number(input.value)) || min));
        input.value = String(n);
        edit(() => set(n));
      },
    });
    // Bold arrows, as on the rule cards, replace the spinners of the browser.
    const step = (by: number, glyph: string, name: string) =>
      h(
        'button',
        {
          type: 'button',
          'aria-label': `${label} ${name}`,
          title: name,
          onclick: () => {
            input.value = String(Number(input.value) + by);
            input.dispatchEvent(new Event('change'));
          },
        },
        glyph,
      );
    return h(
      'label',
      { class: 'field' },
      label,
      h(
        'span',
        { class: 'stepper' },
        input,
        h('span', { class: 'steps' }, step(1, '↑', 'up'), step(-1, '↓', 'down')),
      ),
    );
  };
  const text = (label: string, key: 'title' | 'author') => {
    const input = h('input', {
      type: 'text',
      maxlength: '40',
      value: d[key],
      oninput: () => edit(() => (d[key] = input.value)),
    });
    return h('label', { class: 'field wide' }, label, input);
  };

  function resize(w: number, hh: number) {
    const copy = (tiles: string[]) =>
      Array.from({ length: w * hh }, (_, i) => {
        const x = i % w;
        const y = Math.floor(i / w);
        return x < d.w && y < d.h ? tiles[y * d.w + x] : '...';
      });
    d = { ...d, start: copy(d.start), target: copy(d.target), w, h: hh };
  }

  // The palette of the play screen, with all brushes enabled except open. A puzzle tile cannot be
  // open.
  const paletteEl = h('section', { class: 'palette', 'aria-label': 'palette' });
  const renderBrush = () =>
    renderPalette(paletteEl, {
      palette: FULL.palette,
      brush: editorBrush.current,
      open: false,
      onBrush: (b) => {
        editorBrush.current = b;
        renderBrush();
      },
    });
  renderBrush();

  const form = h(
    'section',
    { class: 'form' },
    text('TITLE', 'title'),
    text('AUTHOR', 'author'),
    num(
      'W',
      () => d.w,
      (n) => resize(n, d.h),
      1,
      STD2.maxSize,
    ),
    num(
      'H',
      () => d.h,
      (n) => resize(d.w, n),
      1,
      STD2.maxSize,
    ),
  );
  // The messages have the same height as the Play controls. This keeps the boards at the same
  // position as in TEST.
  const notes = h('section', { class: 'notes' }, hint, msgs);
  const stage = h(
    'section',
    { class: 'stage edit' },
    form,
    phone ? viewTabs(boards, 'START', 'TARGET').el : null,
    boards,
    notes,
  );
  if (!phone) document.body.classList.add('fixed');
  root.replaceChildren(
    h(
      'div',
      { class: 'editor' },
      phone ? mode.nav : null,
      stage,
      h(
        'div',
        { class: 'workbench' },
        paletteEl,
        h(
          'section',
          { class: 'io', 'aria-label': 'share, export, and import' },
          h(
            'div',
            { class: 'share' },
            h(
              'div',
              { class: 'actions' },
              shareB,
              verifiedTag,
              h('button', { onclick: exportJson }, 'EXPORT'),
              h('button', { onclick: saveToCustom }, 'SAVE TO CUSTOM'),
              h(
                'button',
                {
                  onclick: () => {
                    if (!confirm('Discard the current draft?')) return;
                    loadIntoEditor(draftJson(blank()));
                    remount();
                  },
                },
                'NEW',
              ),
            ),
            shareOut,
          ),
          importBox(async (text) => {
            const r = await readImport(text);
            if (Array.isArray(r)) return r;
            if (!toDraft(r)) return ['This is not a puzzle.'];
            if (!confirm('Replace the editor draft with the imported puzzle?')) return [];
            loadIntoEditor(r);
            remount();
          }),
        ),
        phone ? null : mode.nav,
      ),
    ),
  );

  function paint(
    layer: 'start' | 'target',
    e: { clientX: number; clientY: number },
    first = false,
  ) {
    const [x, y] = tileUnder(layer === 'start' ? startC : targetC, d.w, e);
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
    const i = y * d.w + x;
    // The turn tool turns the piece under a tap one time, not at each move of a drag.
    if (editorBrush.current.kind === 'turn') {
      if (!first) return;
      const t = turned(d[layer][i]);
      if (t === d[layer][i]) return void (hint.textContent = turnHint(d[layer][i]));
      return edit(() => (d[layer][i] = t));
    }
    const tok = brushToken(editorBrush.current);
    // A tile of a puzzle cannot be open.
    if (!tok || tok === '---') return;
    const other = layer === 'start' ? d.target : d.start;
    if (d[layer][i] === tok && (tok !== '###' || other[i] === '###')) return;
    edit(() => {
      d[layer][i] = tok;
      // An obstacle is on the same tile in the start and the target.
      if (tok === '###') other[i] = '###';
      else if (other[i] === '###') other[i] = '...';
    });
  }

  for (const [layer, c] of [
    ['start', startC],
    ['target', targetC],
  ] as const) {
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      painting = layer;
      hint.textContent = '';
      paint(layer, e, true);
    });
    c.addEventListener('pointermove', (e) => painting === layer && paint(layer, e));
    c.addEventListener('pointerup', () => (painting = null));
    // A brush that the player drops from the palette paints the tile under the release.
    c.dataset.drop = '';
    c.addEventListener('brushdrop', (e) => {
      const { brush, x, y } = (e as BrushDrop).detail;
      editorBrush.current = brush;
      hint.textContent = '';
      paint(layer, { clientX: x, clientY: y }, true);
    });
  }

  /** Draw the boards with the same size and position that TEST uses. */
  function draw() {
    // The phone page scrolls, so its one board uses all of the width.
    const size = phone
      ? tileSize(stage.clientWidth - 40, d.w)
      : boxTile(boards, d.w, d.h, 2, ARROW_ROOM);
    const tiles = (toks: string[]) => toks.map((t) => parseToken(t, STD2)!);
    drawBoard(startC, d.w, d.h, size, tiles(d.start));
    drawBoard(targetC, d.w, d.h, size, tiles(d.target));
  }

  function current() {
    const p = parsePuzzle(draftJson(d));
    return Array.isArray(p) ? { errors: p } : { p };
  }

  function update() {
    draw();
    const c = current();
    const errs = c.errors?.map(puzzleErrorText) ?? [];
    // A blank draft gets a first step, not errors.
    const blankDraft = [...d.start, ...d.target].every((t) => t === '...');
    msgs.replaceChildren(...items(blankDraft ? [] : errs));
    if (blankDraft && !hint.textContent)
      hint.textContent = 'Paint the start and the target, then TEST to solve the puzzle.';
    const valid = !errs.length;
    mode.test.disabled = !valid;
    mode.test.title = valid ? '' : 'Fix the errors to test';
    shareB.disabled = !valid;
    verifiedTag.textContent = verified ? 'VERIFIED' : 'NOT VERIFIED';
    verifiedTag.classList.toggle('ok', verified);
    verifiedTag.title = verified
      ? 'TEST solved this puzzle'
      : 'Solve the puzzle in TEST to verify it';
  }

  async function share() {
    const c = current();
    if (!c.p) return;
    const url = pageUrl(await encodeShare(c.p));
    shareOut.value = url;
    hint.textContent = (await copyText(url)) ? 'Link copied.' : 'Copy the link below.';
    shareOut.select();
  }

  function exportJson() {
    const name = (d.title || 'puzzle').replace(/[^\w-]+/g, '-').toLowerCase();
    downloadJson(`${name}.json`, draftJson(d));
  }

  function saveToCustom() {
    const c = current();
    if (!c.p) return void (hint.textContent = 'Fix the errors first.');
    const i = findCustom(puzzleId(c.p));
    const list = loadCustom().filter((_, j) => j !== i);
    saveCustom([...list, { puzzle: draftJson(d), source: 'saved' }]);
    hint.textContent = 'Saved to Custom.';
  }

  window.addEventListener('resize', draw);
  update();
  // The row of fields gets its final size when the font loads. Then fit the boards again to the
  // space that remains.
  void document.fonts.ready.then(() => stage.isConnected && draw());
  return () => {
    document.body.classList.remove('fixed');
    window.removeEventListener('resize', draw);
  };
}

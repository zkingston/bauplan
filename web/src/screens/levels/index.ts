import { prepare } from '../../components/board.ts';
import { h, isPhone, reduceMotion, sideScroll } from '../../lib/dom.ts';
import { drawArt, paint, stepArt, type Chunk, type Scene } from './art.ts';
import { compose, type Level } from './layout.ts';
import { openAbout } from '../../dialogs/about.ts';
import { openTutorial } from '../../dialogs/tutorial/index.ts';

let scrollMemo = 0;

/**
 * Show the levels as one wide Bauhaus composition: level panels among shapes, which scrolls to the
 * right. A phone shows the same composition transposed, from the top down. The screen scrolls
 * `from`, the level that the player comes back from, to the middle of the view.
 */
export function mountLevels(root: HTMLElement, levels: Level[], from?: number): () => void {
  const phone = isPhone();
  // The scroll axis and the cross axis, with their DOM names.
  const ax = phone
    ? ({
        pos: 'scrollTop',
        size: 'clientHeight',
        full: 'scrollHeight',
        start: 'top',
        len: 'height',
        at: 'clientY',
      } as const)
    : ({
        pos: 'scrollLeft',
        size: 'clientWidth',
        full: 'scrollWidth',
        start: 'left',
        len: 'width',
        at: 'clientX',
      } as const);
  const inner = h('div', { class: 'levels-inner' });
  const scroller = h('div', { class: 'levels' }, inner);
  // The scrollbar is a drafting line. It has a tick under each level and a bar over the visible
  // part.
  const thumb = h('div', { class: 'thumb' });
  const bar = h('div', { class: 'levels-bar', 'aria-hidden': 'true' }, thumb);
  root.replaceChildren(h('div', { class: 'levels-page' }, scroller, bar));
  document.body.classList.add('fixed');
  // A native scrollbar across the scroll axis takes space from the grid. If this occurs, do the
  // layout again.
  const squeezed = () =>
    phone ? inner.offsetWidth > scroller.clientWidth : inner.offsetHeight > scroller.clientHeight;

  let scene: Scene | undefined;
  function build() {
    cancelAnimationFrame(anim);
    const across = phone ? scroller.clientWidth : scroller.clientHeight;
    // Tiles of approximately 88 px on a desktop, and seven tiles across a phone.
    const rows = phone ? 7 : Math.max(5, Math.round(across / 88));
    const tile = Math.floor(across / rows);
    const { cols, panels, tutorial, editor, unlimited, about, art, taken, near } = compose(
      levels,
      rows,
      Math.ceil(scroller[ax.size] / tile) + 1,
      phone,
    );
    // The size and position on the screen. The columns of the composition go along the scroll
    // axis.
    const [W, H] = phone ? [rows, cols] : [cols, rows];
    const box = (x: number, y: number, w: number, hh: number) =>
      phone
        ? `left:${y * tile}px;top:${x * tile}px;width:${hh * tile}px;height:${w * tile}px`
        : `left:${x * tile}px;top:${y * tile}px;width:${w * tile}px;height:${hh * tile}px`;
    inner.style.width = `${W * tile}px`;
    inner.style.height = `${H * tile}px`;
    inner.style.setProperty('--tile', `${tile}px`);

    // The composition is on canvases of about 1200 px each along the scroll axis. All drawing uses
    // composition coordinates. On a phone, the transform swaps x and y.
    const span = Math.max(4, Math.round(1200 / tile));
    const chunks: Chunk[] = [];
    for (let x0 = 0; x0 < cols; x0 += span) {
      const x1 = Math.min(cols, x0 + span);
      const canvas = h('canvas', {
        class: 'levels-art',
        'aria-hidden': 'true',
        width: 0,
        height: 0,
      });
      canvas.style.cssText = box(x0, 0, x1 - x0, rows);
      chunks.push({ canvas, x0, x1 });
    }
    const dpr = window.devicePixelRatio || 1;
    scene = {
      chunks,
      place: (ctx, x0) =>
        phone
          ? ctx.setTransform(0, dpr, dpr, 0, 0, -x0 * tile * dpr)
          : ctx.setTransform(dpr, 0, 0, dpr, -x0 * tile * dpr, 0),
      tile,
      cols,
      rows,
      art,
      taken,
      near,
    };
    bar.replaceChildren(
      ...panels.map(({ x, w }) =>
        h('span', { class: 'tick', style: `${ax.start}:${((x + w / 2) / cols) * 100}%` }),
      ),
      thumb,
    );

    /** A colored panel: a link to a screen, or a button that opens a dialog. */
    const special = (
      name: string,
      p: { x: number; y: number; w: number; h: number },
      to: string | (() => void),
    ) => {
      const style = box(p.x, p.y, p.w, p.h);
      const label = name.toUpperCase();
      return typeof to === 'string'
        ? h('a', { class: `panel ${name}-panel`, style, href: to, draggable: 'false' }, label)
        : h('button', { class: `panel ${name}-panel`, style, onclick: to }, label);
    };
    inner.replaceChildren(
      ...chunks.map((c) => c.canvas),
      special('tutorial', tutorial, openTutorial),
      special('editor', editor, '#/edit'),
      special('unlimited', unlimited, '#/unlimited'),
      special('about', about, openAbout),
      ...panels.map(({ l, x, y, w, h: ph }) => {
        const body = [
          h('span', { class: 'num' }, String(l.n)),
          h('span', { class: 'title' }, l.title),
          h('span', { class: 'state' }, l.best ?? l.state.toUpperCase()),
        ];
        const style = box(x, y, w, ph);
        return l.state === 'locked'
          ? h('div', { class: 'panel locked', style, 'aria-disabled': 'true' }, ...body)
          : h(
              'a',
              { class: `panel ${l.state}`, style, href: `#/play/${l.n}`, draggable: 'false' },
              ...body,
            );
      }),
    );
  }

  /** Draw the chunks in view and one view to each side, if they are not drawn yet. */
  function ensure() {
    if (!scene) return;
    const { tile, rows, art } = scene;
    const lo = (scroller[ax.pos] - scroller[ax.size]) / tile;
    const hi = (scroller[ax.pos] + 2 * scroller[ax.size]) / tile;
    for (const c of scene.chunks) {
      if (c.ctx || c.x1 < lo || c.x0 > hi) continue;
      const [w, hh] = phone ? [rows, c.x1 - c.x0] : [c.x1 - c.x0, rows];
      c.ctx = prepare(c.canvas, w * tile, hh * tile).ctx;
      const mine = art.filter((a) => a.x + (a.k || 1) > c.x0 - 1 && a.x < c.x1 + 1);
      paint(scene, c.x0, 0, c.x1 - c.x0, rows, (ctx) => mine.forEach((a) => drawArt(ctx, tile, a)));
    }
  }

  // The composition moves: every few seconds, one or two shapes in view move one step. It does not
  // move while a dialog, such as the tutorial, covers it.
  let anim = 0;
  let tick = 0;
  const live = () => {
    tick = window.setTimeout(live, 1800 + Math.random() * 1400);
    if (document.hidden || reduceMotion() || !scene || document.querySelector('dialog[open]'))
      return;
    const frames = stepArt(scene, scroller[ax.pos], scroller[ax.size]);
    const t0 = performance.now();
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / 700);
      for (const f of frames) f(k);
      if (k < 1) anim = requestAnimationFrame(frame);
    };
    anim = requestAnimationFrame(frame);
  };
  tick = window.setTimeout(live, 1800);

  function syncBar() {
    thumb.style[ax.start] = `${(scroller[ax.pos] / scroller[ax.full]) * 100}%`;
    thumb.style[ax.len] = `${(scroller[ax.size] / scroller[ax.full]) * 100}%`;
  }
  // Drag the bar, or click a point on the line, to show that part of the levels.
  bar.addEventListener('pointerdown', (e) => {
    const r = bar.getBoundingClientRect();
    const at = (p: number) => ((p - r[ax.start]) / r[ax.len]) * scroller[ax.full];
    const grab = e.target === thumb ? at(e[ax.at]) - scroller[ax.pos] : scroller[ax.size] / 2;
    const go = (ev: PointerEvent) => (scroller[ax.pos] = at(ev[ax.at]) - grab);
    const end = () => bar.removeEventListener('pointermove', go);
    go(e);
    bar.setPointerCapture(e.pointerId);
    bar.addEventListener('pointermove', go);
    bar.addEventListener('pointerup', end, { once: true });
    bar.addEventListener('pointercancel', end, { once: true });
  });

  build();
  if (squeezed()) build();
  // After the player comes back from a level, show its panel. If not, keep the last scroll
  // position.
  const panel = from && inner.querySelector(`a[data-href="#/play/${from}"]`);
  if (panel) {
    const r = panel.getBoundingClientRect();
    const v = scroller.getBoundingClientRect();
    scrollMemo = scroller[ax.pos] + r[ax.start] - v[ax.start] + (r[ax.len] - v[ax.len]) / 2;
  }
  scroller[ax.pos] = scrollMemo;
  scrollMemo = scroller[ax.pos];
  syncBar();
  ensure();

  const onScroll = () => {
    scrollMemo = scroller[ax.pos];
    syncBar();
    ensure();
  };
  // A vertical wheel or a drag scrolls the composition horizontally.
  if (!phone) sideScroll(scroller);
  let frame = 0;
  const onResize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      build();
      if (squeezed()) build();
      syncBar();
      ensure();
    });
  };
  scroller.addEventListener('scroll', onScroll);
  window.addEventListener('resize', onResize);
  return () => {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(anim);
    clearTimeout(tick);
    document.body.classList.remove('fixed');
    window.removeEventListener('resize', onResize);
  };
}

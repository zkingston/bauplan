import { css, drawTile, toTile } from '../../components/board.ts';
import { h } from '../../lib/dom.ts';
import type { Reply, View } from './worker.ts';

/** From this tile size, the view draws each piece as on a puzzle board. */
const DETAIL = 12;
/** The smallest cell of the map, in px. Below 4 px a tile, a cell is a block of tiles. */
const CELL = 4;
const [MIN_Z, MAX_Z] = [2 ** -40, 64];

/** The tile at the top left of the view, and the tile size in CSS px. */
export interface Camera {
  x: number;
  y: number;
  z: number;
}

/** A tile size in the range of the view. */
const clampZoom = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

/**
 * The level of the map cells at tile size z: a cell is 2^lod tiles, the fewest that make a cell of
 * at least CELL px.
 */
const lodOf = (z: number) => (z >= CELL ? 0 : Math.ceil(Math.log2(CELL / z)));

export interface ViewEvents {
  /** The view needs the tiles of a new window. */
  onView(v: View): void;
  /** A paint stroke reached tiles. `first` is true for the tile where the stroke starts. */
  onPaint(tiles: [number, number][], first: boolean): void;
  /** A right click (no drag) on a tile. */
  onTurn(x: number, y: number): void;
  /** The mouse is over a tile, or left the view (null). */
  onHover(tile: [number, number] | null): void;
  /** Whether the pan tool is the brush: then a drag moves the view, and does not paint. */
  panning(): boolean;
}

/**
 * The view of the plane in `box`. A drag paints, or moves the view with the pan tool. A drag with
 * the right or middle button, or with two fingers, moves the view too, as a scroll does. A pinch,
 * or the wheel with ctrl or ⌘, zooms. Each drawing fills the box and draws
 * only the tiles in view. From DETAIL px a tile, a canvas draws the pieces as on a puzzle board.
 * Below that, a map draws each tile, or each block of tiles, as a small picture of its shape.
 */
export function planeView(box: HTMLElement, on: ViewEvents, start?: Camera) {
  const detail = h('canvas', { class: 'plane-detail' });
  const map = h('canvas', { class: 'plane-map' });
  box.append(detail, map);
  const size = () => [box.clientWidth, box.clientHeight] as const;
  let cam: Camera = start ? { ...start, z: clampZoom(start.z) } : { x: 0, y: 0, z: 32 };
  /** The last reply: the window of tiles that the view draws from. */
  let shown: Reply | undefined;
  let frame = 0;

  /** Move the camera so that tile (x, y) is in the middle of the view. */
  function center(x: number, y: number) {
    const [W, H] = size();
    cam = { ...cam, x: x - W / 2 / cam.z, y: y - H / 2 / cam.z };
  }

  /** The cells in view: from (x0, y0) to (x1, y1), not included, at the lod of the camera. */
  function visible() {
    const [W, H] = size();
    const lod = lodOf(cam.z);
    const S = 2 ** lod;
    return {
      lod,
      x0: Math.floor(cam.x / S),
      y0: Math.floor(cam.y / S),
      x1: Math.ceil((cam.x + W / cam.z) / S),
      y1: Math.ceil((cam.y + H / cam.z) / S),
    };
  }
  /**
   * The window to ask for: the cells in view and a margin. The margin has the 3 tiles that a hover
   * reads, and about 100 px more, so that a short move does not need new tiles.
   */
  function wanted(): View {
    const v = visible();
    const m = 3 + Math.ceil(100 / (cam.z * 2 ** v.lod));
    return {
      cx: v.x0 - m,
      cy: v.y0 - m,
      w: v.x1 - v.x0 + 2 * m,
      h: v.y1 - v.y0 + 2 * m,
      lod: v.lod,
    };
  }
  const covers = (w: View) => {
    const v = visible();
    return (
      w.lod === v.lod &&
      w.cx <= v.x0 - 3 &&
      w.cy <= v.y0 - 3 &&
      w.cx + w.w >= v.x1 + 3 &&
      w.cy + w.h >= v.y1 + 3
    );
  };

  /** After a change of the camera: draw, and ask for the tiles of a new window if needed. */
  function moved() {
    if (!shown || !covers(shown.view)) on.onView(wanted());
    redraw();
  }

  /** Draw in the next frame, one time for any number of changes. */
  function redraw() {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      // A window of an earlier zoom does not fit this one. Its reply is on the way.
      if (!shown || shown.view.lod !== lodOf(cam.z)) return;
      const mapped = cam.z < DETAIL;
      detail.hidden = mapped;
      map.hidden = !mapped;
      if (mapped) drawMap(shown);
      else drawDetail(shown);
    });
  }

  const sameView = (a: View, b: View) =>
    a.cx === b.cx && a.cy === b.cy && a.w === b.w && a.h === b.h && a.lod === b.lod;

  /** Show the tiles of a reply. A reply with the tiles that the view has does not draw again. */
  function show(r: Reply) {
    const same =
      shown && sameView(shown.view, r.view) && shown.tiles.every((t, i) => t === r.tiles[i]);
    shown = r;
    if (!same) redraw();
  }

  /** Paint tiles in the view before the reply of the worker, so that a stroke shows at once. */
  function paintLocal(cells: [number, number, number][]) {
    const r = shown;
    if (!r || r.view.lod) return;
    for (const [x, y, t] of cells) {
      const [i, j] = [x - r.view.cx, y - r.view.cy];
      if (i >= 0 && j >= 0 && i < r.view.w && j < r.view.h) r.tiles[j * r.view.w + i] = t;
    }
    redraw();
  }

  // The pictures of the tiles at the current size, in device px. A piece has four pictures with
  // different brush streaks, so neighbors differ a little, as on a puzzle board.
  const sprites = new Map<number, HTMLCanvasElement>();
  let spriteSize = 0;
  function sprite(t: number, k: number) {
    let c = sprites.get(t * 4 + k);
    if (!c) {
      c = h('canvas', { width: spriteSize, height: spriteSize });
      const ctx = c.getContext('2d')!;
      // The seed of the streaks comes from the position. Draw at x = k * size, moved back to 0.
      ctx.translate(-k * spriteSize, 0);
      drawTile(ctx, k * spriteSize, 0, spriteSize, toTile(t));
      sprites.set(t * 4 + k, c);
    }
    return c;
  }

  /** Set the size of a canvas to the box, in px of the canvas. */
  function fitCanvas(c: HTMLCanvasElement, scale: number) {
    const [W, H] = size();
    const [w, hh] = [Math.round(W * scale), Math.round(H * scale)];
    if (c.width !== w) c.width = w;
    if (c.height !== hh) c.height = hh;
    return [w, hh] as const;
  }

  /** Draw the pieces in view, and the grid lines over them, in device px. */
  function drawDetail(r: Reply) {
    const dpr = devicePixelRatio || 1;
    const [W, H] = fitCanvas(detail, dpr);
    const ctx = detail.getContext('2d')!;
    ctx.fillStyle = css('--paper');
    ctx.fillRect(0, 0, W, H);
    const s = cam.z * dpr;
    const S = Math.round(s);
    if (S !== spriteSize) {
      sprites.clear();
      spriteSize = S;
    }
    const v = r.view;
    const [x0, y0] = [Math.floor(cam.x), Math.floor(cam.y)];
    const [x1, y1] = [Math.ceil(cam.x + W / s), Math.ceil(cam.y + H / s)];
    const at = (n: number, c: number) => Math.round((n - c) * s);
    // A zoom between whole pixels makes cells of two widths: each picture fills its cell.
    for (let y = Math.max(y0, v.cy); y < Math.min(y1, v.cy + v.h); y++) {
      const [py, ph] = [at(y, cam.y), at(y + 1, cam.y) - at(y, cam.y)];
      const row = (y - v.cy) * v.w - v.cx;
      for (let x = Math.max(x0, v.cx); x < Math.min(x1, v.cx + v.w); x++) {
        const t = r.tiles[row + x];
        if (!t) continue;
        const k = (Math.imul(x | 0, 7919) ^ Math.imul(y | 0, 104729)) & 3;
        const px = at(x, cam.x);
        ctx.drawImage(sprite(t, k), px, py, at(x + 1, cam.x) - px, ph);
      }
    }
    const lw = Math.max(1, Math.round(dpr));
    ctx.fillStyle = css('--line');
    for (let x = x0 + 1; x < x1; x++) ctx.fillRect(at(x, cam.x), 0, lw, H);
    for (let y = y0 + 1; y < y1; y++) ctx.fillRect(0, at(y, cam.y), W, lw);
  }

  // The colors of the map, as 32-bit pixels.
  const rgba = (name: string) => {
    const c = h('canvas', { width: 1, height: 1 }).getContext('2d')!;
    c.fillStyle = css(name);
    c.fillRect(0, 0, 1, 1);
    return new Uint32Array(c.getImageData(0, 0, 1, 1).data.buffer)[0];
  };
  const [PAPER, LINE, INK, ...COLORS] = [
    '--paper',
    '--line',
    '--ink',
    '--blue',
    '--red',
    '--yellow',
  ].map(rgba);

  /**
   * The picture of tile t in a cell of w×h px for the map: its shape in its color, and 0 where the
   * paper shows. Cells fall on whole pixels, so a cell can be one px wider than it is tall.
   */
  const masks = new Map<string, Uint32Array>();
  function mask(t: number, w: number, hh: number) {
    const key = `${t} ${w} ${hh}`;
    let out = masks.get(key);
    if (!out) {
      const ctx = h('canvas', { width: w, height: hh }).getContext('2d')!;
      const m = Math.max(w, hh);
      ctx.scale(w / m, hh / m);
      const tile = toTile(t);
      drawTile(ctx, 0, 0, m, tile);
      const a = ctx.getImageData(0, 0, w, hh).data;
      const col = typeof tile === 'object' ? COLORS[tile.c] : INK;
      out = Uint32Array.from({ length: w * hh }, (_, i) => (a[i * 4 + 3] >= 128 ? col : 0));
      // A zoom makes new sizes. Keep the pictures of recent sizes only.
      if (masks.size > 2000) masks.clear();
      masks.set(key, out);
    }
    return out;
  }

  /**
   * Draw the map: each cell as the picture of its tile, or of a piece in its block of tiles. From 6
   * px a cell, a grid line is on its right and bottom sides.
   */
  function drawMap(r: Reply) {
    const [W, H] = fitCanvas(map, 1);
    const ctx = map.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const px = new Uint32Array(img.data.buffer);
    px.fill(PAPER);
    const v = r.view;
    const S = 2 ** v.lod;
    const c = cam.z * S;
    // The edges of the cells, on whole pixels.
    const xs = Array.from({ length: v.w + 1 }, (_, i) =>
      Math.round(((v.cx + i) * S - cam.x) * cam.z),
    );
    const ys = Array.from({ length: v.h + 1 }, (_, j) =>
      Math.round(((v.cy + j) * S - cam.y) * cam.z),
    );
    const gap = c >= 6 ? 1 : 0;
    if (gap) {
      for (const x of xs)
        if (x >= 1 && x <= W) for (let y = 0; y < H; y++) px[y * W + x - 1] = LINE;
      for (const y of ys) if (y >= 1 && y <= H) px.fill(LINE, (y - 1) * W, y * W);
    }
    for (let j = 0; j < v.h; j++) {
      const [top, bottom] = [ys[j], ys[j + 1] - gap];
      if (bottom <= 0 || top >= H || bottom <= top) continue;
      for (let i = 0; i < v.w; i++) {
        const t = r.tiles[j * v.w + i];
        const [left, right] = [xs[i], xs[i + 1] - gap];
        if (!t || right <= 0 || left >= W || right <= left) continue;
        const w = right - left;
        const pic = mask(t, w, bottom - top);
        for (let y = Math.max(0, -top); y < bottom - top && top + y < H; y++)
          for (let x = Math.max(0, -left); x < w && left + x < W; x++) {
            const col = pic[y * w + x];
            if (col) px[(top + y) * W + left + x] = col;
          }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** The zoom of the page: the box has its layout size in CSS px. */
  const pageZoom = () => box.getBoundingClientRect().width / box.clientWidth || 1;
  /** A point of the screen in px of the box. */
  const local = (e: { clientX: number; clientY: number }) => {
    const b = box.getBoundingClientRect();
    const s = pageZoom();
    return [(e.clientX - b.left) / s, (e.clientY - b.top) / s] as const;
  };
  /** The tile under a point of the screen. */
  const tileAt = (e: { clientX: number; clientY: number }): [number, number] => {
    const [px, py] = local(e);
    return [Math.floor(cam.x + px / cam.z), Math.floor(cam.y + py / cam.z)];
  };

  /** Zoom to tile size z, and keep the point (px, py) of the box in place. */
  function zoomTo(z: number, px = box.clientWidth / 2, py = box.clientHeight / 2) {
    const fx = cam.x + px / cam.z;
    const fy = cam.y + py / cam.z;
    cam = { x: fx - px / z, y: fy - py / z, z };
    moved();
  }

  // The pointers on the view. One finger or the left button paints. The right or middle button, or
  // two fingers, move the view. Two fingers also pinch to zoom.
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'paint' | 'pan' | 'wait' | null = null;
  let last: [number, number] | null = null;
  let pinch: { d: number; z: number } | null = null;
  let moved4 = false;
  let waitTimer = 0;

  /** Paint the tiles from the last tile of the stroke to the tile under e. */
  function strokeTo(e: PointerEvent) {
    const t = tileAt(e);
    if (!last) {
      last = t;
      return on.onPaint([t], true);
    }
    const [x0, y0] = last;
    if (t[0] === x0 && t[1] === y0) return;
    const n = Math.max(Math.abs(t[0] - x0), Math.abs(t[1] - y0));
    const line: [number, number][] = [];
    for (let k = 1; k <= n; k++)
      line.push([Math.round(x0 + ((t[0] - x0) * k) / n), Math.round(y0 + ((t[1] - y0) * k) / n)]);
    last = t;
    on.onPaint(line, false);
  }

  const startPaint = (e: PointerEvent) => {
    mode = 'paint';
    last = null;
    strokeTo(e);
  };

  box.addEventListener('pointerdown', (e) => {
    box.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved4 = false;
    if (e.pointerType === 'touch') {
      if (pointers.size === 2) {
        // A second finger: the stroke has not started, or it stops. The fingers move the view.
        clearTimeout(waitTimer);
        mode = 'pan';
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z };
        return;
      }
      if (on.panning()) return void (mode = 'pan');
      // Wait a moment for a second finger before the stroke starts.
      mode = 'wait';
      waitTimer = window.setTimeout(() => mode === 'wait' && startPaint(e), 120);
      return;
    }
    if (e.button === 0 && !on.panning()) startPaint(e);
    else mode = 'pan';
    box.classList.toggle('moving', mode === 'pan');
  });

  box.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') on.onHover(tileAt(e));
      return;
    }
    const [dx, dy] = [e.clientX - p.x, e.clientY - p.y];
    if (Math.hypot(dx, dy) > 4) moved4 = true;
    if (mode === 'wait' && moved4) {
      clearTimeout(waitTimer);
      startPaint(e);
    }
    if (mode === 'paint') strokeTo(e);
    if (mode !== 'pan') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Two fingers move the view by half of each move, so their midpoint stays under them.
    const k = pageZoom() * cam.z * (pointers.size === 2 ? 2 : 1);
    cam = { ...cam, x: cam.x - dx / k, y: cam.y - dy / k };
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const z = clampZoom((pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d);
      const [mx, my] = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      return zoomTo(z, mx, my);
    }
    moved();
  });

  const end = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    clearTimeout(waitTimer);
    // A tap: paint one tile. A right click without a drag: turn the piece.
    if (mode === 'wait' && !moved4) startPaint(e);
    else if (mode === 'pan' && !moved4 && e.button === 2) on.onTurn(...tileAt(e));
    if (pointers.size === 0) {
      mode = null;
      pinch = null;
      box.classList.remove('moving');
    } else if (pointers.size === 1) pinch = null;
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && on.onHover(null));
  box.addEventListener('contextmenu', (e) => e.preventDefault());

  // A scroll (two fingers on a trackpad, or a mouse wheel) moves the view. A pinch zooms: the
  // browser gives it as a wheel with ctrl. The wheel with ctrl or ⌘ zooms too. The zoom follows the
  // size of each move, up to a quarter for one notch of a wheel.
  box.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.clientHeight : 1;
      const [dx, dy] = [e.deltaX * scale, e.deltaY * scale];
      if (!e.ctrlKey && !e.metaKey) {
        cam = { ...cam, x: cam.x + dx / cam.z, y: cam.y + dy / cam.z };
        return moved();
      }
      const [px, py] = local(e);
      zoomTo(clampZoom(cam.z * Math.exp(-Math.max(-50, Math.min(50, dy)) / 200)), px, py);
    },
    { passive: false },
  );

  return {
    get camera() {
      return cam;
    },
    show,
    paintLocal,
    moved,
    tileAt,
    /** Zoom one step in or out, around the middle of the view. */
    zoom: (dir: 1 | -1) => zoomTo(clampZoom(dir > 0 ? cam.z * 1.25 : cam.z / 1.25)),
    /** Show the box from (x0, y0) to (x1, y1), with a margin, or tile (0, 0) at 32 px. */
    fit(x0 = 0, y0 = 0, x1 = 0, y1 = 0) {
      const [W, H] = size();
      const z = Math.min(32, (W - 32) / (x1 - x0 + 1), (H - 32) / (y1 - y0 + 1));
      cam = { ...cam, z: clampZoom(z) };
      center((x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2);
      moved();
    },
    /** The value of tile (x, y) in the shown reply, if the view has it at lod 0. */
    valueAt(x: number, y: number): number | undefined {
      const r = shown;
      if (!r || r.view.lod) return undefined;
      const [i, j] = [x - r.view.cx, y - r.view.cy];
      return i >= 0 && j >= 0 && i < r.view.w && j < r.view.h
        ? r.tiles[j * r.view.w + i]
        : undefined;
    },
    /** The tiles of the shown reply around tile (x, y), 7×7, if the view has them at lod 0. */
    around(x: number, y: number): Uint8Array | null {
      const r = shown;
      if (!r || r.view.lod) return null;
      const [i, j] = [x - r.view.cx, y - r.view.cy];
      if (i < 3 || j < 3 || i + 3 >= r.view.w || j + 3 >= r.view.h) return null;
      const out = new Uint8Array(49);
      for (let b = 0; b < 7; b++)
        for (let a = 0; a < 7; a++) out[b * 7 + a] = r.tiles[(j - 3 + b) * r.view.w + i - 3 + a];
      return out;
    },
    stop: () => cancelAnimationFrame(frame),
  };
}

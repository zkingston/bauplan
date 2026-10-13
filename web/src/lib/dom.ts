type Kid = Node | string | null | undefined | false;

/**
 * Make an element. A key that starts with "on" adds a listener. The `html` key sets the markup in
 * place of `kids`. Other keys set properties or attributes.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.append(
    ...kids.filter((k): k is Node | string => k !== null && k !== undefined && k !== false),
  );
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'href' && el instanceof HTMLAnchorElement && /^(#|https?:)/.test(String(v)))
      setLink(el, String(v));
    else if (k === 'html') el.innerHTML = String(v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  return el;
}

/**
 * Set or remove the address of a link. A link has no href, so the browser does not show its
 * address in the corner on hover; a click or Enter goes there (see `follow`).
 */
export function setLink(a: HTMLAnchorElement, to: string | undefined) {
  if (to === undefined) {
    delete a.dataset.href;
    a.removeAttribute('tabindex');
    a.removeAttribute('role');
    return;
  }
  a.dataset.href = to;
  a.tabIndex = 0;
  a.setAttribute('role', 'link');
}

/**
 * Follow a link of `setLink`. A route changes the hash. A link with a target, or a click with ctrl,
 * ⌘, or the middle button, opens a new tab.
 */
function follow(e: MouseEvent | KeyboardEvent) {
  if (e.defaultPrevented || (e instanceof KeyboardEvent && e.key !== 'Enter')) return;
  if (e.type === 'auxclick' && (e as MouseEvent).button !== 1) return;
  const a = e.target instanceof Element && e.target.closest<HTMLAnchorElement>('a[data-href]');
  if (!a) return;
  e.preventDefault();
  const to = a.dataset.href!;
  if (a.target === '_blank' || e.ctrlKey || e.metaKey || e.type === 'auxclick')
    window.open(new URL(to, location.href).href, '_blank', 'noopener');
  else location.hash = to;
}
for (const type of ['click', 'auxclick', 'keydown'] as const)
  document.addEventListener(type, follow);

/** Make a list item for each message, for an error list. */
export const items = (messages: string[]) => messages.map((m) => h('li', {}, m));

/** A phone is a touch screen with a short side of less than 600 px. It gets a portrait layout. */
export const isPhone = () =>
  matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 600;

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The keys of a screen that runs a board. Space starts or stops the run (on a button, space presses
 * the button), and each key in `keys` calls its function. Keys with alt, ctrl, or meta, and keys in
 * a text field, do nothing here. Returns the function that removes the listener.
 */
export function transportKeys(toggle: () => void, keys: Record<string, () => void>) {
  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (['SELECT', 'INPUT', 'TEXTAREA'].includes(tag)) return;
    if (e.key === ' ' && tag !== 'BUTTON') toggle();
    else if (Object.hasOwn(keys, e.key)) keys[e.key]();
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

/**
 * Two tabs for a phone. Each tab shows one of the two boards in `boards`, and `show` selects a tab.
 * With `swipe`, a sideways swipe on the boards also changes the board. A swipe to the left shows
 * the second board, and a swipe to the right shows the first board.
 */
export function viewTabs(boards: HTMLElement, first: string, second: string, swipe = false) {
  const tabs = [h('button', { class: 'on' }, first), h('button', {}, second)];
  const show = (i: number) => {
    boards.classList.toggle('show-target', i === 1);
    tabs.forEach((x, j) => x.classList.toggle('on', i === j));
  };
  tabs.forEach((b, i) => b.addEventListener('click', () => show(i)));
  if (swipe) onSwipe(boards, (dir) => show(dir > 0 ? 1 : 0));
  return { el: h('div', { class: 'view-tabs' }, ...tabs), show };
}

/**
 * Call `fn` when a sideways swipe crosses `el`. A swipe to the left gives 1 (the next item), and a
 * swipe to the right gives -1.
 */
export function onSwipe(el: HTMLElement, fn: (dir: -1 | 1) => void) {
  let x0 = 0;
  let y0 = 0;
  el.addEventListener(
    'touchstart',
    (e) => ([x0, y0] = [e.touches[0].clientX, e.touches[0].clientY]),
    {
      passive: true,
    },
  );
  el.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 40 && Math.abs(dx) > 2 * Math.abs(dy)) fn(dx < 0 ? 1 : -1);
    },
    { passive: true },
  );
}

/**
 * The target position and the time constant of the motion of each scroller. A new scroller that
 * replaces an old one continues the motion of the old one.
 */
const glides = new WeakMap<Element, { to: number; tau: number }>();

/**
 * Scroll `el` sideways with a vertical mouse wheel or a mouse drag. A drag starts after a few
 * pixels, so a click still works. The click at the end of a drag has no effect. Touch input uses
 * the scroll of the browser. `skip` identifies the targets that start their own drags. Each wheel
 * step moves smoothly, and a released drag slows to a stop. `from` is a scroller that this one
 * replaces, and its motion continues here.
 */
export function sideScroll(
  el: HTMLElement,
  skip?: (target: Element) => boolean,
  from?: Element | null,
) {
  let frame = 0;
  const clamp = (x: number) => Math.max(0, Math.min(el.scrollWidth - el.clientWidth, x));
  // Each frame multiplies the distance to the target by e^(-dt/tau), at all frame rates.
  const glide = (to: number, tau: number) => {
    glides.set(el, { to, tau });
    if (frame) return;
    let pos = NaN;
    let last = performance.now();
    const step = (now: number) => {
      const g = glides.get(el);
      if (!g || !el.isConnected) return void (frame = 0);
      const end = clamp(g.to);
      if (Number.isNaN(pos)) pos = el.scrollLeft;
      pos = end - (end - pos) * Math.exp(-Math.max(0, now - last) / g.tau);
      last = now;
      if (Math.abs(end - pos) < 0.5) pos = end;
      el.scrollLeft = pos;
      if (pos !== end) frame = requestAnimationFrame(step);
      else {
        frame = 0;
        glides.delete(el);
      }
    };
    frame = requestAnimationFrame(step);
  };
  const halt = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    glides.delete(el);
  };
  const carried = from && glides.get(from);
  if (carried) glide(carried.to, carried.tau);

  el.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      const base = (frame && glides.get(el)?.to) || el.scrollLeft;
      glide(clamp(base + (e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY)), 60);
      e.preventDefault();
    },
    { passive: false },
  );
  let id = -1;
  let x0 = 0;
  let left0 = 0;
  let moved = false;
  let quietUntil = 0;
  // The recent pointer positions. They give the speed of a drag when the player releases it.
  let trail: [t: number, x: number][] = [];
  // The number of screen pixels for each CSS pixel. With it, the content moves with the pointer
  // on a zoomed page.
  let scale = 1;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (skip && e.target instanceof Element && skip(e.target)) return;
    halt();
    id = e.pointerId;
    x0 = e.clientX;
    left0 = el.scrollLeft;
    scale = el.getBoundingClientRect().width / el.offsetWidth || 1;
    moved = false;
    trail = [[e.timeStamp, e.clientX]];
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0;
    if (!moved) {
      if (Math.abs(dx) < 6) return;
      moved = true;
      el.setPointerCapture(id);
      el.classList.add('dragging');
    }
    el.scrollLeft = left0 - dx / scale;
    trail.push([e.timeStamp, e.clientX]);
    if (trail.length > 8) trail.shift();
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = -1;
    if (!moved) return;
    el.classList.remove('dragging');
    quietUntil = performance.now() + 100;
    // If the pointer still moved at release, continue the motion at the release speed. The speed
    // is the mean over the last 80 ms.
    const [t1, x1] = trail[trail.length - 1];
    const old = trail.find(([t]) => e.timeStamp - t <= 80);
    if (e.type === 'pointerup' && old && e.timeStamp - t1 < 50 && t1 > old[0]) {
      const v = (x1 - old[1]) / (t1 - old[0]) / scale;
      glide(clamp(el.scrollLeft - v * 300), 300);
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener(
    'click',
    (e) => {
      if (performance.now() >= quietUntil) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  el.addEventListener('dragstart', (e) => e.preventDefault());
}

/** The address of this page at route `hash`. */
export const pageUrl = (hash: string) => location.href.split('#')[0] + hash;

/**
 * Copy text to the clipboard. A page on plain http has no clipboard API, so the copy command
 * copies a selected text area.
 */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const prev = document.activeElement as HTMLElement | null;
    const ta = h('textarea', { readonly: true, style: 'position: fixed; opacity: 0' }, text);
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    prev?.focus();
    return ok;
  }
}

/**
 * Copy the link to route `hash`. Without the clipboard, the link goes in the address bar. Returns
 * the message for the player.
 */
export async function copyLink(hash: string) {
  const url = pageUrl(hash);
  if (await copyText(url)) return 'Link copied.';
  history.replaceState(null, '', url);
  return 'Copy the link in the address bar.';
}

/** Download `value` as a JSON file. */
export function downloadJson(name: string, value: unknown) {
  const json = JSON.stringify(value, null, 2) + '\n';
  const a = h('a', {
    href: URL.createObjectURL(new Blob([json], { type: 'application/json' })),
    download: name,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Ctrl or ⌘ with Z calls `undo`. With shift, or Y, it calls `redo`, as in an editor. Returns the
 * function that removes the listener.
 */
export function undoKeys(undo: () => void, redo?: () => void) {
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) undo();
    else if (redo && (k === 'z' || (k === 'y' && !e.shiftKey))) redo();
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

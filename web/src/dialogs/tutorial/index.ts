import { h, onSwipe, reduceMotion } from '../../lib/dom.ts';
import { DOWN, triangle } from '../../lib/icons.ts';
import { sheet } from '../sheet.ts';
import { buildPage } from './build.ts';
import { examplesPage } from './examples.ts';
import { introPage } from './intro.ts';
import { rulesPage } from './rules.ts';

const PAGES = ['HOW TO PLAY', 'BUILD', 'RULES', 'EXAMPLES'];
/** The page names along the bottom. The first page has a short name there. */
const TABS = ['PLAY', ...PAGES.slice(1)];
let show: (i: number) => void = () => {};

/**
 * The tutorial: one sheet with four pages (How to play, Build, Rules, and Examples).
 * Along the bottom, there is a back triangle, the page names, and a next triangle. A desktop puts
 * the pages in one place, so the sheet keeps the size of the largest page.
 */
const open = sheet('tutorial', PAGES[0], () => {
  const intro = introPage();
  const make = buildPage();
  /** For each page, the function that starts its animation from the beginning, if it has one. */
  const plays = [intro.play, make.play];
  const pages = [intro.el, make.el, rulesPage(), examplesPage()].map((el, i) =>
    h('div', { class: `page ${['', '', '', 'examples'][i]}` }, el),
  );
  const arrow = (dir: -1 | 1) =>
    h('button', {
      class: 'page-arrow',
      'aria-label': dir < 0 ? 'previous page' : 'next page',
      html: triangle(dir),
      onclick: () => show(at + dir),
    });
  const prev = arrow(-1);
  const next = arrow(1);
  const names = TABS.map((name, i) => h('button', { onclick: () => show(i) }, name));
  // A tab above the page buttons, when more of the page is below. It scrolls down.
  const sheetBox = () => prev.closest('dialog');
  const more = h('button', {
    class: 'page-more',
    'aria-label': 'scroll down',
    html: DOWN,
    onclick: () => {
      const d = sheetBox();
      d?.scrollBy({ top: d.clientHeight * 0.7, behavior: reduceMotion() ? 'auto' : 'smooth' });
    },
  });
  const below = () => {
    const d = sheetBox();
    more.hidden = !d || d.scrollTop + d.clientHeight >= d.scrollHeight - 2;
  };
  let at = 0;
  show = (i: number) => {
    i = Math.max(0, Math.min(PAGES.length - 1, i));
    at = i;
    pages.forEach((pg, j) => pg.classList.toggle('off', j !== i));
    names.forEach((b, j) => b.classList.toggle('on', j === i));
    // On a narrow phone, the names scroll. Show the name of the current page.
    const row = names[i].parentElement;
    if (row)
      row.scrollLeft =
        names[i].offsetLeft - row.offsetLeft - (row.clientWidth - names[i].offsetWidth) / 2;
    prev.disabled = i === 0;
    next.disabled = i === PAGES.length - 1;
    const box = sheetBox();
    const title = box?.querySelector('h2');
    if (title) title.textContent = PAGES[i];
    // On a phone, the sheet scrolls. Each page starts at its top.
    box?.scrollTo(0, 0);
    if (box) {
      box.onscroll = below;
      resized.observe(box);
    }
    // An animation starts when its page shows, and stops when the page is off. The first page fits
    // its boards to the sheet first, so the tab for more below comes after it.
    plays[i]?.();
    below();
  };
  const stack = h('div', { class: 'stack' }, ...pages);
  // A font that loads after the sheet opens, or the bar of a phone browser that hides, changes the
  // size of the page or the sheet. Then the first page fits again, and the tab shows if more is
  // below.
  const resized = new ResizeObserver(() => {
    if (at === 0) intro.fit();
    below();
  });
  resized.observe(stack);
  // A horizontal swipe changes the page.
  onSwipe(stack, (dir) => show(at + dir));
  return h(
    'div',
    { class: 'pages' },
    stack,
    h(
      'nav',
      { class: 'page-nav', 'aria-label': 'tutorial pages' },
      more,
      prev,
      h('div', { class: 'page-names' }, ...names),
      next,
    ),
  );
});

/** Open the tutorial at its first page. */
export function openTutorial() {
  open();
  show(0);
}

/** The header button that opens the tutorial. */
export const tutorialButton = () =>
  h('button', { class: 'nav-button', onclick: openTutorial }, 'TUTORIAL');

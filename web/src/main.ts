import {
  canonicalRules,
  decodeRules,
  encodeRules,
  encodeShare,
  parsePuzzle,
  puzzleId,
  type Puzzle,
  type Rule,
  type ValidationError,
} from '@bauplan/engine';
import { aboutButton } from './dialogs/about.ts';
import { settingsButton } from './dialogs/settings.ts';
import { clearCss, css } from './components/board.ts';
import { applyColors } from './lib/colors.ts';
import levels, { names } from './data/levels.ts';
import { h, isPhone } from './lib/dom.ts';
import { linkError } from './components/importer.ts';
import { mountCustom, openShare } from './screens/custom.ts';
import { editorPuzzle, markVerified } from './screens/editor/draft.ts';
import { editorBrush, modeToggle, mountEditor } from './screens/editor/index.ts';
import { mountLevels } from './screens/levels/index.ts';
import { bestText, puzzleErrorText, titleOf } from './lib/messages.ts';
import { mountPlay } from './screens/play.ts';
import markSvg from './assets/mark.svg?raw';
import { loadCustom, loadRules, progress, saveRules, storageOk } from './lib/store.ts';
import { isBlank } from './lib/tokens.ts';
import { tutorialButton } from './dialogs/tutorial/index.ts';
// Import the styles in cascade order: a later file overrides an earlier file.
// Each file ends with its phone rules.
import './styles/base.css';
import './styles/levels.css';
import './styles/play.css';
import './styles/workbench.css';
import './styles/editor.css';
import './styles/sheets.css';
import './styles/tutorial.css';

const puzzles: Puzzle[] = levels.map((j, i) => {
  const p = parsePuzzle(j);
  if (Array.isArray(p)) throw new Error(`level ${i + 1}: ${JSON.stringify(p)}`);
  return p;
});
const ids = puzzles.map(puzzleId);

/** Puzzles 1 to 3 are open at the start. Each solved puzzle opens the next locked puzzle. */
// A dev build opens all puzzles.
const openCount = () =>
  import.meta.env.DEV ? puzzles.length : 3 + ids.filter((id) => id in progress()).length;

const NO_STORAGE = 'STORAGE IS UNAVAILABLE. PROGRESS LASTS UNTIL THIS PAGE CLOSES.';
const notice = h('span', { class: 'notice', hidden: storageOk(), title: NO_STORAGE }, NO_STORAGE);
document.addEventListener('bauplan:storagefail', () => (notice.hidden = false));
const app = h('main');
/** The mark with each of its fills set by `fill`, from the CSS color of that fill. */
const MARK_FILLS = [
  ['#D4321F', '--red'],
  ['#F2B90C', '--yellow'],
  ['#1F4E9C', '--blue'],
];
const markWith = (fill: (v: string) => string) =>
  MARK_FILLS.reduce((s, [hex, v]) => s.replace(`fill="${hex}"`, fill(v)), markSvg);
/** The icon of the tab, in the colors of the settings. */
const setIcon = () =>
  (document.querySelector<HTMLLinkElement>('link[rel=icon]')!.href =
    'data:image/svg+xml,' + encodeURIComponent(markWith((v) => `fill="${css(v)}"`)));
// The service worker (web/public/sw.js) keeps the game for play offline. Without it, the game
// still works online.
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  navigator.serviceWorker.register('sw.js').catch(() => {});
// In a window smaller than 1280×720, the full page scales down. This gives the layout one
// minimum size. A phone uses its own portrait layout. When the phone is sideways, a cover tells
// the player to turn it upright.
let phone = isPhone();
const fit = () => {
  const was = phone;
  phone = isPhone();
  const root = document.documentElement;
  root.classList.toggle('phone', phone);
  root.style.setProperty(
    '--zoom',
    phone ? '1' : String(Math.min(1, innerWidth / 1280, innerHeight / 720)),
  );
  if (phone !== was) route();
};
fit();
addEventListener('resize', fit);
// A browser locks the orientation only in some cases, for example full screen or an installed
// app. Try the lock in all cases.
if (phone)
  void (screen.orientation as { lock?: (o: string) => Promise<void> })
    .lock?.('portrait')
    .catch(() => {});
/** The links and buttons of the header. A phone has them in a menu. */
const navItems = () => [
  h('a', { href: '#/' }, 'LEVELS'),
  tutorialButton(),
  h('a', { href: '#/edit' }, 'EDITOR'),
  h('a', { href: '#/custom' }, 'CUSTOM'),
  h('a', { href: '#/unlimited' }, 'UNLIMITED'),
  settingsButton(),
  aboutButton(),
  // The debug page (rule errors) exists only in a dev build.
  import.meta.env.DEV ? h('a', { href: '#/debug' }, 'DEBUG') : null,
];
// The menu of a phone: a panel under the header. A tap outside it closes it, and so does a choice.
const menu = h(
  'nav',
  { class: 'menu', id: 'menu', popover: '', 'aria-label': 'menu' },
  ...navItems(),
);
menu.addEventListener(
  'click',
  (e) => (e.target as Element).closest('a, button') && menu.hidePopover(),
);
document.body.append(
  h(
    'header',
    {},
    // The mark in the header takes its colors from the page, so the settings change them.
    h(
      'a',
      { href: '#/', class: 'logo' },
      h('span', { class: 'mark', html: markWith((v) => `style="fill: var(${v})"`) }),
      'bauplan',
    ),
    h('nav', {}, ...navItems()),
    notice,
    h('button', { class: 'menu-button', popovertarget: 'menu', 'aria-label': 'menu' }, 'MENU'),
    menu,
  ),
  app,
  h(
    'div',
    { class: 'upright', role: 'alert' },
    h('span', { class: 'phone-glyph' }),
    'TURN YOUR PHONE UPRIGHT',
  ),
);

/** The last level that the player played. The levels screen scrolls to it on return. */
let lastLevel: number | undefined;

function renderLevels() {
  const best = progress();
  const open = openCount();
  const from = lastLevel;
  lastLevel = undefined;
  cleanup = mountLevels(
    app,
    puzzles.map((p, i) => {
      const n = i + 1;
      const b = best[ids[i]];
      return {
        n,
        title: titleOf(p),
        state: b ? 'solved' : n <= open ? 'open' : 'locked',
        best: b && bestText(b),
      };
    }),
    from,
  );
}

/** A level that a link to its rules opened. It stays open, also if it is locked. */
let linked = 0;

/**
 * Open `#/r/<level>/<rules>`: the rules replace the saved rules of the level, after a question if
 * those are different, and the level opens.
 */
async function openRulesLink(hash: string, current: () => boolean) {
  const m = hash.match(/^#\/r\/([\w-]+)\/([\w-]+)$/);
  const n = m ? names.indexOf(m[1]) + 1 : 0;
  if (!m || !n) return linkError(app, ['This is not a link to a level.'], ['#/', 'LEVELS']);
  const decoded = await decodeRules(m[2], puzzles[n - 1]);
  if (!current()) return;
  if (decoded.some((r) => 'message' in r))
    return linkError(app, (decoded as ValidationError[]).map(puzzleErrorText), ['#/', 'LEVELS']);
  const rules = decoded as Rule[];
  const mine = (loadRules(ids[n - 1]) ?? []).filter((r) => !isBlank(r));
  const key = (rs: Rule[]) => JSON.stringify(canonicalRules(rs));
  const ask = `Replace your rules for ${titleOf(puzzles[n - 1])} with the ones in this link?`;
  if (!mine.length || key(mine) === key(rules) || confirm(ask)) saveRules(ids[n - 1], rules);
  linked = n;
  location.replace(`#/play/${n}`);
}

let cleanup: (() => void) | undefined;
let routeToken = 0;
function route() {
  cleanup?.();
  cleanup = undefined;
  const token = ++routeToken;
  /** Whether the player is still on this route, after a screen or a link loads. */
  const current = () => token === routeToken;
  const hash = location.hash;
  const n = Number(hash.match(/^#\/play\/(\d+)$/)?.[1] ?? 0);
  const entry = loadCustom()[Number(hash.match(/^#\/c\/(\d+)$/)?.[1] ?? -1)];
  const custom = entry && parsePuzzle(entry.puzzle);
  const test = hash === '#/edit/test' && editorPuzzle();
  if (n >= 1 && n <= puzzles.length && (n <= openCount() || n === linked)) {
    const p = puzzles[n - 1];
    lastLevel = n;
    cleanup = mountPlay(app, p, {
      heading: `${n}. ${titleOf(p)}`,
      hint: p.hint,
      prev: n > 1 ? `#/play/${n - 1}` : undefined,
      next: n < puzzles.length ? `#/play/${n + 1}` : undefined,
      // Next is available when the next puzzle is unlocked, as on the levels screen.
      nextReady: n < puzzles.length && n + 1 <= openCount(),
      // A production build removes the solutions from the levels (vite.config.ts).
      solution: p.solution,
      shareRules: async (rules) => `#/r/${names[n - 1]}/${await encodeRules(rules)}`,
    });
  } else if (hash.startsWith('#/r/')) {
    void openRulesLink(hash, current);
  } else if (hash.startsWith('#/p/')) {
    void openShare(app, hash, current).then((off) => off && (cleanup = off));
  } else if (hash === '#/edit') {
    cleanup = mountEditor(app);
  } else if (test) {
    cleanup = mountPlay(app, test, {
      heading: `TEST: ${titleOf(test)}`,
      corner: modeToggle('test').nav,
      brush: editorBrush,
      hint: test.hint,
      solution: test.solution,
      onWin: markVerified,
    });
  } else if (import.meta.env.DEV && hash === '#/debug') {
    // The debug page loads only in a dev build. A production build removes this branch.
    void import('./screens/debug.ts').then((m) => current() && m.mountDebug(app));
  } else if (hash.startsWith('#/u/')) {
    void import('./screens/unlimited/index.ts')
      .then((m) => m.openUnlimitedLink(app, hash, current))
      .then((off) => off && (cleanup = off));
  } else if (hash === '#/unlimited') {
    // Unlimited loads on first use, with its worker.
    void import('./screens/unlimited/index.ts').then(
      (m) => current() && (cleanup = m.mountUnlimited(app)),
    );
  } else if (hash === '#/custom') {
    mountCustom(app);
  } else if (custom && !Array.isArray(custom)) {
    cleanup = mountPlay(app, custom, {
      heading: titleOf(custom),
      note: entry.source === 'link' ? 'UNVERIFIED' : undefined,
      back: ['#/custom', '← CUSTOM'],
      hint: custom.hint,
      shareRules: (rules) => encodeShare(custom, rules),
    });
  } else {
    if (hash && hash !== '#/') history.replaceState(null, '', '#/');
    renderLevels();
  }
}
addEventListener('hashchange', route);
// A change of the colors in the settings: the screen draws again with the new colors.
document.addEventListener('bauplan:colors', () => {
  clearCss();
  setIcon();
  route();
});
applyColors();
setIcon();
route();

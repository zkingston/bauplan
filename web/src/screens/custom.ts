import { encodeShare, parsePuzzle, puzzleId, type Puzzle } from '@bauplan/engine';
import { h } from '../lib/dom.ts';
import { loadIntoEditor, solves } from './editor/draft.ts';
import { importBox, linkError, openingLink, readImport } from '../components/importer.ts';
import { bestText, puzzleErrorText, titleOf } from '../lib/messages.ts';
import { mountPlay } from './play.ts';
import { findCustom, loadCustom, progress, saveCustom } from '../lib/store.ts';

/** The Custom page. It shows saved, shared, and imported puzzles, and a box to import more. */
export function mountCustom(app: HTMLElement) {
  const list = loadCustom();
  const best = progress();
  const rows = list.map((e, i) => {
    const p = parsePuzzle(e.puzzle);
    if (Array.isArray(p)) return null;
    const b = best[puzzleId(p)];
    return h(
      'li',
      { class: 'custom' },
      h('span', { class: 'title' }, `${titleOf(p)} · ${p.w}×${p.h}`),
      e.source === 'link' ? h('span', { class: 'tag' }, 'UNVERIFIED') : '',
      h('span', { class: 'state' }, b ? `SOLVED · ${bestText(b)}` : ''),
      h('a', { class: 'button', href: `#/c/${i}` }, 'PLAY'),
      h(
        'button',
        {
          onclick: () => {
            if (!confirm('Replace the editor draft with this puzzle?')) return;
            loadIntoEditor(e.puzzle);
            location.hash = '#/edit';
          },
        },
        'EDIT',
      ),
      h(
        'button',
        {
          onclick: () => {
            if (!confirm(`Delete ${titleOf(p)}?`)) return;
            saveCustom(list.filter((_, j) => j !== i));
            mountCustom(app);
          },
        },
        'DELETE',
      ),
    );
  });
  // An imported puzzle goes into the list as unverified, as a share link does. If its solution
  // wins, the list marks it as verified.
  const importer = importBox(async (text) => {
    const r = await readImport(text);
    if (Array.isArray(r)) return r;
    const p = parsePuzzle(r);
    if (Array.isArray(p)) return p.map(puzzleErrorText);
    if (findCustom(puzzleId(p)) >= 0) return ['This puzzle is already in Custom.'];
    saveCustom([...list, { puzzle: r, source: solves(p) ? 'saved' : 'link' }]);
    mountCustom(app);
  });
  app.replaceChildren(
    h('h1', {}, 'CUSTOM'),
    h('div', { class: 'custom-import' }, importer),
    rows.some(Boolean)
      ? h('ol', { class: 'custom-list' }, ...rows)
      : h(
          'p',
          { class: 'hint' },
          'NO CUSTOM PUZZLES. SAVE ONE FROM THE EDITOR, OPEN A SHARE LINK, OR IMPORT ONE ABOVE.',
        ),
  );
}

/**
 * Open a share link. Save the puzzle in Custom, load its solution (if any) as the draft, and play
 * the puzzle. `current` tells if the player is still on this route after the link loads.
 */
export async function openShare(app: HTMLElement, fragment: string, current: () => boolean) {
  openingLink(app);
  const r = await readImport(fragment);
  if (!current()) return;
  if (Array.isArray(r)) return linkError(app, r, ['#/', 'LEVELS']);
  // The puzzle from a decoded link is always valid.
  const p = parsePuzzle(r) as Puzzle;
  // A link with a solution that wins is verified, as an import is.
  const verified = solves(p);
  if (findCustom(puzzleId(p)) < 0)
    saveCustom([...loadCustom(), { puzzle: r, source: verified ? 'saved' : 'link' }]);
  return mountPlay(app, p, {
    heading: titleOf(p),
    note: verified ? undefined : 'UNVERIFIED',
    shareRules: (rules) => encodeShare(p, rules),
  });
}

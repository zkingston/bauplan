import { decodeShare, isObj, puzzleId } from '@bauplan/engine';
import { h, items } from '../lib/dom.ts';
import { puzzleErrorText } from '../lib/messages.ts';
import { saveRules } from '../lib/store.ts';

/**
 * Read a share link or puzzle JSON. Return the puzzle object, or the reasons that it cannot be
 * read. The solution of a share link becomes the draft for that puzzle.
 */
export async function readImport(text: string): Promise<Record<string, unknown> | string[]> {
  const hash = text.indexOf('#/p/');
  if (hash >= 0) {
    const d = await decodeShare(text.slice(hash));
    if (Array.isArray(d)) return d.map(puzzleErrorText);
    if (d.rules) saveRules(puzzleId(d.puzzle), d.rules);
    return d.puzzle as unknown as Record<string, unknown>;
  }
  try {
    const j: unknown = JSON.parse(text);
    return isObj(j) ? j : ['This is not a puzzle.'];
  } catch {
    return ['Paste a share link or puzzle JSON.'];
  }
}

/**
 * A box for a pasted share link or puzzle JSON. `onText` returns errors, or nothing when done.
 */
export function importBox(onText: (text: string) => Promise<string[] | undefined>) {
  const area = h('textarea', {
    rows: 3,
    'aria-label': 'share link or puzzle JSON',
    placeholder: 'PASTE A SHARE LINK OR PUZZLE JSON',
  });
  const err = h('ul', { class: 'errors' });
  const go = async () => {
    const errs = await onText(area.value.trim());
    err.replaceChildren(...items(errs ?? []));
    if (!errs) area.value = '';
  };
  return h('section', { class: 'import' }, area, h('button', { onclick: go }, 'IMPORT'), err);
}

/** The page while a link opens. */
export const openingLink = (app: HTMLElement) =>
  app.replaceChildren(h('p', { class: 'hint' }, 'OPENING LINK…'));

/** The page of a link that does not open: why, and a way back. */
export function linkError(app: HTMLElement, errors: string[], [href, label]: [string, string]) {
  app.replaceChildren(
    h('h1', {}, 'THIS LINK DOES NOT OPEN'),
    h('ul', { class: 'errors' }, ...items(errors)),
    h('a', { class: 'button', href }, label),
  );
}

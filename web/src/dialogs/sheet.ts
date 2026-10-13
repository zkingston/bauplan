import { h } from '../lib/dom.ts';

/** A line of a sheet: a label, and its value. */
export const line = (label: string, ...value: (Node | string)[]) =>
  h('div', { class: 'line' }, h('span', { class: 'label' }, label), h('div', {}, ...value));

/**
 * A function that opens a modal sheet with a title, a close button, and a body. The body is made
 * when the sheet opens the first time. The close button, Escape, or a click outside the sheet
 * closes it.
 */
export function sheet(cls: string, title: string, body: () => Node) {
  let dialog: HTMLDialogElement | undefined;
  // The text can name the colors: after a change of the colors, a closed sheet is made again.
  document.addEventListener('bauplan:colors', () => {
    if (!dialog || dialog.open) return;
    dialog.remove();
    dialog = undefined;
  });
  return () => {
    if (!dialog) {
      const d: HTMLDialogElement = h(
        'dialog',
        { class: `modal ${cls}`, 'aria-label': title.toLowerCase() },
        h(
          'div',
          { class: 'sheet' },
          h(
            'div',
            { class: 'head' },
            h('h2', {}, title),
            h(
              'div',
              { class: 'actions' },
              h('button', { class: 'close', onclick: () => d.close() }, 'CLOSE'),
            ),
          ),
          body(),
        ),
      );
      // The sheet fills the dialog, so a click on the dialog element is a click on the backdrop.
      d.addEventListener('click', (e) => e.target === d && d.close());
      dialog = document.body.appendChild(d);
    }
    dialog.showModal();
  };
}

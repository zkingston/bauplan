import { h } from '../lib/dom.ts';

/** A group of the controls that the screens do not show: its name, and each key with its use. */
export type Controls = [string, [string, string][]];

export const PLAY_KEYS: Controls = [
  'PLAY',
  [
    ['SPACE', 'Start or stop the steps.'],
    ['← →', 'Go back or forward one step.'],
    ['R', 'Go back to the first step.'],
    ['CLICK A BOARD TILE', 'Show the piece on the tile and the rule that it uses next.'],
    ['SPEED DIAL', 'Click to change the speed.'],
    ['CTRL + Z, CTRL + SHIFT + Z', 'Undo or redo a change to the rules.'],
  ],
];

export const RUN_KEYS: Controls = [
  'RUN',
  [
    ['SPACE', 'Start or stop the steps.'],
    ['← →', 'Go back, or go forward at the speed.'],
    ['R', 'Go back to the start board.'],
    ['POINT AT A PIECE', 'Show the rule that it uses next.'],
  ],
];

export const BOARD_KEYS: Controls = [
  'BOARD',
  [
    ['PAN, RIGHT-DRAG, SCROLL', 'Move the board.'],
    ['PINCH, CTRL + WHEEL, + −', 'Zoom in or out.'],
    ['UNDO, CTRL + Z', 'Undo the last paint or clear.'],
  ],
];

export const RULE_KEYS: Controls = [
  'RULES',
  [
    ['RIGHT-CLICK OR R', 'Turn the piece in a rule tile.'],
    ['ARROWS UNDER A RULE', 'Click to turn the whole rule and change the order of its directions.'],
    ['CLICK WITH THE SAME PIECE', 'Set the tile to open.'],
    ['DRAG OR ← → A RULE NUMBER', 'Move the rule. Rules that come first are used first.'],
    ['WHEEL OR DRAG', 'Scroll the rules.'],
  ],
];

export const PALETTE_KEYS: Controls = [
  'PALETTE',
  [
    ['DRAG A BRUSH', 'Drop it on a rule tile or a board to paint that tile.'],
    ['CLICK A SHAPE AGAIN', 'Turn the brush before you paint with it.'],
    ['TURN', 'Then click a piece to turn it. Use this if you cannot right-click.'],
  ],
];

/** The groups of controls, each as a list of keys and what they do. */
export const controlsList = (groups: Controls[]) =>
  h(
    'div',
    { class: 'keys' },
    ...groups.map(([title, rows]) =>
      h(
        'section',
        {},
        h('h3', { class: 'kw' }, title),
        h('dl', {}, ...rows.flatMap(([key, what]) => [h('dt', {}, key), h('dd', {}, what)])),
      ),
    ),
  );

/** A button that shows and hides `box`, with its own attributes and label. */
export function boxToggle(
  box: HTMLElement,
  attrs: Record<string, unknown>,
  ...label: (Node | string)[]
) {
  const button = h(
    'button',
    { ...attrs, 'aria-expanded': 'false', onclick: () => show(box.hidden === true) },
    ...label,
  );
  function show(on: boolean) {
    box.hidden = !on;
    button.classList.toggle('on', on);
    button.setAttribute('aria-expanded', String(on));
  }
  return { button, box, show };
}

/** A ? button, and the box of help under it that the button shows and hides. */
export const helpToggle = (...kids: (Node | null)[]) =>
  boxToggle(
    h('div', { class: 'hint-box help', role: 'note', hidden: true }, ...kids),
    { class: 'help-button', 'aria-label': 'help', title: 'help' },
    '?',
  );

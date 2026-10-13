import { rule as R, type Rule } from '@bauplan/engine';
import { colorName } from '../../lib/colors.ts';
import { h } from '../../lib/dom.ts';
import { after, arrow, board, copy, ruleView, SMALL } from './art.ts';

/**
 * Examples: the rules, what they do, and a board before and after the steps. The text names the
 * colors as the settings show them.
 */
const examples = (): {
  title: string;
  rules: Rule[];
  text: string;
  board: string[];
  steps: number;
}[] => [
  {
    title: 'COPY',
    rules: [copy('Wb^')],
    text: 'A wedge adds a copy of itself to the tile ahead.',
    board: ['Wb> ... ...'],
    steps: 1,
  },
  {
    title: 'CHECK FOR SPACE',
    rules: [R('Sb^', 'Qb<', { 1: '...', 3: '...' })],
    text: 'A square with empty tiles ahead and to its left becomes a quarter circle. A square tries the rule in the directions up, down, right, and left, so each corner rounds.',
    board: ['... ... ... ...', '... Sb^ Sb^ ...', '... Sb^ Sb^ ...', '... ... ... ...'],
    steps: 1,
  },
  {
    title: 'TURN AT AN OBSTACLE',
    rules: [R('Wb^', 'Wb>', { 1: '###' })],
    text: 'A wedge with an obstacle ahead turns a quarter to the right.',
    board: ['Wb> ###'],
    steps: 1,
  },
  {
    title: 'READ A NEIGHBOR',
    rules: [R('Cb^', 'Cr^', { 7: 'Cr^' })],
    text: `A ${colorName('b')} circle with a ${colorName('r')} circle next to it turns ${colorName('r')}. Each step, the ${colorName('r')} spreads one tile.`,
    board: ['Cr^ Cb^ Cb^'],
    steps: 1,
  },
  {
    title: 'FIRST RULE THAT FITS',
    rules: [copy('Wb^'), R('Wb^', 'Wr^')],
    text: `Each piece uses its first rule that fits. If the wedge cannot copy, the next rule is used and it turns ${colorName('r')}.`,
    board: ['Wb> ...'],
    steps: 2,
  },
];

export const examplesPage = () =>
  h(
    'div',
    { class: 'list' },
    ...examples().map((e) =>
      h(
        'section',
        {},
        h('h3', {}, e.title),
        h(
          'div',
          { class: 'example' },
          h(
            'div',
            { class: 'rules' },
            ...e.rules.map((r, i) =>
              ruleView(r, SMALL, { num: e.rules.length > 1 ? String(i + 1) : undefined }),
            ),
          ),
          h('p', {}, e.text),
          h(
            'div',
            { class: 'states' },
            board(e.board, SMALL),
            arrow(e.steps > 1 ? `→ ${e.steps} steps →` : '→'),
            board(after(e.board, e.rules, e.steps), SMALL),
          ),
        ),
      ),
    ),
  );

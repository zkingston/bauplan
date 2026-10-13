import { TURN_ICON } from '../../lib/icons.ts';
import { h } from '../../lib/dom.ts';
import {
  after,
  arrow,
  board,
  copy,
  labeled,
  panel,
  pic,
  row,
  ruleView,
  SMALL,
  TINY,
  tool,
} from './art.ts';

const ACTIONS: [string, string, string][] = [
  ['COPY', 'Wb> ...', 'Wb> Wb>'],
  ['REMOVE', 'Cb^', '...'],
  ['RECOLOR', 'Sb^', 'Sr^'],
  ['TURN', 'Wb^', 'Wb>'],
  ['CUT', 'Sb^', 'Qb^'],
];
const down = () => h('span', { class: 'down', 'aria-hidden': 'true' }, '↓');

// A leaf copy rule, shown turned a quarter as on a rule card, with its arrows under it. On a row
// of three tiles, the leaf uses the rule to the right first, then, with right full, to the left.
const LEAF_RULE = copy('Lb^');
const LEAF = [0, 1, 2].map((n) => after(['... Lb> ...'], [LEAF_RULE], n));
/** Between one board and the next: the direction that the rule used. */
const uses = (dir: string) =>
  h('div', { class: 'uses' }, h('span', { class: 'kw' }, 'USES ', h('b', {}, dir)));

const CUTS = [
  ['Sb^', 'Qb^', 'Tb^', 'Lb^'],
  ['Sb^', 'Cb^', 'Db^'],
  ['Sb^', 'Hb^', 'Wb^'],
];

/** The rule panels: what a rule is, what it does, cuts, directions, and how rules interact. */
export const rulesPage = () =>
  h(
    'div',
    { class: 'grid' },
    panel(
      'RULES',
      [
        labeled('CONDITION', pic(copy('Wb^').condition, 'condition')),
        arrow(),
        labeled('CHANGE', pic(copy('Wb^').change, 'change')),
      ],
      'A rule matches a condition around a piece (left) and makes the change (right). Each piece uses the first rule that applies. Conditions can match any tile, a piece, an empty tile, or an obstacle, at most two per rule.',
    ),
    panel(
      'ACTIONS',
      [
        h(
          'div',
          { class: 'list' },
          ...ACTIONS.map(([name, a, b]) =>
            row(h('span', { class: 'kw' }, name), board([a], SMALL), arrow(), board([b], SMALL)),
          ),
        ),
      ],
      'Each rule does one of these actions. A rule changes only its own piece, but it can copy the piece into an empty tile next to it.',
    ),
    panel(
      'CUTS',
      [
        h(
          'div',
          { class: 'list' },
          ...CUTS.map(([s, ...rest]) =>
            row(
              board([s], SMALL),
              ...rest.flatMap((t, i) => [
                i === 2 ? h('span', {}, '·') : arrow(),
                board([t], SMALL),
              ]),
            ),
          ),
        ),
      ],
      'A cut changes a shape to one of the allowed next shapes.',
    ),
    panel(
      'DIRECTION',
      [
        // A leaf tries its rule as written (up), then turned around (down). Each step shows the
        // turn of the rule that fired, and the board after it.
        h(
          'div',
          { class: 'unfold' },
          ruleView(LEAF_RULE, TINY, { rot: 1 }),
          h(
            'div',
            { class: 'leaf-steps' },
            board(LEAF[0], TINY),
            uses('→'),
            board(LEAF[1], TINY),
            uses('←'),
            board(LEAF[2], TINY),
          ),
        ),
      ],
      'Some pieces have symmetry, so rules are attempted in all symmetric directions according to the arrows under the rule. In this example, the leaf copies right, then left. Only the first valid direction is used.',
    ),
    panel(
      'SAME TIME',
      [board(['Wb> ... ... ... Wb<'], SMALL), arrow(), board(['Wb> Wb> ... Wb< Wb<'], SMALL)],
      'All pieces do their rules at the same time. When two pieces change one tile in different ways, the tile is contested and both changes fail.',
    ),
    panel(
      'PALETTE',
      [
        // Under open and empty, an arrow points to the mark that each shows in a change picture.
        h(
          'div',
          { class: 'palette-art' },
          labeled('OPEN', h('div', { class: 'mark-stack' }, tool('open'), down(), tool('keep'))),
          labeled(
            'EMPTY',
            h('div', { class: 'mark-stack' }, tool('empty'), down(), tool('remove')),
          ),
          labeled('OBSTACLE', tool('obstacle')),
          labeled('TURN', h('span', { class: 'tool', html: TURN_ICON })),
        ),
      ],
      'Open matches any tile. In a change, it shows = and keeps the tile. Empty matches an empty tile. In a change, it shows × and removes the piece. Obstacle matches a tile that never changes. Turn turns a piece.',
    ),
  );

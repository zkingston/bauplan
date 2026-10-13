import { parsePuzzle, validateRules, type Puzzle, type Rule } from '@bauplan/engine';
import { defaultBrush } from '../components/palette.ts';
import { renderRuleStrip } from '../components/ruleStrip.ts';
import data from '../data/debug-errors.json';
import { h } from '../lib/dom.ts';
import { ruleErrorText } from '../lib/messages.ts';
import '../styles/debug.css';

/**
 * A page for development (#/debug in a dev build): each rule error of the engine on a rule card,
 * as the play screen shows it. A card can be edited, and the error updates. Under each card are the
 * engine message and the status line text.
 */
export function mountDebug(root: HTMLElement) {
  const cases = data.cases.map((c) => {
    const p = parsePuzzle({ ...data.puzzle, ...c.puzzle }) as Puzzle;
    const strip = h('section', { class: 'strip' });
    const raw = h('code', {});
    const status = h('p', {});
    let rule: Rule = c.rule;
    const render = () => {
      const errors = validateRules(p, [rule]);
      raw.textContent = errors.map((e) => `${e.path}: ${e.message}`).join('\n') || 'no error';
      status.textContent = errors[0] ? ruleErrorText(errors[0]) : '';
      renderRuleStrip(strip, {
        p,
        slots: [rule],
        errors,
        brush: defaultBrush(p),
        onChange: (next) => {
          rule = next[0];
          render();
        },
        onHint: () => {},
      });
    };
    render();
    return h(
      'div',
      { class: 'case' },
      h('h3', {}, c.title),
      strip,
      h('div', { class: 'info' }, raw, status),
    );
  });
  root.replaceChildren(
    h(
      'div',
      { class: 'debug' },
      h('h1', {}, 'RULE ERRORS'),
      h(
        'p',
        {},
        `${cases.length} cases from data/debug-errors.json. Rules from a file can also have an unknown tile, an unknown turn, or a bad shape. Those do not show on a card.`,
      ),
      h('div', { class: 'cases' }, ...cases),
    ),
  );
}

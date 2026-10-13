import { h } from '../lib/dom.ts';
import { line, sheet } from './sheet.ts';

const link = (href: string, text: string) =>
  h('a', { href, target: '_blank', rel: 'noopener' }, text);

export const openAbout = sheet('about', 'ABOUT', () =>
  h(
    'div',
    { class: 'lines' },
    h(
      'p',
      { class: 'lede' },
      h('b', {}, 'bauplan'),
      ' (BOW-plahn, [ˈbaʊ̯plaːn]) is German for “building plan”. In biology, a bauplan is the ',
      link('https://en.wikipedia.org/wiki/Body_plan', 'body plan'),
      ' of an animal. In this game, you also design how cells differentiate and grow with a ',
      link('https://en.wikipedia.org/wiki/Cellular_automaton', 'cellular automaton'),
      '.',
    ),
    line('MADE BY', 'Zachary Kingston, ', link('https://zkingston.com', 'zkingston.com')),
    line('SOURCE', link('https://github.com/zkingston/bauplan', 'github.com/zkingston/bauplan')),
    line(
      'FEEDBACK',
      link('https://github.com/zkingston/bauplan/issues/new', 'Open an issue on GitHub'),
    ),
    line(
      'INSPIRED BY',
      'The ',
      link('https://en.wikipedia.org/wiki/Bauhaus', 'Bauhaus'),
      ' and ',
      link('https://www.zachtronics.com/last-call-bbs/', 'X’BPGH: The Forbidden Path'),
      ', a game in Last Call BBS by Zachtronics.',
    ),
  ),
);

/** The header button that opens the about sheet. */
export const aboutButton = () => h('button', { class: 'nav-button', onclick: openAbout }, 'ABOUT');

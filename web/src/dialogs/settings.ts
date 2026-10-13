import { isObj } from '@bauplan/engine';
import { applyColors } from '../lib/colors.ts';
import { downloadJson, h } from '../lib/dom.ts';
import { exportData, importData, saveSettings, settings } from '../lib/store.ts';
import { line, sheet } from './sheet.ts';

/** A choice of the colors: three dots in those colors, and a name. */
function colorChoice(cvd: boolean, name: string, onPick: () => void) {
  const vars = cvd ? ['--cvd-b', '--cvd-r', '--cvd-y'] : ['--std-b', '--std-r', '--std-y'];
  const dots = vars.map((v) => h('span', { class: 'dot', style: `background: var(${v})` }));
  return h('button', { class: 'choice', onclick: onPick }, ...dots, name);
}

/** Download all of the data as a progress file. */
const exportFile = () =>
  downloadJson(`bauplan-${new Date().toISOString().slice(0, 10)}.json`, {
    bauplan: 1,
    data: exportData(),
  });

const openSettings = sheet('settings', 'SETTINGS', () => {
  const note = h('p', { class: 'note', role: 'status' });
  const choices = [
    colorChoice(false, 'DEFAULT', () => setCvd(false)),
    colorChoice(true, 'ACCESSIBLE', () => setCvd(true)),
  ];
  const showChoice = () =>
    choices.forEach((b, i) => b.setAttribute('aria-pressed', String(settings().cvd === (i === 1))));
  function setCvd(cvd: boolean) {
    if (settings().cvd === cvd) return;
    saveSettings({ ...settings(), cvd });
    applyColors();
    // The screen draws again, and closed sheets that name colors are made again.
    document.dispatchEvent(new Event('bauplan:colors'));
    showChoice();
  }
  showChoice();
  // An import replaces all of the data, after a question, and the page loads again with it.
  const file = h('input', {
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    onchange: async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      let j: unknown;
      try {
        j = JSON.parse(await f.text());
      } catch {
        j = undefined;
      }
      if (!isObj(j) || j.bauplan !== 1 || !isObj(j.data)) {
        note.textContent = 'This is not a bauplan progress file.';
        return;
      }
      const ask =
        'Replace your progress, rules, Custom puzzles, editor draft, and Unlimited board with the ones in this file?';
      if (!confirm(ask)) return;
      importData(j.data);
      location.reload();
    },
  });
  return h(
    'div',
    { class: 'lines' },
    line('COLORS', h('div', { class: 'choices' }, ...choices)),
    line(
      'PROGRESS',
      h(
        'div',
        { class: 'choices' },
        h('button', { onclick: exportFile }, 'EXPORT'),
        h('button', { onclick: () => file.click() }, 'IMPORT'),
        file,
      ),
      note,
    ),
  );
});

/** The header button that opens the settings sheet. */
export const settingsButton = () =>
  h('button', { class: 'nav-button', onclick: openSettings }, 'SETTINGS');

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { browser, sleep, type Page } from './browser.ts';

const desktop = browser();
const phone = browser({ phone: true });

const title = (p: Page, k: string) => p.ev(`document.querySelector('[data-k="${k}"]').title`);
const filled = (p: Page) => p.ev(`document.querySelectorAll('.rule:not(.blank)').length`);
/** A tab on level 1, with no saved rules: tests in a file share the storage of the browser. */
async function fresh() {
  const p = await desktop();
  await p.go('#/');
  await p.ev('localStorage.clear()');
  await p.go('#/play/1');
  return p;
}
const note = (p: Page) =>
  p.ev(
    `!document.querySelector('[data-k="clear"]').parentElement.querySelector('.hint-box').hidden`,
  );

describe('play', () => {
  it('drops a brush from the palette on a rule tile', async () => {
    const p = await desktop();
    await p.go('#/play/1');
    const before = await title(p, 'r0.condition.1');
    await p.drag(await p.center('[data-k="b.empty"]'), await p.center('[data-k="r0.condition.1"]'));
    assert.notEqual(await title(p, 'r0.condition.1'), before);
    assert.equal(await filled(p), 1);
    assert.deepEqual(p.errors, []);
  });

  it('shows the controls under ? on a desktop, and has no ? on a phone', async () => {
    const p = await desktop();
    await p.go('#/play/1');
    const shown = () => p.ev(`document.querySelector('.help').checkVisibility()`);
    assert.equal(await shown(), false);
    await p.ev(`document.querySelector('.help-button').click()`);
    assert.equal(await shown(), true);
    assert.equal(await p.ev(`document.querySelectorAll('.help .keys h3').length`), 3);
    const q = await phone();
    await q.go('#/play/1');
    assert.equal(await q.ev(`document.querySelector('.help-button')`), null);
    assert.deepEqual([...p.errors, ...q.errors], []);
  });

  it('does not drag a rule to a slot past the limit of the puzzle', async () => {
    const p = await fresh();
    await p.drag(await p.center('[data-k="b.empty"]'), await p.center('[data-k="r0.condition.1"]'));
    assert.equal(await p.ev(`document.querySelectorAll('.rule')[1].matches('.locked')`), true);
    await p.drag(await p.center('[data-k="r0.handle"]'), await p.center('.rule.locked'));
    assert.equal(await p.ev(`document.querySelector('.rule').matches('.blank')`), false);
    assert.equal(await filled(p), 1);
    assert.deepEqual(p.errors, []);
  });

  it('undoes and redoes a change to the rules, with the buttons and the keys', async () => {
    const p = await fresh();
    await p.drag(await p.center('[data-k="b.empty"]'), await p.center('[data-k="r0.condition.1"]'));
    assert.equal(await filled(p), 1);
    await p.ev(`document.querySelector('[aria-label="undo"]').click()`);
    assert.equal(await filled(p), 0);
    await p.ev(`document.querySelector('[aria-label="redo"]').click()`);
    assert.equal(await filled(p), 1);
    // Ctrl + Z, then ctrl + shift + Z.
    await p.key('z', 2);
    assert.equal(await filled(p), 0);
    await p.key('Z', 2 | 8);
    assert.equal(await filled(p), 1);
    assert.equal(await p.ev(`document.querySelector('[aria-label="redo"]').disabled`), true);
    assert.deepEqual(p.errors, []);
  });

  it('copies a link to the rules that opens the level with them', async () => {
    const p = await fresh();
    // A wedge that copies itself ahead solves the first level.
    await p.drag(await p.center('[data-k="b.sW"]'), await p.center('[data-k="r0.condition.4"]'));
    await p.drag(await p.center('[data-k="b.sW"]'), await p.center('[data-k="r0.change.1"]'));
    await p.ev(
      `[...document.querySelectorAll('.help-corner button')].find((b) => b.textContent === 'SHARE').click()`,
    );
    await p.until(`document.querySelector('.hint').textContent === 'Link copied.'`);
    const link = await p.ev<string>('navigator.clipboard.readText()');
    assert.match(link, /#\/r\/line\/[\w-]+$/);
    // A step brings a new message, so the share message goes.
    await p.ev(`document.querySelector('[aria-label="step"]').click()`);
    assert.equal(await p.ev(`document.querySelector('.hint').textContent`), '');
    // A page on plain http has no clipboard API. A click still copies the link.
    await p.ev(`navigator.clipboard.writeText('')`);
    await p.ev(
      `Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })`,
    );
    const at = await p.center('[title="copy a link to these rules"]');
    await p.mouse('mousePressed', at);
    await p.mouse('mouseReleased', at);
    await p.until(`document.querySelector('.hint').textContent === 'Link copied.'`);
    await p.ev(`delete navigator.clipboard`);
    assert.equal(await p.ev<string>('navigator.clipboard.readText()'), link);
    await p.ev(`document.querySelector('[aria-label="undo"]').click()`);
    await p.ev(`document.querySelector('[aria-label="undo"]').click()`);
    assert.equal(await filled(p), 0);
    await p.send('Page.navigate', { url: link });
    await p.until(`location.hash === '#/play/1'`);
    await p.until(`document.querySelectorAll('.rule:not(.blank)').length === 1`);
    assert.match(String(await title(p, 'r0.change.1')), /wedge/);
    assert.deepEqual(p.errors, []);
  });

  it('shows the pieces in the colors for color vision, from the settings', async () => {
    const p = await desktop();
    await p.go('#/play/1');
    const cvd = () => p.ev(`document.documentElement.hasAttribute('data-cvd')`);
    await p.ev(
      `[...document.querySelectorAll('nav button')].find((b) => b.textContent === 'SETTINGS').click()`,
    );
    await p.ev(`[...document.querySelectorAll('.settings .choice')][1].click()`);
    assert.equal(await cvd(), true);
    assert.equal(await p.ev(`document.querySelector('[data-k="b.cb"]').title`), 'purple');
    await p.go('#/play/1');
    assert.equal(await cvd(), true);
    await p.ev(
      `[...document.querySelectorAll('nav button')].find((b) => b.textContent === 'SETTINGS').click()`,
    );
    await p.ev(`[...document.querySelectorAll('.settings .choice')][0].click()`);
    assert.equal(await cvd(), false);
    assert.equal(await p.ev(`document.querySelector('[data-k="b.cb"]').title`), 'blue');
    assert.deepEqual(p.errors, []);
  });

  it('resets the rules only on a second click', async () => {
    const p = await desktop();
    await p.go('#/play/1');
    await p.drag(await p.center('[data-k="b.empty"]'), await p.center('[data-k="r0.condition.1"]'));
    const reset = await p.center('[data-k="clear"]');
    const click = async (at: [number, number]) => {
      await p.mouse('mousePressed', at);
      await p.mouse('mouseReleased', at);
      await sleep(150);
    };
    // The hint opens and closes, and each of the two buttons closes the box of the other.
    const hint = await p.center('.hint-button');
    const shown = () => p.ev(`!document.querySelector('.hint-dock > .hint-box').hidden`);
    await click(hint);
    assert.equal(await shown(), true);
    await click(reset);
    assert.deepEqual([await shown(), await note(p)], [false, true]);
    await click(hint);
    assert.deepEqual([await shown(), await note(p)], [true, false]);
    await click(hint);
    assert.equal(await shown(), false);
    await click(reset);
    assert.deepEqual([await note(p), await filled(p)], [true, 1]);
    // A click elsewhere cancels.
    await click([640, 300]);
    assert.deepEqual([await note(p), await filled(p)], [false, 1]);
    await click(reset);
    await click(reset);
    assert.deepEqual([await note(p), await filled(p)], [false, 0]);
    assert.deepEqual(p.errors, []);
  });

  it('drops a brush with a touch on a phone', async () => {
    const p = await phone();
    await p.go('#/play/1');
    assert.ok(await p.ev(`document.documentElement.classList.contains('phone')`));
    const before = await title(p, 'r0.condition.1');
    await p.touchDrag(
      await p.center('[data-k="b.empty"]'),
      await p.center('[data-k="r0.condition.1"]'),
    );
    assert.notEqual(await title(p, 'r0.condition.1'), before);
    assert.deepEqual(p.errors, []);
  });
});

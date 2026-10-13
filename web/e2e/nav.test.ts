import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { browser, sleep } from './browser.ts';

const page = browser();
const phone = browser({ phone: true });

describe('navigation', () => {
  it('opens each screen and dialog without an error', async () => {
    const p = await page();
    for (const hash of ['#/', '#/play/1', '#/play/3', '#/edit', '#/custom', '#/unlimited']) {
      await p.go(hash);
      assert.ok(await p.ev(`!!document.querySelector('main *')`), hash);
    }
    await p.go('#/');
    for (const name of ['TUTORIAL', 'ABOUT']) {
      await p.ev(
        `[...document.querySelectorAll('nav button')].find((b) => b.textContent === '${name}').click()`,
      );
      await p.until(`document.querySelector('dialog[open]')`);
      await p.key('Escape');
      await p.until(`!document.querySelector('dialog[open]')`);
    }
    assert.deepEqual(p.errors, []);
  });

  it('follows a link on a click, Enter, and ctrl-click, without an address to show', async () => {
    const p = await page();
    await p.go('#/');
    assert.equal(await p.ev(`document.querySelectorAll('a[href]').length`), 0);
    await p.mouse('mousePressed', await p.center('nav a[data-href="#/edit"]'));
    await p.mouse('mouseReleased', await p.center('nav a[data-href="#/edit"]'));
    await p.until(`location.hash === '#/edit'`);
    await p.ev(`document.querySelector('nav a[data-href="#/custom"]').focus()`);
    await p.key('Enter');
    await p.until(`location.hash === '#/custom'`);
    // Ctrl and a click open a new tab, and this tab stays.
    await p.ev(`window.opened = []; window.open = (u) => void window.opened.push(u)`);
    const at = await p.center('nav a[data-href="#/unlimited"]');
    await p.mouse('mousePressed', at, 2);
    await p.mouse('mouseReleased', at, 2);
    assert.deepEqual(await p.ev(`[location.hash, window.opened]`), [
      '#/custom',
      [p.base + '#/unlimited'],
    ]);
    assert.deepEqual(p.errors, []);
  });

  it('has a menu on a phone that a choice or a tap outside closes', async () => {
    const p = await phone();
    await p.go('#/');
    const open = () => p.ev(`document.querySelector('.menu').matches(':popover-open')`);
    const tap = async (at: [number, number]) => {
      await p.mouse('mousePressed', at);
      await p.mouse('mouseReleased', at);
    };
    assert.equal(await p.ev(`document.querySelector('header > nav').checkVisibility()`), false);
    await tap(await p.center('.menu-button'));
    assert.equal(await open(), true);
    await tap(await p.center('.menu a[data-href="#/unlimited"]'));
    await p.until(`location.hash === '#/unlimited'`);
    assert.equal(await open(), false);
    await tap(await p.center('.menu-button'));
    await p.ev(
      `[...document.querySelectorAll('.menu button')].find((b) => b.textContent === 'SETTINGS').click()`,
    );
    await p.until(`document.querySelector('dialog[open].settings')`);
    assert.equal(await open(), false);
    await p.key('Escape');
    await tap(await p.center('.menu-button'));
    assert.equal(await open(), true);
    await tap([200, 800]);
    assert.equal(await open(), false);
    assert.deepEqual(p.errors, []);
  });

  it('fits the first tutorial page again when its text grows, as when a font loads', async () => {
    const p = await phone();
    await p.send('Emulation.setDeviceMetricsOverride', {
      width: 412,
      height: 725,
      deviceScaleFactor: 2,
      mobile: true,
      screenOrientation: { type: 'portraitPrimary', angle: 0 },
    });
    await p.go('#/');
    await p.ev(`document.querySelector('.menu-button').click()`);
    await p.ev(
      `[...document.querySelectorAll('.menu button')].find((b) => b.textContent === 'TUTORIAL').click()`,
    );
    await p.until(`document.querySelector('dialog[open].tutorial')`);
    const width = () => p.ev<string>(`document.querySelector('.intro canvas').style.width`);
    const before = await width();
    await p.ev(`document.querySelector('.intro p').style.fontSize = '19px'`);
    await sleep(200);
    assert.notEqual(await width(), before);
    const fits = `(() => { const d = document.querySelector('dialog[open]'); return d.scrollHeight <= d.clientHeight; })()`;
    assert.equal(await p.ev(fits), true);
    assert.equal(await p.ev(`document.querySelector('.page-more').hidden`), true);
    assert.deepEqual(p.errors, []);
  });
});

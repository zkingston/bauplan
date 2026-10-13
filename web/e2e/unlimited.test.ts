import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { browser, sleep, type Page } from './browser.ts';

const page = browser();

/** A tab on Unlimited, with no saved setup. */
async function fresh() {
  const p = await page();
  await p.go('#/');
  await p.ev('localStorage.clear()');
  await p.go('#/unlimited');
  return p;
}

const pieces = (p: Page) => p.ev<number>(`+document.querySelector('.plane').dataset.pieces`);
const settle = (p: Page, n: number) =>
  p.until(`+document.querySelector('.plane').dataset.pieces === ${n}`);
const click = (p: Page, selector: string) =>
  p.ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
/** The camera, as the screen saves it. */
const camera = async (p: Page) => {
  await p.ev(`dispatchEvent(new Event('pagehide'))`);
  return p.ev(`JSON.parse(localStorage.getItem('bauplan.v1.unlimited')).cam`);
};

describe('Unlimited', () => {
  it('pans with a drag and a scroll, and zooms with ctrl and the wheel', async () => {
    const p = await fresh();
    const [x, y] = await p.center('.plane');
    assert.equal(
      await p.ev(`document.querySelector('[data-k="b.pan"]').classList.contains('on')`),
      true,
    );
    const c0 = await camera(p);
    await p.drag([x, y], [x - 100, y - 50]);
    const c1 = await camera(p);
    assert.ok(c1.x > c0.x && c1.y > c0.y);
    const wheel = async (deltaY: number, modifiers = 0) => {
      for (let k = 0; k < 4; k++)
        await p.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x,
          y,
          deltaX: 0,
          deltaY,
          modifiers,
        });
      await sleep(200);
    };
    await wheel(120);
    const c2 = await camera(p);
    assert.ok(c2.y > c1.y && c2.z === c1.z);
    await wheel(20, 2);
    assert.ok((await camera(p)).z < c2.z);
    assert.equal(await pieces(p), 0);
    assert.deepEqual(p.errors, []);
  });

  it('paints, erases with the same piece, and undoes each stroke and a clear', async () => {
    const p = await fresh();
    const [x, y] = await p.center('.plane');
    await click(p, '[data-k="b.sS"]');
    await p.drag([x - 64, y], [x + 64, y]);
    const n = await pieces(p);
    assert.ok(n >= 3);
    // A tap on the same piece removes it.
    await p.drag([x, y], [x, y]);
    await settle(p, n - 1);
    await click(p, '[aria-label="undo"]');
    await settle(p, n);
    await p.key('z', 2);
    await settle(p, 0);
    assert.equal(await p.ev(`document.querySelector('[aria-label="undo"]').disabled`), true);
    await p.drag([x - 64, y], [x + 64, y]);
    await settle(p, n);
    await click(p, '[data-k="clear-board"]');
    await click(p, '[data-k="clear-board"]');
    await settle(p, 0);
    await p.key('z', 2);
    await settle(p, n);
    assert.deepEqual(p.errors, []);
  });

  it('paints the tile under a brush that drops on the board', async () => {
    const p = await fresh();
    await p.drag(await p.center('[data-k="b.sQ"]'), await p.center('.plane'));
    await settle(p, 1);
    // The zoom buttons are not part of the board.
    await p.drag(
      await p.center('[data-k="b.sS"]'),
      await p.center('[aria-label="show all of the board"]'),
    );
    await sleep(300);
    assert.equal(await pieces(p), 1);
    assert.deepEqual(p.errors, []);
  });

  it('loads an example from the help in place of the rules and the board', async () => {
    const p = await fresh();
    const [x, y] = await p.center('.plane');
    await click(p, '[data-k="b.sS"]');
    await p.drag([x - 64, y], [x + 64, y]);
    const shown = () => p.ev(`document.querySelector('.help').checkVisibility()`);
    assert.equal(await shown(), false);
    await click(p, '[aria-label="help"]');
    assert.equal(await shown(), true);
    // The board has pieces, so the example asks first, and the browser of the tests says yes.
    await click(p, '.help .example button');
    await settle(p, 5);
    assert.equal(await p.ev(`document.querySelector('.help').hidden`), true);
    await click(p, '[aria-label="step"]');
    await p.until(`+document.querySelector('.plane').dataset.pieces > 5`);
    assert.deepEqual(p.errors, []);
  });

  it('pauses with a press that a fast run does not lose', async () => {
    const p = await fresh();
    await click(p, '[aria-label="help"]');
    await click(p, '.help .example button');
    await settle(p, 5);
    // At 60 steps each second, the transport changes during the press.
    await click(p, '[aria-label="faster"]');
    await click(p, '[aria-label="faster"]');
    await click(p, '.transport [aria-label="play"]');
    await sleep(500);
    const [x, y] = await p.center('.transport [aria-label="pause"]');
    const press = { x, y, button: 'left', clickCount: 1 };
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...press });
    await sleep(100);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...press });
    await p.until(`document.querySelector('.transport [aria-label="play"]')`);
    assert.deepEqual(p.errors, []);
  });

  it('shares a link that opens the same board, and refuses a broken link', async () => {
    const p = await fresh();
    const [x, y] = await p.center('.plane');
    await click(p, '[data-k="b.sS"]');
    await p.drag([x - 64, y], [x + 64, y]);
    const n = await pieces(p);
    await click(p, '[aria-label^="copy a link"]');
    await p.until(`document.querySelector('.status').textContent === 'Link copied.'`);
    const link = await p.ev<string>('navigator.clipboard.readText()');
    assert.match(link, /#\/u\/[\w-]+$/);
    // The line of a piece under the mouse replaces the share message.
    await p.mouse('mouseMoved', [x, y]);
    await p.until(`!['', 'Link copied.'].includes(document.querySelector('.status').textContent)`);
    await click(p, '[data-k="clear-board"]');
    await click(p, '[data-k="clear-board"]');
    await settle(p, 0);
    // The link asks before it replaces the board, and the browser of the tests says yes.
    await p.send('Page.navigate', { url: link });
    await p.until(`location.hash === '#/unlimited'`);
    await settle(p, n);
    await p.go('#/u/broken!');
    await p.until(`document.querySelector('main a[data-href="#/unlimited"]')`);
    assert.deepEqual(p.errors, []);
  });
});

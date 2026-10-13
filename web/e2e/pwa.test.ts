import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { browser } from './browser.ts';

const page = browser();

describe('install', () => {
  it('has a manifest that a browser can install, and plays offline after one visit', async () => {
    const p = await page();
    await p.go('#/');
    const manifest = await p.send('Page.getAppManifest');
    assert.deepEqual(manifest.errors, []);
    assert.deepEqual((await p.send('Page.getInstallabilityErrors')).installabilityErrors, []);
    await p.until(`navigator.serviceWorker.ready.then(() => true)`);
    await p.send('Page.reload');
    await p.until(`!!navigator.serviceWorker.controller && !!document.querySelector('.panel')`);
    p.offline(true);
    // A file that is not in the cache does not load.
    assert.equal(await p.ev(`fetch('nothing').then(() => 'online', () => 'offline')`), 'offline');
    await p.send('Page.reload');
    await p.until(`!!document.querySelector('.panel')`);
    await p.go('#/play/1');
    p.offline(false);
    assert.deepEqual(p.errors, []);
  });
});

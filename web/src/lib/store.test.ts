import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exportData, importData, progress, recordWin, saveSettings, settings } from './store.ts';

describe('store', () => {
  it('exports all of the data, and an import replaces it and leaves out unknown keys', () => {
    recordWin('0123456789abcdef', { rules: 2, conds: 1, steps: 9 });
    saveSettings({ cvd: true });
    const file = exportData();
    assert.deepEqual(file.progress, { '0123456789abcdef': { rules: 2, conds: 1, steps: 9 } });
    assert.deepEqual(file.settings, { cvd: true });
    importData({ progress: { fedcba9876543210: { rules: 1, conds: 0, steps: 3 } }, other: 1 });
    assert.deepEqual(progress(), { fedcba9876543210: { rules: 1, conds: 0, steps: 3 } });
    assert.equal(settings().cvd, false);
    assert.deepEqual(Object.keys(exportData()), ['progress']);
  });
});

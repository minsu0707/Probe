import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectBrowserChannel } from '../server/modules/runs/browser.ts';
import { envWithoutElectronFlag } from '../server/core/process.ts';

test('PROBE_BROWSER forces the choice, whatever is installed', () => {
  assert.equal(detectBrowserChannel({ PROBE_BROWSER: 'chrome' }), 'chrome');
  assert.equal(detectBrowserChannel({ PROBE_BROWSER: 'MSEDGE' }), 'msedge');
});

test('PROBE_BROWSER=chromium selects Playwright\'s bundled browser', () => {
  assert.equal(detectBrowserChannel({ PROBE_BROWSER: 'chromium' }), undefined);
});

test('without an override the result is a known channel or the bundled browser', () => {
  assert.ok([undefined, 'msedge', 'chrome'].includes(detectBrowserChannel({})));
});

test('the Electron flag is removed from the environment given to native programs', () => {
  const env = envWithoutElectronFlag({ ELECTRON_RUN_AS_NODE: '1', PATH: 'x', PROBE_HOME: 'y' });
  assert.deepEqual(env, { PATH: 'x', PROBE_HOME: 'y' });
});

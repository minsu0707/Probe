import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStartupVbs } from '../scripts/startup-script.ts';

const sample = { nodePath: 'C:\\Program Files\\nodejs\\node.exe', launchScript: 'C:\\Users\\a b\\Probe\\scripts\\launch.ts', root: 'C:\\Users\\a b\\Probe' };

test('the startup script runs hidden (window style 0) and does not wait', () => {
  assert.match(buildStartupVbs(sample), /, 0, False\r?$/m);
});

test('paths with spaces stay quoted inside the VBScript string', () => {
  const vbs = buildStartupVbs(sample);
  // Each path is wrapped in doubled quotes inside the outer VBScript literal.
  assert.ok(vbs.includes('"""C:\\Program Files\\nodejs\\node.exe"" ""C:\\Users\\a b\\Probe\\scripts\\launch.ts"" --no-open --no-pause"'));
});

test('autostart starts the server without opening a browser or waiting for a keypress', () => {
  const vbs = buildStartupVbs(sample);
  assert.match(vbs, /--no-open/);
  assert.match(vbs, /--no-pause/);
});

test('the working directory is set to the Probe folder', () => {
  assert.match(buildStartupVbs(sample), /sh\.CurrentDirectory = "C:\\Users\\a b\\Probe"/);
});

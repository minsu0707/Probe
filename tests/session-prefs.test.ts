import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolatedHome } from './helpers.ts';

isolatedHome();
const services = await import('../server/modules/services/service.ts');
const prefs = await import('../server/modules/sessions/prefs.ts');
const { buildArgs } = await import('../server/modules/sessions/service.ts');

const base = { prompt: 'x', claudeSessionId: 'abc', resume: false, system: 's' };
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test('the choice is kept per service and starts from the safe defaults', () => {
  const a = services.createService({ name: 'PrefA' });
  const b = services.createService({ name: 'PrefB' });
  assert.deepEqual(prefs.getPrefs(a.id), { mode: 'acceptEdits', model: 'sonnet', effort: 'medium' });
  prefs.setPrefs(a.id, { model: 'opus' });
  prefs.setPrefs(a.id, { mode: 'plan' });
  assert.deepEqual(prefs.getPrefs(a.id), { mode: 'plan', model: 'opus', effort: 'medium' }, 'a later change keeps the earlier ones');
  assert.equal(prefs.getPrefs(b.id).model, 'sonnet', 'another service is untouched');
});

test('mode, model and effort reach the command line only when chosen', () => {
  const plain = buildArgs(base);
  assert.equal(after(plain, '--permission-mode'), 'acceptEdits');
  assert.equal(after(plain, '--model'), 'sonnet');
  assert.equal(after(plain, '--effort'), 'medium');
  const cli = buildArgs({ ...base, prefs: { mode: 'acceptEdits', model: 'default', effort: 'default' } });
  assert.ok(!cli.includes('--model') && !cli.includes('--effort'), '"Default" leaves it to the CLI');
  const chosen = buildArgs({ ...base, prefs: { mode: 'plan', model: 'sonnet', effort: 'high' } });
  assert.equal(after(chosen, '--permission-mode'), 'plan');
  assert.equal(after(chosen, '--model'), 'sonnet');
  assert.equal(after(chosen, '--effort'), 'high');
});

test('Auto and Bypass open the shell and web, except on a read-only service', () => {
  for (const mode of ['auto', 'bypassPermissions'] as const) {
    assert.ok(!buildArgs({ ...base, prefs: { mode, model: 'default', effort: 'default' } }).includes('--disallowedTools'));
    const guarded = buildArgs({ ...base, readOnly: true, prefs: { mode, model: 'default', effort: 'default' } });
    assert.ok(guarded.slice(guarded.indexOf('--disallowedTools')).includes('Bash'));
  }
  assert.ok(buildArgs({ ...base, prefs: { mode: 'plan', model: 'default', effort: 'default' } }).includes('--disallowedTools'));
});

test('a turn running beside a writer cannot write files or run commands, even in a wide mode', () => {
  const args = buildArgs({ ...base, noWrites: true, prefs: { mode: 'bypassPermissions', model: 'default', effort: 'default' } });
  const denied = args.slice(args.indexOf('--disallowedTools') + 1);
  for (const tool of ['Write', 'Edit', 'Bash']) assert.ok(denied.includes(tool), tool);
});

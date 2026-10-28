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
  assert.deepEqual(prefs.getPrefs(a.id), { mode: 'acceptEdits', model: 'default', effort: 'default' });
  prefs.setPrefs(a.id, { model: 'opus' });
  prefs.setPrefs(a.id, { mode: 'plan' });
  assert.deepEqual(prefs.getPrefs(a.id), { mode: 'plan', model: 'opus', effort: 'default' }, 'a later change keeps the earlier ones');
  assert.equal(prefs.getPrefs(b.id).model, 'default', 'another service is untouched');
});

test('mode, model and effort reach the command line only when chosen', () => {
  const plain = buildArgs(base);
  assert.equal(after(plain, '--permission-mode'), 'acceptEdits');
  assert.ok(!plain.includes('--model') && !plain.includes('--effort'));
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

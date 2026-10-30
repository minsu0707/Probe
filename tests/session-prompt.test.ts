import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSystemPrompt } from '../server/modules/sessions/prompt.ts';
import { isolatedHome } from './helpers.ts';

isolatedHome();

const prompt = buildSystemPrompt({ serviceName: 'S', baseUrl: null, envNames: [], knowledgeFiles: [] });

test('Claude writes the cases and the user runs them; it runs a spec only when asked', () => {
  assert.match(prompt, /running them is the user's step/);
  assert.match(prompt, /Do not call run_tests or get_run on your own/);
  assert.match(prompt, /only when the user explicitly asks you to run/);
  // The old rules that made Claude run every spec it wrote must be gone.
  assert.doesNotMatch(prompt, /not finished until you have run it/);
  assert.doesNotMatch(prompt, /you run it/);
  assert.doesNotMatch(prompt, /run it \(see above\)/);
});

test('the reply points the user at where to run, and still allows running on request', () => {
  assert.match(prompt, /테스트 케이스 tab/);
  assert.match(prompt, /선택 실행/);
  assert.match(prompt, /When the user does ask you to run: call run_tests/); // still available on request
  assert.match(prompt, /never start a second run while one is going/);
});

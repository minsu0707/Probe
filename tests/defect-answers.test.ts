import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolatedHome } from './helpers.ts';
import { buildSystemPrompt } from '../server/modules/sessions/prompt.ts';

isolatedHome();
const services = await import('../server/modules/services/service.ts');
const defects = await import('../server/modules/defects/service.ts');

const service = services.createService({ name: 'Answers' });
const fail = (error: string) => defects.recordFailure({ serviceId: service.id, runId: 'r1', testTitle: ['배합', '합계 100%'], feature: '배합', page: '/p', error });

test('an answer sets the status, sticks to the failure and is shown to Claude', () => {
  const d = fail('Expected 100 Received 60');
  assert.equal(d.answer, null);
  const answered = defects.answerDefect(d.id, { verdict: 'intended', note: '  합계가 100이 아니면 저장이 막히는 게 정상  ' });
  assert.equal(answered.status, 'false_positive');
  assert.equal(answered.answer?.note, '합계가 100이 아니면 저장이 막히는 게 정상');

  // the same failure again: still the same defect, still answered, still dismissed
  const again = fail('Expected 100 Received 70');
  assert.equal(again.id, d.id);
  assert.equal(again.answer?.verdict, 'intended');
  assert.equal(again.status, 'false_positive');

  const prompt = buildSystemPrompt({ serviceName: 'S', baseUrl: null, envNames: [], knowledgeFiles: [], answers: defects.recentAnswers(service.id, 40) });
  assert.match(prompt, /ALREADY TOLD YOU[\s\S]*합계 100%[\s\S]*intended behaviour[\s\S]*저장이 막히는 게 정상/);
});

test('"app bug" confirms, a wrong verdict is refused, and clearing forgets the answer', () => {
  const d = fail('strict mode violation: getByText resolved to 2 elements');
  assert.equal(defects.answerDefect(d.id, { verdict: 'app' }).status, 'confirmed');
  assert.throws(() => defects.answerDefect(d.id, { verdict: 'whatever' }), /Bad answer/);
  assert.equal(defects.clearAnswer(d.id).answer, null);
});

test('without answers the prompt still tells Claude what to do when unsure', () => {
  const prompt = buildSystemPrompt({ serviceName: 'S', baseUrl: null, envNames: [], knowledgeFiles: [] });
  assert.doesNotMatch(prompt, /ALREADY TOLD YOU/);
  assert.match(prompt, /do not guess and do not skip/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolatedHome } from './helpers.ts';

isolatedHome();
const services = await import('../server/modules/services/service.ts');
const repo = await import('../server/modules/sessions/repository.ts');
const sessions = await import('../server/modules/sessions/service.ts');
const { HttpError } = await import('../server/core/errors.ts');

const service = services.createService({ name: 'QueueSvc' });
repo.insert({ id: 's1', serviceId: service.id, title: 't', kind: 'chat', claudeSessionId: 'c1', now: 1 });

test('queued messages keep their order and survive being read back', () => {
  repo.enqueue('s1', 'first', 10);
  repo.enqueue('s1', 'second', 11);
  assert.deepEqual(
    repo.queue('s1').map((q) => q.text),
    ['first', 'second'],
  );
  assert.equal(sessions.getSession('s1').queue.length, 2);
});

test('a message put back keeps its place at the front', () => {
  const [first] = repo.queue('s1');
  repo.dequeue('s1', first.id);
  assert.deepEqual(
    repo.queue('s1').map((q) => q.text),
    ['second'],
  );
  repo.requeue(first);
  assert.deepEqual(
    repo.queue('s1').map((q) => q.text),
    ['first', 'second'],
  );
});

test('removing a waiting message works once, and a second try is a not-found', () => {
  const [first] = repo.queue('s1');
  sessions.removeQueued('s1', first.id);
  assert.deepEqual(
    repo.queue('s1').map((q) => q.text),
    ['second'],
  );
  assert.throws(() => sessions.removeQueued('s1', first.id), HttpError);
});

test('there is nothing to send from an empty line', async () => {
  repo.dequeue('s1', repo.queue('s1')[0].id);
  await assert.rejects(() => sessions.dispatchNext('s1'), /No message is waiting/);
});

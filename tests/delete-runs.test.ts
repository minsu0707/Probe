import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolatedHome } from './helpers.ts';

isolatedHome();
const services = await import('../server/modules/services/service.ts');
const repo = await import('../server/modules/runs/repository.ts');
const runs = await import('../server/modules/runs/service.ts');
const { emptyCurrent, emptyTotals } = await import('../server/modules/runs/reduce.ts');

const service = services.createService({ name: 'RunDel' });
const make = (id: string, status: 'passed' | 'running') =>
  repo.insertRun({ id, serviceId: service.id, title: id, status, startedAt: Date.now(), endedAt: null, totals: emptyTotals(), current: emptyCurrent(), defects: 0 } as never);

test('finished runs are deleted with their log, and unknown ids are ignored', () => {
  make('r1', 'passed');
  repo.appendLog('r1', { ts: 1, kind: 'info', text: 'x' });
  assert.deepEqual(runs.deleteRuns(['r1', 'nope']), ['r1']);
  assert.equal(repo.findRun('r1'), undefined);
  assert.equal(repo.logAfter('r1', 0, 10).length, 0);
});

test('a run in progress cannot be deleted', () => {
  make('r2', 'running');
  assert.throws(() => runs.deleteRuns(['r2']), /실행 중/);
  assert.ok(repo.findRun('r2'));
});

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

test('spec file names may be in Korean, but never an option or a path out of specs/', async () => {
  const { isSafeSpecName } = await import('../server/modules/runs/delete.ts');
  for (const ok of ['e2e-01-흑임자쿠키-신제품.spec.ts', '01-login.spec.ts', 'sub/원료 등록.spec.ts'.replace(' ', '')]) assert.equal(isSafeSpecName(ok), true, ok);
  for (const bad of ['--config=x', '../x.spec.ts', 'a/../b.spec.ts', 'a b.spec.ts', 'a;b.spec.ts', 'a\b.spec.ts', '']) assert.equal(isSafeSpecName(bad), false, bad);
});

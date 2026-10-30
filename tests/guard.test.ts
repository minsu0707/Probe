import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowedOrigin } from '../server/http/guard.ts';
import { parseIngestEvents, RUN_ID } from '../server/modules/runs/ingest-input.ts';

test('only this app may open the socket or write from a browser', () => {
  for (const o of ['http://127.0.0.1:4317', 'http://localhost:4317', 'http://127.0.0.1:5173']) assert.equal(isAllowedOrigin(o), true, o);
  for (const o of ['http://evil.example', 'http://127.0.0.1:9999', 'https://127.0.0.1.evil.example:4317', 'null', '', 'not a url']) assert.equal(isAllowedOrigin(o), false, o);
});

test('a run id is a plain token, never a path', () => {
  for (const id of ['3912cb4b', 'run_1-a']) assert.equal(RUN_ID.test(id), true, id);
  for (const id of ['..', '../x', 'a/b', 'a\b', '', 'x'.repeat(65)]) assert.equal(RUN_ID.test(id), false, id);
});

test('the reporter batch must be a list of known events', () => {
  assert.equal(parseIngestEvents([{ type: 'run:plan', total: 1 }, { type: 'act', id: 'a', what: 'fill', target: 't' }]).length, 2);
  for (const bad of [null, {}, 'x', [{}], [{ type: 'nope' }], [null], [{ type: 5 }], Array.from({ length: 501 }, () => ({ type: 'step' }))]) assert.throws(() => parseIngestEvents(bad));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowRequest } from '../reporter/guard.ts';
import { buildSystemPrompt } from '../server/modules/sessions/prompt.ts';
import { isolatedHome } from './helpers.ts';

isolatedHome();
const services = await import('../server/modules/services/service.ts');

test('reads pass; writes are refused except sign-in and GraphQL queries', () => {
  assert.equal(allowRequest('GET', 'https://x.test/api/items'), true);
  assert.equal(allowRequest('OPTIONS', 'https://x.test/api/items'), true);
  assert.equal(allowRequest('POST', 'https://x.test/api/items'), false);
  assert.equal(allowRequest('DELETE', 'https://x.test/api/items/3'), false);
  assert.equal(allowRequest('PUT', 'https://x.test/api/materials/3'), false);
  assert.equal(allowRequest('POST', 'https://x.test/api/auth/login'), true);
  assert.equal(allowRequest('POST', 'https://x.test/oauth/token'), true);
  assert.equal(allowRequest('POST', 'https://x.test/graphql', '{"query":"{ items { id } }"}'), true);
  assert.equal(allowRequest('POST', 'https://x.test/graphql', '{"query":"mutation { delete(id: 1) }"}'), false);
  assert.equal(allowRequest('POST', 'not a url'), false);
});

test('a service is writable by default, and read-only can be set at creation and changed later', () => {
  const normal = services.createService({ name: 'Normal' });
  assert.equal(normal.readOnly, false);
  const risky = services.createService({ name: 'Risky', readOnly: true });
  assert.equal(services.requireService(risky.id).readOnly, true);

  assert.equal(services.updateService(risky.id, { notes: 'x' }).readOnly, true, 'an edit that does not mention it keeps it');
  assert.equal(services.updateService(risky.id, { readOnly: false }).readOnly, false);
  assert.equal(services.updateService(normal.id, { readOnly: true }).readOnly, true);
});

test('the Claude session is told when a service is read-only', () => {
  const base = { serviceName: 'S', baseUrl: null, envNames: [], knowledgeFiles: [] };
  assert.doesNotMatch(buildSystemPrompt(base), /read-only/);
  const p = buildSystemPrompt({ ...base, readOnly: true });
  assert.match(p, /조회 전용 \(read-only\)/);
  assert.match(p, /조회 전용이라 제외/);
});

test('specs are organised by feature, numbered in process order, and tagged by priority', () => {
  const p = buildSystemPrompt({ serviceName: 'S', baseUrl: null, envNames: [], knowledgeFiles: ['screens.md'] });
  assert.match(p, /one spec file per feature/);
  assert.match(p, /01-login\.spec\.ts/);
  assert.match(p, /not by priority/);
  assert.match(p, /tag: '@P0'/);
});

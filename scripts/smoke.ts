/**
 * End-to-end smoke test: starts the real server against a throwaway data folder and a tiny
 * demo website, registers a service, runs real Playwright specs through the API, and checks
 * what a user would see (counts, a deduplicated defect, masked credentials, the security
 * guard). It takes about 20 seconds and needs the Playwright browsers installed.
 *
 *   npm run smoke
 */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4411;
const TARGET_PORT = 4412;
const API = `http://127.0.0.1:${PORT}/api`;
const SECRET = 'smoke-secret-9f3a';

const home = mkdtempSync(join(tmpdir(), 'probe-smoke-'));

// A three-page shop. The cart total is deliberately wrong (3,500 instead of 3,000).
const target = http
  .createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const page = (title: string, body: string) => `<!doctype html><meta charset=utf-8><title>${title}</title><h1>${title}</h1>${body}`;
    if (req.url === '/') return res.end(page('홈', '<input id=u><input id=p type=password><button onclick="location=\'/products\'">로그인</button>'));
    if (req.url === '/products') return res.end(page('상품 목록', '<ul><li>사과 1,000원</li><li>배 2,000원</li></ul>'));
    if (req.url === '/cart') return res.end(page('장바구니', '<p id=total>합계 3,500원</p>'));
    res.statusCode = 404;
    res.end(page('없음', ''));
  })
  .listen(TARGET_PORT, '127.0.0.1');

const server = spawn(process.execPath, [join(ROOT, 'server', 'main.ts')], { cwd: ROOT, env: { ...process.env, PROBE_HOME: home, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function call<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json' } });
  if (res.status === 204) return undefined as T;
  const body = await res.json();
  assert.ok(res.ok, `${init?.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body)}`);
  return body;
}
const post = (path: string, body?: unknown) => call(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

async function waitFor<T>(what: string, probe: () => Promise<T | undefined>, ms = 60_000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = await probe().catch(() => undefined);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function runOnce(serviceId: string) {
  const started = await post(`/services/${serviceId}/runs`, {});
  return waitFor('the run to finish', async () => {
    const { run, log } = await call(`/runs/${started.id}`);
    return run.endedAt ? { run, log } : undefined;
  });
}

let failed = false;
try {
  await waitFor('the server to start', async () => (await fetch(`${API}/services`)).ok || undefined, 15_000);

  // --- security guard: a foreign Host header (DNS rebinding) must be refused
  const rebinding = await new Promise<number>((ok) => http.get({ host: '127.0.0.1', port: PORT, path: '/api/services', headers: { host: 'evil.example:4411' } }, (r) => ok(r.statusCode ?? 0)));
  assert.equal(rebinding, 403, 'requests with a foreign Host header are rejected');

  // --- launchers rely on this to tell Probe apart from another program on the port
  assert.equal((await call('/health')).app, 'probe');

  // --- register a service with credentials
  const svc = await post('/services', { name: '스모크 쇼핑몰', baseUrl: `http://127.0.0.1:${TARGET_PORT}` });
  await post(`/services/${svc.id}/env`, { text: `TEST_USER=qa@example.com\nTEST_PASSWORD=${SECRET}\n` });
  const env = await call(`/services/${svc.id}/env`);
  assert.equal(env.find((k: any) => k.key === 'TEST_PASSWORD').value, undefined, 'password is never returned by the API');

  // --- no specs yet: a clear error, not a crash
  const noSpecs = await fetch(`${API}/services/${svc.id}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noSpecs.status, 422);

  // --- write specs the way Claude would, then run them
  writeFileSync(
    join(home, 'services', svc.id, 'tests', 'specs', 'shop.spec.ts'),
    `import { test, expect, view } from '../probe.ts';
test.describe('로그인', () => {
  test('로그인하면 상품 목록으로 이동한다', async ({ page }) => {
    await page.goto('/');
    await view('로그인 폼', '로그인');
    await page.locator('#p').fill(process.env.TEST_PASSWORD!);
    await page.getByRole('button', { name: '로그인' }).click();
    await expect(page).toHaveURL(/products/);
  });
});
test.describe('장바구니', () => {
  test('합계가 상품 가격의 합과 같다', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.locator('#total')).toHaveText('합계 3,000원', { timeout: 2000 });
  });
  test('빈 장바구니 안내', async () => { test.skip(true, '미구현'); });
});
`,
  );

  const first = await runOnce(svc.id);
  assert.deepEqual({ passed: first.run.totals.passed, failed: first.run.totals.failed, skipped: first.run.totals.skipped }, { passed: 1, failed: 1, skipped: 1 });
  assert.equal(first.run.status, 'failed');
  assert.equal(first.run.defects, 1, 'one failing test → one defect');
  assert.ok(first.log.some((l: any) => l.kind === 'view' && l.text === '로그인 › 로그인 폼'), 'view() reaches the log');
  assert.ok(first.log.some((l: any) => l.kind === 'page' && l.text === '/cart'), 'page navigation reaches the log');

  // --- what the test typed and pressed reaches the log, which is what the session's node view reads
  const acts = first.log.filter((l: any) => l.kind === 'action').map((l: any) => JSON.parse(l.text));
  assert.ok(acts.some((a: any) => a.what === 'fill' && a.target === '#p'), 'typing into a field is reported');
  assert.ok(acts.some((a: any) => a.what === 'click' && a.target === '로그인'), 'a click is reported by the button\'s name');

  // --- the password the test typed must not appear anywhere a user can read it
  assert.ok(!JSON.stringify(first.log).includes(SECRET), 'password is masked in the run log');
  assert.ok(first.log.some((l: any) => l.text.includes('••••')), 'the mask is visible where the password was');

  // --- defect has evidence, and an identical failure is merged rather than duplicated
  let defects = await call('/defects');
  assert.equal(defects.length, 1);
  assert.equal(defects[0].status, 'candidate');
  assert.equal(defects[0].severity, 'major', '"3,500" must not be mistaken for an HTTP 500');
  assert.ok(defects[0].screenshot, 'failure screenshot was kept');
  assert.ok(!defects[0].error.includes(SECRET));

  await runOnce(svc.id);
  defects = await call('/defects');
  assert.equal(defects.length, 1, 'same failure again is merged');
  assert.equal(defects[0].occurrences, 2);

  // --- triage
  const confirmed = await call(`/defects/${defects[0].id}`, { method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }) });
  assert.equal(confirmed.status, 'confirmed');

  // --- service summary reflects it all
  const overview = await call(`/services/${svc.id}`);
  assert.equal(overview.openDefects, 1);
  assert.equal(overview.lastRun.status, 'failed');

  console.log('smoke: all checks passed');
} catch (e) {
  failed = true;
  console.error('smoke: FAILED\n', e);
  console.error('--- server log ---\n' + serverLog);
} finally {
  server.kill();
  target.close();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(home, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { isDangerousLabel, isDangerousUrl, pageKey, pagePattern, pickLogin } from '../server/modules/learning/explore-helpers.ts';
import { isolatedHome } from './helpers.ts';

test('the admin ID/password pair is chosen from the variable names', () => {
  assert.deepEqual(pickLogin(['BASE_URL', 'USER_ID', 'USER_PW', 'ADMIN_ID', 'ADMIN_PW']), { userKey: 'ADMIN_ID', passKey: 'ADMIN_PW' });
  assert.deepEqual(pickLogin(['LOGIN_USER', 'LOGIN_PASSWORD']), { userKey: 'LOGIN_USER', passKey: 'LOGIN_PASSWORD' });
  assert.deepEqual(pickLogin(['ID', 'PASSWORD']), { userKey: 'ID', passKey: 'PASSWORD' });
  assert.equal(pickLogin(['BASE_URL', 'API_TOKEN']), null);
  assert.equal(pickLogin(['ADMIN_PW']), null, 'a password with no matching ID is not a login');
});

test('logging out and deleting are never followed', () => {
  for (const text of ['로그아웃', 'Log out', 'Sign out', '회원 탈퇴', '삭제', 'Delete account', '초기화']) assert.equal(isDangerousLabel(text), true, text);
  for (const text of ['원료 관리', 'Orders', '등록', '조회']) assert.equal(isDangerousLabel(text), false, text);
  assert.equal(isDangerousUrl('https://x.test/logout'), true);
  assert.equal(isDangerousUrl('https://x.test/user/withdraw'), true);
  assert.equal(isDangerousUrl('https://x.test/#/items/delete'), true);
  assert.equal(isDangerousUrl('https://x.test/orders'), false);
});

test('pages are told apart by path and hash route, and detail pages collapse to one pattern', () => {
  assert.equal(pageKey('https://x.test/orders/?b=2&a=1#top', 'https://x.test'), '/orders?a=1&b=2');
  assert.equal(pageKey('https://x.test/#/orders', 'https://x.test'), '/#/orders');
  assert.equal(pageKey('https://other.test/orders', 'https://x.test'), null);
  assert.equal(pageKey('mailto:a@b.c', 'https://x.test'), null);
  assert.equal(pagePattern('/orders/1042'), '/orders/:id');
  assert.equal(pagePattern('/orders/1042/items/7'), '/orders/:id/items/:id');
  assert.equal(pagePattern('/orders'), '/orders');
});

test('the explorer signs in, walks the menus, writes notes, and never writes or logs out', async () => {
  isolatedHome();
  const hits: string[] = [];
  const page = (body: string) => `<!doctype html><html><head><title>Shop</title></head><body><nav><a href="/orders">주문</a><a href="/materials">원료</a><a href="/logout">로그아웃</a></nav>${body}</body></html>`;
  const site = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const signedIn = (req.headers.cookie ?? '').includes('sid=1');
    const send = (html: string, status = 200) => res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    if (req.method === 'POST' && req.url === '/login') {
      let body = '';
      req.on('data', (d) => (body += d));
      return void req.on('end', () => (body.includes('u=qa') && body.includes('p=secret') ? res.writeHead(302, { 'set-cookie': 'sid=1; Path=/', location: '/' }).end() : send('bad login', 401)));
    }
    if (!signedIn) return send('<h1>로그인</h1><form method="post" action="/login"><input name="u" placeholder="아이디"><input name="p" type="password"><button>로그인</button></form>');
    if (req.url === '/') return send(page('<h1>대시보드</h1>'));
    if (req.url === '/orders') return send(page('<h1>주문 목록</h1><table><thead><tr><th>주문번호</th><th>금액</th></tr></thead></table><a href="/orders/1">1</a><a href="/orders/2">2</a><a href="/orders/3">3</a><a href="/orders/4">4</a><button>저장</button>'));
    if (req.url?.startsWith('/orders/')) return send(page(`<h1>주문 상세 ${req.url}</h1>`));
    if (req.url === '/materials') return send(page('<h1>원료 등록</h1><label>원료명 <input name="n"></label><form method="post" action="/api/materials"><button>등록</button></form><script>document.querySelector("form").addEventListener("submit", e => { e.preventDefault(); fetch("/api/materials", { method: "POST" }).catch(() => {}); });</script>'));
    send('not found', 404);
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  try {
    const services = await import('../server/modules/services/service.ts');
    const secrets = await import('../server/modules/secrets/service.ts');
    const { exploreService, exploreDir } = await import('../server/modules/learning/explore.ts');
    const s = services.createService({ name: 'Explorable', baseUrl: url });
    secrets.importEnv(s.id, 'ADMIN_ID=qa\nADMIN_PW=secret\n');

    const progress: string[] = [];
    const result = await exploreService(s.id, url, (l) => progress.push(l), () => undefined);
    assert.equal(result.ok, true, result.note);

    const md = readFileSync(join(exploreDir(s.id), 'pages.md'), 'utf8');
    assert.match(md, /주문 목록/);
    assert.match(md, /원료 등록/);
    assert.match(md, /주문번호 \| 금액/, 'table columns are recorded');
    assert.match(md, /원료명/, 'form fields are recorded');
    assert.ok(progress.some((l) => l.includes('로그인했습니다')), progress.join('\n'));

    const details = [...md.matchAll(/- 주소: \S+\/orders\/\d/g)].length;
    assert.ok(details <= 2, `detail pages are sampled, not all visited (${details})`);
    assert.ok(!hits.includes('GET /logout'), 'logout is never followed');
    assert.ok(!hits.some((h) => h.startsWith('POST /api/')), 'writes never leave the browser');
  } finally {
    site.close();
  }
});

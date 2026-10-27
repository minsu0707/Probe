import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { isDangerousLabel, isDangerousUrl, pageKey, pagePattern, pickLogin, pickLogins } from '../server/modules/learning/explore-helpers.ts';
import { isolatedHome } from './helpers.ts';

test('the admin ID/password pair is chosen from the variable names', () => {
  assert.deepEqual(pickLogin(['BASE_URL', 'USER_ID', 'USER_PW', 'ADMIN_ID', 'ADMIN_PW']), { userKey: 'ADMIN_ID', passKey: 'ADMIN_PW', name: 'ADMIN' });
  assert.deepEqual(pickLogin(['LOGIN_USER', 'LOGIN_PASSWORD']), { userKey: 'LOGIN_USER', passKey: 'LOGIN_PASSWORD', name: 'LOGIN' });
  assert.deepEqual(pickLogin(['ID', 'PASSWORD']), { userKey: 'ID', passKey: 'PASSWORD', name: 'ID' });
  assert.equal(pickLogin(['BASE_URL', 'API_TOKEN']), null);
  assert.equal(pickLogin(['ADMIN_PW']), null, 'a password with no matching ID is not a login');
  assert.deepEqual(pickLogins(['RES2_ID', 'RES2_PW', 'ADMIN_ID', 'ADMIN_PW', 'RES1_ID', 'RES1_PW', 'BASE_URL']).map((p) => p.name), ['ADMIN', 'RES1', 'RES2'], 'every pair, the admin first');
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

test('a single-page app whose menus are buttons (no links) is walked screen by screen', async () => {
  isolatedHome();
  const hits: string[] = [];
  const html = `<!doctype html><html><head><title>SPA</title></head><body>
    <header><button id="out">로그아웃</button></header>
    <nav><button data-v="home">M0 홈</button><button data-v="dev">M1 제품 개발</button><button data-v="mat">M2 원료·기준정보</button></nav>
    <div id="sub"></div><main id="view"><h1>홈</h1><p>여기서 일을 시작합니다</p></main>
    <script>
      const views = { home: '<h1>홈</h1><p>여기서 일을 시작합니다</p>', dev: '<h1>제품 개발</h1><p>제품 목록과 배합비를 관리합니다. 제품명 코드 상태 담당자</p>', mat: '<h1>원료 기준정보</h1><p>원료명 규격 공급사 ERP 코드를 관리합니다</p>', list: '<h1>제품 목록</h1><table><thead><tr><th>제품명</th><th>상태</th></tr></thead></table>' };
      document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
        document.getElementById('view').innerHTML = views[b.dataset.v];
        document.getElementById('sub').innerHTML = b.dataset.v === 'dev' ? '<nav><button data-sub="list">M1-1 제품 목록</button></nav>' : '';
        document.querySelectorAll('#sub button').forEach((s) => s.addEventListener('click', () => (document.getElementById('view').innerHTML = views[s.dataset.sub])));
      }));
      document.getElementById('out').addEventListener('click', () => fetch('/logout', { method: 'POST' }));
    </script></body></html>`;
  const site = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  try {
    const services = await import('../server/modules/services/service.ts');
    const { exploreService, exploreDir } = await import('../server/modules/learning/explore.ts');
    const s = services.createService({ name: 'Spa', baseUrl: url });
    const result = await exploreService(s.id, url, () => undefined, () => undefined);
    assert.equal(result.ok, true, result.note);
    const md = readFileSync(join(exploreDir(s.id), 'pages.md'), 'utf8');
    for (const expected of ['제품 개발', '원료 기준정보', '제품 목록', '제품명 \| 상태']) assert.match(md, new RegExp(expected), expected);
    assert.ok(result.pages >= 4, `expected at least 4 screens, got ${result.pages}`);
    assert.ok(!hits.some((h) => h.startsWith('POST')), 'the logout button was not clicked');
  } finally {
    site.close();
  }
});

test('every account is explored on its own, and a role that sees fewer menus shows fewer screens', async () => {
  isolatedHome();
  const hits: string[] = [];
  const shell = (nav: string, body: string) => `<!doctype html><html><head><title>Roles</title></head><body><nav>${nav}</nav>${body}</body></html>`;
  const site = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const role = /sid=(\w+)/.exec(req.headers.cookie ?? '')?.[1];
    const send = (html: string) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    if (req.method === 'POST' && req.url === '/login') {
      let body = '';
      req.on('data', (d) => (body += d));
      return void req.on('end', () => {
        const who = /u=(\w+)/.exec(body)?.[1];
        const ok = (who === 'boss' && body.includes('p=pw1')) || (who === 'clerk' && body.includes('p=pw2'));
        if (!ok) return res.writeHead(401).end('no');
        res.writeHead(302, { 'set-cookie': `sid=${who}; Path=/`, location: '/' }).end();
      });
    }
    if (!role) return send('<h1>로그인</h1><form method="post" action="/login"><input name="u" placeholder="아이디"><input name="p" type="password"><button>로그인</button></form>');
    const nav = role === 'boss' ? '<a href="/orders">주문</a><a href="/admin">시스템 관리</a>' : '<a href="/orders">주문</a>';
    if (req.url === '/admin') return send(role === 'boss' ? shell(nav, '<h1>시스템 관리 화면</h1>') : shell(nav, '<h1>권한 없음</h1>'));
    if (req.url === '/orders') return send(shell(nav, '<h1>주문 목록</h1>'));
    send(shell(nav, '<h1>홈</h1>'));
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  try {
    const services = await import('../server/modules/services/service.ts');
    const secrets = await import('../server/modules/secrets/service.ts');
    const { exploreService, exploreDir, exploreSummary } = await import('../server/modules/learning/explore.ts');
    const s = services.createService({ name: 'Roles', baseUrl: url });
    secrets.importEnv(s.id, 'BOSS_ID=boss\nBOSS_PW=pw1\nCLERK_ID=clerk\nCLERK_PW=pw2\n');

    const result = await exploreService(s.id, url, () => undefined, () => undefined);
    assert.equal(result.ok, true, result.note);
    const summary = exploreSummary(s.id)!;
    assert.deepEqual(summary.accounts?.map((a) => [a.name, a.signedIn]), [['BOSS', true], ['CLERK', true]]);

    const md = readFileSync(join(exploreDir(s.id), 'pages.md'), 'utf8');
    const [boss, clerk] = [md.indexOf('# 계정: BOSS'), md.indexOf('# 계정: CLERK')];
    assert.ok(boss >= 0 && clerk > boss, 'one part per account, admin-like first');
    assert.match(md.slice(boss, clerk), /시스템 관리 화면/, 'the boss sees the admin screen');
    assert.doesNotMatch(md.slice(clerk), /시스템 관리 화면/, 'the clerk never gets it');
    assert.doesNotMatch(md, /pw1|pw2/, 'passwords never appear in the notes');
  } finally {
    site.close();
  }
});

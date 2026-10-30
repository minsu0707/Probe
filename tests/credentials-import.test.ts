import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolatedHome } from './helpers.ts';

isolatedHome();
const { createService } = await import('../server/modules/services/service.ts');
const { importFile, listSecrets, runtimeEnv, sensitiveValues } = await import('../server/modules/secrets/service.ts');
const { exportEnc } = await import('../server/modules/secrets/service.ts');

const bytes = (s: string) => new TextEncoder().encode(s);

test('a plain note is imported: sealed, listed by name only, and usable by a test', () => {
  const svc = createService({ name: '메모', baseUrl: 'https://x.example' });
  const r = importFile(svc.id, '계정.txt', bytes('ADMIN\n아이디: admin1\n비밀번호: S3cret-pw!'));
  assert.deepEqual(r.keys.sort(), ['ADMIN_ID', 'ADMIN_PW']);
  assert.equal(r.format, 'lines');

  const listed = listSecrets(svc.id);
  assert.equal(listed.find((k) => k.key === 'ADMIN_PW')!.sensitive, true);
  assert.equal(JSON.stringify(listed).includes('S3cret-pw!'), false, 'a password is never returned to the page');
  assert.equal(runtimeEnv(svc.id).ADMIN_PW, 'S3cret-pw!', 'the test process gets the real value');
  assert.ok(sensitiveValues(svc.id).includes('S3cret-pw!'), 'and its value is scrubbed from logs');
});

test('a file with no accounts is refused with a message, and nothing is stored', () => {
  const svc = createService({ name: '빈 파일', baseUrl: 'https://x.example' });
  assert.throws(() => importFile(svc.id, 'manual.txt', bytes('제품 등록 방법\n1. 메뉴를 연다')), /계정 정보/);
  assert.deepEqual(listSecrets(svc.id), []);
});

test('an .enc file still takes the passphrase path, and a wrong or missing one is refused', () => {
  const src = createService({ name: '원본', baseUrl: 'https://x.example' });
  importFile(src.id, 'a.env', bytes('ADMIN_ID=a\nADMIN_PW=b-secret'));
  const enc = exportEnc(src.id, 'phrase-123');

  const dest = createService({ name: '대상', baseUrl: 'https://y.example' });
  assert.throws(() => importFile(dest.id, 'moved.enc', bytes(enc)), /passphrase/);
  assert.equal(importFile(dest.id, 'moved.enc', bytes(enc), 'phrase-123').format, 'enc');
  assert.equal(runtimeEnv(dest.id).ADMIN_PW, 'b-secret');
});

test('the URL in a note becomes the service address when it has none', () => {
  const svc = createService({ name: '주소 없음' });
  importFile(svc.id, 'n.txt', bytes('주소: https://foodrnd.example\n아이디: a\n비밀번호: b'));
  assert.equal(listSecrets(svc.id).some((k) => k.key === 'BASE_URL'), true);
});

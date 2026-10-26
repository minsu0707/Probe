import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolatedHome } from './helpers.ts';

isolatedHome();
const services = await import('../server/modules/services/service.ts');
const secrets = await import('../server/modules/secrets/service.ts');
const { encodeEnc } = await import('../server/core/crypto.ts');
const { HttpError } = await import('../server/core/errors.ts');

test('normalizeUrl trims, drops a trailing slash and rejects non-http schemes', () => {
  assert.equal(services.normalizeUrl(' https://x.com/ '), 'https://x.com');
  assert.equal(services.normalizeUrl('https://x.com/app/'), 'https://x.com/app');
  assert.equal(services.normalizeUrl(''), null);
  assert.throws(() => services.normalizeUrl('ftp://x.com'), HttpError);
  assert.throws(() => services.normalizeUrl('not a url'), HttpError);
});

test('service names are unique regardless of case', () => {
  services.createService({ name: 'Shop' });
  assert.throws(() => services.createService({ name: 'shop' }), /already exists/);
});

test('importing an env file hides sensitive values and adopts BASE_URL', () => {
  const s = services.createService({ name: 'EnvSvc' });
  const result = secrets.importEnv(s.id, 'BASE_URL=https://env.test/\nTEST_USER=qa\nTEST_PASSWORD=hunter22\n');
  assert.deepEqual(result.keys.sort(), ['BASE_URL', 'TEST_PASSWORD', 'TEST_USER']);
  assert.equal(services.requireService(s.id).baseUrl, 'https://env.test');

  const listed = secrets.listSecrets(s.id);
  assert.equal(listed.find((k) => k.key === 'TEST_PASSWORD')?.value, undefined, 'password value must not be listed');
  assert.equal(listed.find((k) => k.key === 'TEST_USER')?.value, 'qa');
  assert.equal(secrets.runtimeEnv(s.id).TEST_PASSWORD, 'hunter22');
  assert.deepEqual(secrets.sensitiveValues(s.id), ['hunter22']);
});

test('an explicit service URL is not overwritten by the env file', () => {
  const s = services.createService({ name: 'Explicit', baseUrl: 'https://mine.test' });
  secrets.importEnv(s.id, 'BASE_URL=https://other.test');
  assert.equal(services.requireService(s.id).baseUrl, 'https://mine.test');
});

test('an .enc file needs its passphrase and imports with it', () => {
  const s = services.createService({ name: 'EncSvc' });
  const enc = encodeEnc('API_TOKEN=abc12345', 'long passphrase');
  assert.throws(() => secrets.importEnv(s.id, enc), /needs a passphrase/);
  assert.throws(() => secrets.importEnv(s.id, enc, 'wrong'), /Wrong passphrase/);
  assert.deepEqual(secrets.importEnv(s.id, enc, 'long passphrase'), { keys: ['API_TOKEN'], encrypted: true });
});

test('export then import round-trips every variable', () => {
  const a = services.createService({ name: 'RoundA' });
  secrets.importEnv(a.id, 'A=1\nB_SECRET="two words"');
  const enc = secrets.exportEnc(a.id, 'long passphrase');
  const b = services.createService({ name: 'RoundB' });
  secrets.importEnv(b.id, enc, 'long passphrase');
  assert.equal(secrets.runtimeEnv(b.id).B_SECRET, 'two words');
  assert.throws(() => secrets.exportEnc(a.id, 'short'), /at least 8/);
});

test('an empty env file is rejected', () => {
  const s = services.createService({ name: 'Empty' });
  assert.throws(() => secrets.importEnv(s.id, '# nothing here\n'), /No KEY=VALUE/);
});

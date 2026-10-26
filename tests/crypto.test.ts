import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolatedHome } from './helpers.ts';

isolatedHome();
const { decodeEnc, decryptValue, encodeEnc, encryptValue, isEncFile } = await import('../server/core/crypto.ts');

test('stored values round-trip and are not stored in clear', () => {
  const stored = encryptValue('s3cret pw');
  assert.notEqual(stored, 's3cret pw');
  assert.ok(!stored.includes('s3cret'));
  assert.equal(decryptValue(stored), 's3cret pw');
});

test('the same value encrypts differently each time (random IV)', () => {
  assert.notEqual(encryptValue('x'), encryptValue('x'));
});

test('a tampered stored value is rejected rather than decrypted to garbage', () => {
  const raw = Buffer.from(encryptValue('value'), 'base64');
  raw[raw.length - 1] ^= 1;
  assert.throws(() => decryptValue(raw.toString('base64')));
});

test('.enc files round-trip with the right passphrase', () => {
  const enc = encodeEnc('A=1\nB="two words"', 'correct horse');
  assert.ok(isEncFile(enc));
  assert.equal(decodeEnc(enc, 'correct horse'), 'A=1\nB="two words"');
});

test('.enc rejects a wrong passphrase with a readable message', () => {
  const enc = encodeEnc('A=1', 'correct horse');
  assert.throws(() => decodeEnc(enc, 'wrong'), /Wrong passphrase/);
});

test('isEncFile does not mistake plain dotenv text for an .enc file', () => {
  assert.equal(isEncFile('BASE_URL=https://x.com\nTOKEN=abc'), false);
  assert.equal(isEncFile(''), false);
});

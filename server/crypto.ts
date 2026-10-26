import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { KEY_FILE } from './paths.ts';

function masterKey(): Buffer {
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32), { mode: 0o600 });
  const key = readFileSync(KEY_FILE);
  if (key.length !== 32) throw new Error(`${KEY_FILE} must contain exactly 32 bytes`);
  return key;
}

function seal(key: Buffer, plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

function open(key: Buffer, blob: Buffer): string {
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8');
}

/** Encrypt a value for storage in the local database. */
export const encryptValue = (plain: string) => seal(masterKey(), plain).toString('base64');
export const decryptValue = (stored: string) => open(masterKey(), Buffer.from(stored, 'base64'));

/**
 * Portable `.enc` file: a passphrase-protected dotenv. Layout (base64 of):
 *   "PRBENC1\n" | salt(16) | iv(12) | tag(16) | ciphertext
 * The key is derived with scrypt, so the file can be moved between machines.
 */
const MAGIC = Buffer.from('PRBENC1\n');

export function isEncFile(text: string): boolean {
  try {
    return Buffer.from(text.trim(), 'base64').subarray(0, MAGIC.length).equals(MAGIC);
  } catch {
    return false;
  }
}

export function encodeEnc(plain: string, passphrase: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(passphrase, salt, 32);
  return Buffer.concat([MAGIC, salt, seal(key, plain)]).toString('base64');
}

export function decodeEnc(text: string, passphrase: string): string {
  const raw = Buffer.from(text.trim(), 'base64');
  if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a Probe .enc file');
  const salt = raw.subarray(MAGIC.length, MAGIC.length + 16);
  const key = scryptSync(passphrase, salt, 32);
  try {
    return open(key, raw.subarray(MAGIC.length + 16));
  } catch {
    throw new Error('Wrong passphrase or corrupted .enc file');
  }
}

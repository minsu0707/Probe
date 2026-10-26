/**
 * Encryption for credentials, in two flavours:
 *
 *  1. Local storage: values in the database are sealed with a random master key kept in
 *     `data/master.key`. Protects against someone copying only the .db file.
 *  2. Portable `.enc` files: a passphrase-protected dotenv the user can move between
 *     machines. The key is derived from the passphrase with scrypt.
 *
 * Both use AES-256-GCM, so tampering is detected rather than silently decrypted.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { KEY_FILE } from '../config.ts';

const IV_LEN = 12;
const TAG_LEN = 16;

/** Binary layout of a sealed value: iv | auth tag | ciphertext. */
function seal(key: Buffer, plain: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function unseal(key: Buffer, blob: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, IV_LEN));
  decipher.setAuthTag(blob.subarray(IV_LEN, IV_LEN + TAG_LEN));
  return Buffer.concat([decipher.update(blob.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString('utf8');
}

// ------------------------------------------------------------ local storage

/** Created on first use. Losing this file makes stored credentials unreadable. */
function masterKey(): Buffer {
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32), { mode: 0o600 });
  const key = readFileSync(KEY_FILE);
  if (key.length !== 32) throw new Error(`${KEY_FILE} must contain exactly 32 bytes`);
  return key;
}

export const encryptValue = (plain: string): string => seal(masterKey(), plain).toString('base64');
export const decryptValue = (stored: string): string => unseal(masterKey(), Buffer.from(stored, 'base64'));

// -------------------------------------------------------------- .enc files

/** base64 of "PRBENC1\n" always starts with this, which lets the UI sniff files without a .enc extension. */
export const ENC_BASE64_PREFIX = 'UFJCRU5DMQ';
const MAGIC = Buffer.from('PRBENC1\n');
const SALT_LEN = 16;

/** File layout (base64): MAGIC | salt | iv | tag | ciphertext. */
export function isEncFile(text: string): boolean {
  return text.trim().startsWith(ENC_BASE64_PREFIX) && Buffer.from(text.trim(), 'base64').subarray(0, MAGIC.length).equals(MAGIC);
}

export function encodeEnc(plain: string, passphrase: string): string {
  const salt = randomBytes(SALT_LEN);
  return Buffer.concat([MAGIC, salt, seal(scryptSync(passphrase, salt, 32), plain)]).toString('base64');
}

/** Throws a user-readable error for a wrong passphrase or a damaged file. */
export function decodeEnc(text: string, passphrase: string): string {
  const raw = Buffer.from(text.trim(), 'base64');
  if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a Probe .enc file');
  const salt = raw.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
  try {
    return unseal(scryptSync(passphrase, salt, 32), raw.subarray(MAGIC.length + SALT_LEN));
  } catch {
    throw new Error('Wrong passphrase or corrupted .enc file');
  }
}

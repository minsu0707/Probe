/**
 * Credentials for a service: importing from .env / .enc files, exporting, and handing the
 * decrypted environment to a test process.
 *
 * Trust boundary: decrypted values leave this module only through `runtimeEnv()` (to a
 * spawned Playwright process) and `sensitiveValues()` (so logs can be scrubbed). Nothing
 * here is returned over HTTP or MCP.
 */
import { parse as parseDotenv } from 'dotenv';
import { decodeEnc, decryptValue, encodeEnc, encryptValue, isEncFile } from '../../core/crypto.ts';
import { tx } from '../../core/db.ts';
import { badRequest, notFound, unprocessable } from '../../core/errors.ts';
import { broadcast } from '../../core/hub.ts';
import type { SecretMeta } from '../../../shared/models.ts';
import { refreshFavicon } from '../services/favicon.ts';
import * as servicesRepo from '../services/repository.ts';
import { normalizeUrl, requireService } from '../services/service.ts';
import { BASE_URL_KEYS, MIN_REDACTABLE_LENGTH, isSensitiveKey } from './classify.ts';
import { extractCredentials, type CredentialFormat } from './extract.ts';
import * as repo from './repository.ts';

export const countSecrets = repo.count;

/** Keys for the UI. Sensitive values are omitted; everything else is shown in plain text. */
export function listSecrets(serviceId: string): SecretMeta[] {
  requireService(serviceId);
  return repo.findByService(serviceId).map((r) => (r.sensitive ? { key: r.key, sensitive: true } : { key: r.key, sensitive: false, value: decryptValue(r.value) }));
}

/**
 * Import a dotenv file or a passphrase-protected `.enc`. Existing keys are overwritten.
 * If the service has no URL yet and the file has a BASE_URL-like key, that becomes the URL.
 */
export function importEnv(serviceId: string, text: string, passphrase?: string): { keys: string[]; encrypted: boolean } {
  const service = requireService(serviceId);
  const encrypted = isEncFile(text);
  if (encrypted && !passphrase) throw unprocessable('This .enc file needs a passphrase');

  const entries = parseDotenv(encrypted ? decodeEnc(text, passphrase!) : text);
  if (Object.keys(entries).length === 0) throw unprocessable('No KEY=VALUE lines found in the file');
  return { keys: storeEntries(serviceId, service.baseUrl, entries), encrypted };
}

/**
 * Import any file that holds account details: a .enc, a .env, or something else (a spreadsheet, CSV, JSON, a note)
 * whose accounts Probe finds for itself. The values are sealed with the same key as an imported .env, and the
 * file itself is not kept anywhere.
 */
export function importFile(serviceId: string, name: string, data: Uint8Array, passphrase?: string): { keys: string[]; encrypted: boolean; format: CredentialFormat | 'enc' } {
  const service = requireService(serviceId);
  const asText = new TextDecoder('utf-8').decode(data);
  if (isEncFile(asText)) return { ...importEnv(serviceId, asText, passphrase), format: 'enc' };

  const { entries, format } = extractCredentials(name, data);
  if (!format) throw unprocessable('이 파일에서 계정 정보(아이디·비밀번호 등)를 찾지 못했습니다. 아이디와 비밀번호가 "이름: 값" 형태의 줄이나 표로 들어 있는지 확인해 주세요.');
  return { keys: storeEntries(serviceId, service.baseUrl, entries), encrypted: false, format };
}

/** Seal and keep the entries, overwriting keys that already exist. Returns the key names. */
function storeEntries(serviceId: string, baseUrl: string | null, entries: Record<string, string>): string[] {
  const keys = Object.keys(entries);
  tx(() => {
    for (const key of keys) repo.upsert(serviceId, { key, value: encryptValue(entries[key]), sensitive: isSensitiveKey(key) });
  });
  if (!baseUrl) adoptBaseUrl(serviceId, entries);
  broadcast({ type: 'service', serviceId });
  return keys;
}

/** A malformed BASE_URL in the file must not fail an otherwise good import, so errors are ignored. */
function adoptBaseUrl(serviceId: string, entries: Record<string, string>): void {
  const raw = BASE_URL_KEYS.map((k) => entries[k]).find(Boolean);
  if (!raw) return;
  try {
    const url = normalizeUrl(raw);
    if (url) {
      servicesRepo.setBaseUrl(serviceId, url);
      void refreshFavicon(serviceId);
    }
  } catch {
    /* ignore */
  }
}

/** One variable's real value, for the user's own "show" button. Never sent unless asked for by key. */
export function revealSecret(serviceId: string, key: string): string {
  requireService(serviceId);
  const row = repo.findByService(serviceId).find((r) => r.key === key);
  if (!row) throw notFound('That variable does not exist');
  return decryptValue(row.value);
}

export function deleteSecret(serviceId: string, key: string): void {
  requireService(serviceId);
  repo.remove(serviceId, key);
  broadcast({ type: 'service', serviceId });
}

/** All variables as a passphrase-protected `.enc`, for moving to another machine. */
export function exportEnc(serviceId: string, passphrase: string): string {
  requireService(serviceId);
  if (passphrase.length < 8) throw badRequest('Passphrase must be at least 8 characters');
  const dotenv = repo
    .findByService(serviceId)
    .map((r) => `${r.key}=${JSON.stringify(decryptValue(r.value))}`)
    .join('\n');
  return encodeEnc(dotenv, passphrase);
}

/** The environment a test process runs with: every variable, plus BASE_URL from the service. */
export function runtimeEnv(serviceId: string): Record<string, string> {
  const service = requireService(serviceId);
  const env: Record<string, string> = {};
  for (const r of repo.findByService(serviceId)) env[r.key] = decryptValue(r.value);
  if (service.baseUrl) env.BASE_URL = service.baseUrl;
  return env;
}

/** Sensitive values worth scrubbing from logs, longest first so overlapping values redact cleanly. */
export function sensitiveValues(serviceId: string): string[] {
  return repo
    .findByService(serviceId)
    .filter((r) => r.sensitive)
    .map((r) => decryptValue(r.value))
    .filter((v) => v.length >= MIN_REDACTABLE_LENGTH)
    .sort((a, b) => b.length - a.length);
}

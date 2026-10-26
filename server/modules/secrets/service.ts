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
import { badRequest, unprocessable } from '../../core/errors.ts';
import { broadcast } from '../../core/hub.ts';
import type { SecretMeta } from '../../../shared/models.ts';
import * as servicesRepo from '../services/repository.ts';
import { normalizeUrl, requireService } from '../services/service.ts';
import { BASE_URL_KEYS, MIN_REDACTABLE_LENGTH, isSensitiveKey } from './classify.ts';
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
  const keys = Object.keys(entries);
  if (keys.length === 0) throw unprocessable('No KEY=VALUE lines found in the file');

  tx(() => {
    for (const key of keys) repo.upsert(serviceId, { key, value: encryptValue(entries[key]), sensitive: isSensitiveKey(key) });
  });

  if (!service.baseUrl) adoptBaseUrl(serviceId, entries);
  broadcast({ type: 'service', serviceId });
  return { keys, encrypted };
}

/** A malformed BASE_URL in the file must not fail an otherwise good import, so errors are ignored. */
function adoptBaseUrl(serviceId: string, entries: Record<string, string>): void {
  const raw = BASE_URL_KEYS.map((k) => entries[k]).find(Boolean);
  if (!raw) return;
  try {
    const url = normalizeUrl(raw);
    if (url) servicesRepo.setBaseUrl(serviceId, url);
  } catch {
    /* ignore */
  }
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

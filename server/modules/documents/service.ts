/**
 * Source documents that teach Claude about a service: uploaded files and Google Drive links.
 *
 * Files are stored under the service's docs/ folder. Office files get a sibling
 * `<name>.extracted.txt`, which the learning prompt tells Claude to read instead.
 * Drive links are only recorded here; Claude reads them with its Drive connector during learning.
 */
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { badRequest, conflict, HttpError, notFound } from '../../core/errors.ts';
import { broadcast } from '../../core/hub.ts';
import { newId } from '../../core/ids.ts';
import { docsDir, ensureDir } from '../../config.ts';
import type { Doc } from '../../../shared/models.ts';
import { requireService } from '../services/service.ts';
import { extractOoxmlText } from './ooxml.ts';
import * as repo from './repository.ts';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Claude reads these as they are. */
const NATIVE = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.md', '.txt', '.csv', '.tsv', '.json', '.html', '.htm', '.xml', '.yaml', '.yml', '.log', '.sql', '.ts', '.js'];
/** Converted to text on upload. */
const OFFICE = ['.docx', '.xlsx', '.pptx'] as const;
export const SUPPORTED_EXTENSIONS = [...NATIVE, ...OFFICE];

/** Old binary Office formats can't be parsed here; point the user at the modern equivalent. */
const LEGACY_OFFICE: Record<string, string> = { '.doc': '.docx', '.xls': '.xlsx', '.ppt': '.pptx' };

export const listDocs = repo.findByService;
export const countDocs = repo.count;
export const countUnlearnedDocs = repo.countUnlearned;

/** Strip path separators and control characters, then add " (2)" until the name is free. */
function uniqueFileName(dir: string, wanted: string): string {
  const clean = basename(wanted).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '') || 'file';
  const ext = extname(clean);
  const stem = clean.slice(0, clean.length - ext.length);
  let name = clean;
  for (let n = 2; existsSync(join(dir, name)); n++) name = `${stem} (${n})${ext}`;
  return name;
}

function assertSupported(ext: string): void {
  if (SUPPORTED_EXTENSIONS.includes(ext)) return;
  const modern = LEGACY_OFFICE[ext];
  throw new HttpError(415, modern ? `${ext} files can't be read. Save it as ${modern} and upload again.` : `${ext || 'This'} file type isn't supported. Supported: ${SUPPORTED_EXTENSIONS.join(' ')}`);
}

export function addFile(serviceId: string, originalName: string, data: Buffer): Doc {
  requireService(serviceId);
  const ext = extname(originalName).toLowerCase();
  assertSupported(ext);
  if (data.length === 0) throw badRequest('The file is empty');
  if (data.length > MAX_UPLOAD_BYTES) throw new HttpError(413, `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`);

  const dir = ensureDir(docsDir(serviceId));
  const name = uniqueFileName(dir, originalName);
  writeFileSync(join(dir, name), data);

  if ((OFFICE as readonly string[]).includes(ext)) {
    try {
      writeFileSync(join(dir, `${name}.extracted.txt`), extractOoxmlText(ext as (typeof OFFICE)[number], data));
    } catch (e) {
      rmSync(join(dir, name), { force: true }); // don't keep a file Claude can't read
      throw new HttpError(422, `Could not read ${originalName}: ${(e as Error).message}`);
    }
  }

  const doc = repo.insert({ id: newId(), serviceId, kind: 'file', name, ref: name, size: data.length, addedAt: Date.now() });
  broadcast({ type: 'docs', serviceId });
  return doc;
}

/** Best-effort label from the URL shape, so the list says "Google Sheet" instead of a bare link. */
function driveLabel(url: URL): string {
  const p = url.pathname;
  if (p.includes('/folders/')) return 'Drive folder';
  if (p.includes('/spreadsheets/')) return 'Google Sheet';
  if (p.includes('/presentation/')) return 'Google Slides';
  if (p.includes('/document/')) return 'Google Doc';
  return 'Drive file';
}

export function addDrive(serviceId: string, rawUrl: string, label?: string): Doc {
  requireService(serviceId);
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw badRequest('Paste a full Google Drive link');
  }
  if (!/(^|\.)(drive|docs)\.google\.com$/.test(url.hostname)) throw badRequest('Only drive.google.com and docs.google.com links are supported');
  if (repo.refExists(serviceId, url.href)) throw conflict('That link is already added');

  const doc = repo.insert({ id: newId(), serviceId, kind: 'drive', name: label?.trim() || driveLabel(url), ref: url.href, size: 0, addedAt: Date.now() });
  broadcast({ type: 'docs', serviceId });
  return doc;
}

export function deleteDoc(serviceId: string, docId: string): void {
  const doc = repo.findOne(serviceId, docId);
  if (!doc) throw notFound('Document not found');
  if (doc.kind === 'file') {
    rmSync(join(docsDir(serviceId), doc.ref), { force: true });
    rmSync(join(docsDir(serviceId), `${doc.ref}.extracted.txt`), { force: true });
  }
  repo.remove(docId);
  broadcast({ type: 'docs', serviceId });
}

export function markLearned(serviceId: string): void {
  repo.markAllLearned(serviceId, Date.now());
  broadcast({ type: 'docs', serviceId });
}

/** File names currently in the docs folder (used by tests and diagnostics). */
export const docFileNames = (serviceId: string): string[] => (existsSync(docsDir(serviceId)) ? readdirSync(docsDir(serviceId)) : []);

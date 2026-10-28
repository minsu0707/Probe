/**
 * Backup and restore of everything Probe keeps (database, credentials key, documents, knowledge,
 * test code, run evidence), as one passphrase-protected file. See archive.ts for the format.
 *
 * Restoring cannot happen in the running server (it holds the database open), so it is in two
 * steps: `stageRestore` unpacks and checks the file; the swap happens at the next start
 * (core/restore-boot.ts). The user restarts in between.
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { HOME, KEY_FILE, ROOT } from '../../config.ts';
import { badRequest, notFound } from '../../core/errors.ts';
import { db } from '../../core/db.ts';
import { newId } from '../../core/ids.ts';
import { PENDING_NAME, STAGING_NAME } from '../../core/restore-boot.ts';
import { readFileSync } from 'node:fs';
import { pack, unpack, type BackupFile } from './archive.ts';

const TMP = join(HOME, 'tmp-backup');
const SKIP_DIRS = new Set(['node_modules', '.results', 'test-results']);
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MIN_PASSPHRASE = 8;

const appVersion = (): string => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

export interface BackupManifest {
  format: 1;
  appVersion: string;
  createdAt: number;
  services: number;
  includesClaudeContext: boolean;
}

function* walk(dir: string, prefix: string): Generator<BackupFile> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name), `${prefix}/${entry.name}`);
    } else if (entry.isFile()) yield { name: `${prefix}/${entry.name}`, abs: join(dir, entry.name) };
  }
}

const ready = new Map<string, { path: string; name: string }>();

function sweepOld(): void {
  if (!existsSync(TMP)) return;
  for (const f of readdirSync(TMP)) {
    const p = join(TMP, f);
    if (Date.now() - statSync(p).mtimeMs > MAX_AGE_MS) rmSync(p, { recursive: true, force: true });
  }
}

const stamp = (d: Date): string => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

export async function createBackup(input: { passphrase: string; includeClaudeContext?: boolean }): Promise<{ id: string; name: string; size: number }> {
  if (input.passphrase.length < MIN_PASSPHRASE) throw badRequest(`비밀번호는 ${MIN_PASSPHRASE}자 이상이어야 합니다.`);
  mkdirSync(TMP, { recursive: true });
  sweepOld();

  const id = newId();
  const work = join(TMP, id);
  mkdirSync(work);
  try {
    // A consistent copy of the database even while the app is using it.
    const snapshot = join(work, 'probe.db');
    db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);

    const claudeProjects = join(HOME, 'claude', 'projects');
    const includeClaude = Boolean(input.includeClaudeContext) && existsSync(claudeProjects);
    const manifest: BackupManifest = { format: 1, appVersion: appVersion(), createdAt: Date.now(), services: (db.prepare('SELECT COUNT(*) AS n FROM services').get() as { n: number }).n, includesClaudeContext: includeClaude };
    const manifestFile = join(work, 'manifest.json');
    writeFileSync(manifestFile, JSON.stringify(manifest));

    const files: BackupFile[] = [{ name: 'manifest.json', abs: manifestFile }, { name: 'probe.db', abs: snapshot }];
    if (existsSync(KEY_FILE)) files.push({ name: 'master.key', abs: KEY_FILE });
    files.push(...walk(join(HOME, 'services'), 'services'), ...walk(join(HOME, 'runs'), 'runs'));
    if (includeClaude) files.push(...walk(claudeProjects, 'claude-projects'));

    const name = `probe-backup-${stamp(new Date())}.probebak`;
    const path = join(TMP, `${id}.probebak`);
    await pack(files, input.passphrase, path);
    ready.set(id, { path, name });
    return { id, name, size: statSync(path).size };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The finished file as a stream; it is deleted once the download has been read. */
export function openBackup(id: string): { stream: ReadableStream; name: string; size: number } {
  const item = ready.get(id);
  if (!item || !existsSync(item.path)) throw notFound('이 백업 파일은 더 이상 없습니다. 다시 만들어 주세요.');
  const node = createReadStream(item.path);
  node.on('close', () => {
    ready.delete(id);
    rmSync(item.path, { force: true });
  });
  return { stream: Readable.toWeb(node) as ReadableStream, name: item.name, size: statSync(item.path).size };
}

const older = (a: string, b: string): boolean => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
};

/** Unpack and check an uploaded backup; the swap itself waits for the next start. */
export async function stageRestore(body: ReadableStream, passphrase: string): Promise<BackupManifest> {
  mkdirSync(TMP, { recursive: true });
  const upload = join(TMP, `upload-${newId()}.probebak`);
  const staging = join(HOME, STAGING_NAME);
  try {
    await pipeline(Readable.fromWeb(body as never), createWriteStream(upload));
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    await unpack(upload, passphrase, staging);

    const manifestPath = join(staging, 'manifest.json');
    if (!existsSync(manifestPath) || !existsSync(join(staging, 'probe.db'))) throw new Error('백업 파일에 데이터베이스가 없습니다.');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;
    if (manifest.format !== 1) throw new Error('이 백업은 지원하지 않는 형식입니다.');
    if (older(appVersion(), manifest.appVersion)) throw new Error(`이 백업은 더 새로운 버전(${manifest.appVersion})에서 만들어졌습니다. Probe를 업데이트한 뒤 복원하세요.`);
    if (!existsSync(join(staging, 'master.key'))) throw new Error('백업 파일에 자격 증명 키가 없습니다.');

    // The database must open and look like ours before anything is replaced.
    const check = new DatabaseSync(join(staging, 'probe.db'), { readOnly: true });
    try {
      check.prepare('SELECT COUNT(*) FROM services').get();
    } finally {
      check.close();
    }
    writeFileSync(join(HOME, PENDING_NAME), JSON.stringify(manifest));
    return manifest;
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw badRequest((e as Error).message);
  } finally {
    if (existsSync(upload)) unlinkSync(upload);
  }
}

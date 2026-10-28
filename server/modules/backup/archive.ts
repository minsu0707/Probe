/**
 * The backup file: many files in one passphrase-protected stream.
 *
 *   "PROBEBAK1\n" | salt (16) | iv (12) | AES-256-GCM( gzip( frames ) ) | auth tag (16)
 *   frame = name length (u32) | name (utf-8) | size (u64) | bytes      and a name length of 0 ends it
 *
 * Everything is streamed, so a backup with hundreds of MB of screenshots never sits in memory. The
 * auth tag is checked only when the stream ends, so a restore reads to the very end before it is
 * trusted; a wrong passphrase or a damaged file fails here with one message.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { appendFileSync, closeSync, createReadStream, createWriteStream, mkdirSync, openSync, readSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, posix } from 'node:path';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

const MAGIC = Buffer.from('PROBEBAK1\n');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN;

export const BAD_BACKUP = '비밀번호가 틀렸거나 백업 파일이 손상되었습니다.';

export interface BackupFile {
  /** Path inside the backup, with forward slashes. */
  name: string;
  abs: string;
}

async function* frames(files: BackupFile[]): AsyncGenerator<Buffer> {
  for (const f of files) {
    const size = statSync(f.abs).size;
    const name = Buffer.from(f.name, 'utf8');
    const head = Buffer.alloc(4 + name.length + 8);
    head.writeUInt32BE(name.length, 0);
    name.copy(head, 4);
    head.writeBigUInt64BE(BigInt(size), 4 + name.length);
    yield head;
    let sent = 0;
    // Read exactly the size announced: a file that grows during the backup must not shift the frames.
    if (size > 0) {
      for await (const chunk of createReadStream(f.abs, { start: 0, end: size - 1 })) {
        sent += (chunk as Buffer).length;
        yield chunk as Buffer;
      }
    }
    if (sent !== size) throw new Error(`${f.name} changed while it was being backed up`);
  }
  yield Buffer.alloc(4);
}

export async function pack(files: BackupFile[], passphrase: string, outPath: string): Promise<void> {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv);
  const out = createWriteStream(outPath);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(Readable.from(frames(files)), createGzip({ level: 1 }), cipher, out);
  appendFileSync(outPath, cipher.getAuthTag());
}

/** Pulls exact byte counts out of an async stream of chunks. */
class Reader {
  private chunks: Buffer[] = [];
  private len = 0;
  private done = false;
  private it: AsyncIterator<Buffer>;
  constructor(source: AsyncIterable<Buffer>) {
    this.it = source[Symbol.asyncIterator]();
  }
  private async fill(n: number): Promise<void> {
    while (this.len < n && !this.done) {
      const r = await this.it.next();
      if (r.done) this.done = true;
      else {
        this.chunks.push(r.value);
        this.len += r.value.length;
      }
    }
  }
  async take(n: number): Promise<Buffer> {
    await this.fill(n);
    if (this.len < n) throw new Error('truncated');
    const all = Buffer.concat(this.chunks);
    this.chunks = [all.subarray(n)];
    this.len = all.length - n;
    return all.subarray(0, n);
  }
  async takeUpTo(n: number): Promise<Buffer> {
    await this.fill(1);
    if (!this.len) throw new Error('truncated');
    const first = this.chunks[0];
    let out: Buffer;
    if (first.length <= n) out = this.chunks.shift()!;
    else {
      out = first.subarray(0, n);
      this.chunks[0] = first.subarray(n);
    }
    this.len -= out.length;
    return out;
  }
  /** Read to the end so the cipher can check its tag. */
  async drain(): Promise<void> {
    while (!this.done) if ((await this.it.next()).done) this.done = true;
  }
}

const ALLOWED = /^(manifest\.json|probe\.db|master\.key|(services|runs|claude-projects)\/.+)$/;

/** A name from inside the file is never trusted as a path: only the known places, and nothing that climbs out. */
export function safeTarget(destDir: string, name: string): string | null {
  if (!ALLOWED.test(name) || name.includes('\\') || isAbsolute(name)) return null;
  const clean = posix.normalize(name);
  if (clean !== name || clean.startsWith('../') || clean.split('/').includes('..')) return null;
  return join(destDir, ...clean.split('/'));
}

export async function unpack(inPath: string, passphrase: string, destDir: string): Promise<string[]> {
  const size = statSync(inPath).size;
  if (size < HEADER_LEN + TAG_LEN + 1) throw new Error(BAD_BACKUP);
  const fd = openSync(inPath, 'r');
  const header = Buffer.alloc(HEADER_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  try {
    readSync(fd, header, 0, HEADER_LEN, 0);
    readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    closeSync(fd);
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Probe 백업 파일이 아닙니다.');

  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
  const iv = header.subarray(MAGIC.length + SALT_LEN);
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv);
  decipher.setAuthTag(tag);

  const names: string[] = [];
  try {
    await pipeline(createReadStream(inPath, { start: HEADER_LEN, end: size - TAG_LEN - 1 }), decipher, createGunzip(), async (source: AsyncIterable<Buffer>) => {
      const reader = new Reader(source);
      for (;;) {
        const nameLen = (await reader.take(4)).readUInt32BE(0);
        if (nameLen === 0) break;
        if (nameLen > 1024) throw new Error(BAD_BACKUP);
        const name = (await reader.take(nameLen)).toString('utf8');
        let left = Number((await reader.take(8)).readBigUInt64BE(0));
        const target = safeTarget(destDir, name);
        if (!target) throw new Error(`백업 파일에 허용되지 않는 경로가 있습니다: ${name}`);
        mkdirSync(dirname(target), { recursive: true });
        const ws = createWriteStream(target);
        while (left > 0) {
          const chunk = await reader.takeUpTo(left);
          left -= chunk.length;
          if (!ws.write(chunk)) await once(ws, 'drain');
        }
        ws.end();
        await once(ws, 'finish');
        names.push(name);
      }
      await reader.drain();
    });
  } catch (e) {
    // Our own explicit messages pass through; everything the cipher or gzip say means "wrong passphrase or damaged".
    const message = (e as Error).message;
    throw new Error(/허용되지 않는 경로|Probe 백업 파일/.test(message) ? message : BAD_BACKUP);
  }
  return names;
}

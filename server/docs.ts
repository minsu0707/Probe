import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { all, get, run } from './db.ts';
import { broadcast } from './hub.ts';
import { HttpError, requireService } from './services.ts';
import { docsDir, ensureDir } from './paths.ts';

export interface Doc {
  id: string;
  serviceId: string;
  kind: 'file' | 'drive';
  name: string;
  ref: string;
  mime: string | null;
  size: number;
  learnedAt: number | null;
  addedAt: number;
}

interface DocRow {
  id: string;
  service_id: string;
  kind: 'file' | 'drive';
  name: string;
  ref: string;
  mime: string | null;
  size: number;
  learned_at: number | null;
  added_at: number;
}

const toDoc = (r: DocRow): Doc => ({ id: r.id, serviceId: r.service_id, kind: r.kind, name: r.name, ref: r.ref, mime: r.mime, size: r.size, learnedAt: r.learned_at, addedAt: r.added_at });

export const MAX_UPLOAD = 50 * 1024 * 1024;
/** Read by Claude as-is. */
const NATIVE = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.md', '.txt', '.csv', '.tsv', '.json', '.html', '.htm', '.xml', '.yaml', '.yml', '.log', '.sql', '.ts', '.js']);
/** Converted to a sibling `.extracted.txt` first. */
const OOXML = new Set(['.docx', '.xlsx', '.pptx']);
export const SUPPORTED = [...NATIVE, ...OOXML];

export const listDocs = (serviceId: string): Doc[] => all<DocRow>('SELECT * FROM documents WHERE service_id = ? ORDER BY added_at DESC', serviceId).map(toDoc);

function uniqueName(dir: string, wanted: string): string {
  const clean = basename(wanted).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '') || 'file';
  const ext = extname(clean);
  const stem = clean.slice(0, clean.length - ext.length);
  let n = clean;
  for (let i = 2; existsSync(join(dir, n)); i++) n = `${stem} (${i})${ext}`;
  return n;
}

export function addFile(serviceId: string, originalName: string, data: Buffer): Doc {
  requireService(serviceId);
  const ext = extname(originalName).toLowerCase();
  if (!SUPPORTED.includes(ext)) {
    const legacy: Record<string, string> = { '.doc': '.docx', '.xls': '.xlsx', '.ppt': '.pptx' };
    throw new HttpError(415, legacy[ext] ? `${ext} files can't be read. Save it as ${legacy[ext]} and upload again.` : `${ext || 'This'} file type isn't supported. Supported: ${SUPPORTED.join(' ')}`);
  }
  if (data.length === 0) throw new HttpError(400, 'The file is empty');
  if (data.length > MAX_UPLOAD) throw new HttpError(413, `File is larger than ${MAX_UPLOAD / 1024 / 1024}MB`);
  const dir = ensureDir(docsDir(serviceId));
  const name = uniqueName(dir, originalName);
  writeFileSync(join(dir, name), data);
  if (OOXML.has(ext)) {
    try {
      writeFileSync(join(dir, `${name}.extracted.txt`), extractOoxml(ext, data));
    } catch (e) {
      rmSync(join(dir, name), { force: true });
      throw new HttpError(422, `Could not read ${originalName}: ${(e as Error).message}`);
    }
  }
  const id = randomUUID().slice(0, 8);
  run('INSERT INTO documents (id, service_id, kind, name, ref, mime, size, added_at) VALUES (?,?,?,?,?,?,?,?)', id, serviceId, 'file', name, name, null, data.length, Date.now());
  broadcast({ type: 'docs', serviceId });
  return toDoc(get<DocRow>('SELECT * FROM documents WHERE id = ?', id)!);
}

export function addDrive(serviceId: string, rawUrl: string, label?: string): Doc {
  requireService(serviceId);
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    throw new HttpError(400, 'Paste a full Google Drive link');
  }
  if (!/(^|\.)(drive|docs)\.google\.com$/.test(u.hostname)) throw new HttpError(400, 'Only drive.google.com and docs.google.com links are supported');
  if (get('SELECT 1 FROM documents WHERE service_id = ? AND ref = ?', serviceId, u.href)) throw new HttpError(409, 'That link is already added');
  const id = randomUUID().slice(0, 8);
  const kindGuess = u.pathname.includes('/folders/') ? 'Drive folder' : u.pathname.includes('/spreadsheets/') ? 'Google Sheet' : u.pathname.includes('/presentation/') ? 'Google Slides' : u.pathname.includes('/document/') ? 'Google Doc' : 'Drive file';
  run('INSERT INTO documents (id, service_id, kind, name, ref, mime, size, added_at) VALUES (?,?,?,?,?,?,?,?)', id, serviceId, 'drive', label?.trim() || kindGuess, u.href, null, 0, Date.now());
  broadcast({ type: 'docs', serviceId });
  return toDoc(get<DocRow>('SELECT * FROM documents WHERE id = ?', id)!);
}

export function deleteDoc(serviceId: string, docId: string) {
  const r = get<DocRow>('SELECT * FROM documents WHERE id = ? AND service_id = ?', docId, serviceId);
  if (!r) throw new HttpError(404, 'Document not found');
  if (r.kind === 'file') {
    rmSync(join(docsDir(serviceId), r.ref), { force: true });
    rmSync(join(docsDir(serviceId), `${r.ref}.extracted.txt`), { force: true });
  }
  run('DELETE FROM documents WHERE id = ?', docId);
  broadcast({ type: 'docs', serviceId });
}

export function markLearned(serviceId: string) {
  run('UPDATE documents SET learned_at = ? WHERE service_id = ?', Date.now(), serviceId);
  broadcast({ type: 'docs', serviceId });
}

export const unlearnedCount = (serviceId: string) => get<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE service_id = ? AND learned_at IS NULL', serviceId)?.n ?? 0;

// ------------------------------------------------------------ OOXML text

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (entities[e] ?? m)));
const textRuns = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => decode(m[1])).join('');
const MAX_TEXT = 2_000_000;

function extractOoxml(ext: string, data: Buffer): string {
  const files = unzipSync(new Uint8Array(data));
  const text = (p: string) => (files[p] ? strFromU8(files[p]) : '');
  let out: string;
  if (ext === '.docx') {
    out = text('word/document.xml')
      .replace(/<\/w:tc>/g, ' | ')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<[^>]+>/g, '');
    out = decode(out).replace(/\n{3,}/g, '\n\n');
  } else if (ext === '.pptx') {
    const slides = Object.keys(files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]));
    out = slides
      .map((f, i) => {
        const paras = text(f).split('</a:p>').map((p) => textRuns(p, 'a:t')).filter(Boolean).join('\n');
        const notesFile = `ppt/notesSlides/notesSlide${f.match(/\d+/)![0]}.xml`;
        const notes = text(notesFile).split('</a:p>').map((p) => textRuns(p, 'a:t')).filter(Boolean).join('\n');
        return `--- Slide ${i + 1} ---\n${paras}${notes ? `\n[Notes]\n${notes}` : ''}`;
      })
      .join('\n\n');
  } else {
    out = extractXlsx(files, text);
  }
  if (!out.trim()) throw new Error('no readable text found');
  return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT)}\n\n[truncated at ${MAX_TEXT} characters]` : out;
}

function extractXlsx(files: Record<string, Uint8Array>, text: (p: string) => string): string {
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1], 't'));
  const rels = new Map([...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/Id="([^"]+)"/)?.[1] ?? '', m[0].match(/Target="([^"]+)"/)?.[1] ?? '']));
  const sheets = [...text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: decode(m[0].match(/name="([^"]*)"/)?.[1] ?? ''), rid: m[0].match(/r:id="([^"]+)"/)?.[1] ?? '' }));
  const colIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return sheets
    .map((s) => {
      const target = rels.get(s.rid)?.replace(/^\/?(xl\/)?/, 'xl/');
      const xml = target && files[target] ? strFromU8(files[target]) : '';
      const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
        const cells: string[] = [];
        for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ref = c[1].match(/\br="([A-Z]+\d+)"/)?.[1];
          if (!ref || !c[2]) continue;
          const type = c[1].match(/\bt="(\w+)"/)?.[1];
          const v = c[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
          cells[colIndex(ref)] = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? textRuns(c[2], 't') : decode(v ?? '');
        }
        return Array.from(cells, (x) => x ?? '').join('\t');
      });
      return `=== Sheet: ${s.name} ===\n${rows.filter((r) => r.trim()).join('\n')}`;
    })
    .join('\n\n');
}

export function readDocText(serviceId: string, ref: string): string | null {
  const p = join(docsDir(serviceId), `${ref}.extracted.txt`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

export const docFiles = (serviceId: string) => (existsSync(docsDir(serviceId)) ? readdirSync(docsDir(serviceId)) : []);

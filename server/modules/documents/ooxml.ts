/**
 * Plain-text extraction from Office Open XML files (.docx, .pptx, .xlsx).
 *
 * Claude can read PDFs, images and text directly but not Office files, so uploads in these
 * formats are converted to a sibling `.extracted.txt`. These formats are zips of XML;
 * regexes over that XML are enough for text (no layout, styles or charts) and keep the
 * dependency list to one tiny unzip library.
 */
import { strFromU8, unzipSync } from 'fflate';

/** Cap so a huge spreadsheet can't produce a file Claude cannot read in one go. */
const MAX_CHARS = 2_000_000;

type Zip = Record<string, Uint8Array>;
const xmlEntities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, e: string) => {
    if (e[0] !== '#') return xmlEntities[e] ?? match;
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

/** Concatenate the text of every `<tag>…</tag>` in `xml` (e.g. all `<a:t>` runs of a paragraph). */
function textRuns(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) => decodeEntities(m[1])).join('');
}

const entry = (zip: Zip, path: string): string => (zip[path] ? strFromU8(zip[path]) : '');
const numberIn = (s: string): number => parseInt(s.match(/\d+/)![0], 10);

/** @throws when the file is not a valid zip or contains no readable text. */
export function extractOoxmlText(ext: '.docx' | '.pptx' | '.xlsx', data: Uint8Array): string {
  const zip = unzipSync(data);
  const text = ext === '.docx' ? docx(zip) : ext === '.pptx' ? pptx(zip) : xlsx(zip);
  if (!text.trim()) throw new Error('no readable text found');
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[truncated at ${MAX_CHARS} characters]` : text;
}

function docx(zip: Zip): string {
  const xml = entry(zip, 'word/document.xml')
    .replace(/<\/w:tc>/g, ' | ') // table cell boundary
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(xml).replace(/\n{3,}/g, '\n\n');
}

function pptx(zip: Zip): string {
  const paragraphs = (xml: string) =>
    xml
      .split('</a:p>')
      .map((p) => textRuns(p, 'a:t'))
      .filter(Boolean)
      .join('\n');

  const slides = Object.keys(zip)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => numberIn(a) - numberIn(b));

  return slides
    .map((file, i) => {
      const notes = paragraphs(entry(zip, `ppt/notesSlides/notesSlide${numberIn(file)}.xml`));
      return `--- Slide ${i + 1} ---\n${paragraphs(entry(zip, file))}${notes ? `\n[Notes]\n${notes}` : ''}`;
    })
    .join('\n\n');
}

/** Sheets are tab-separated rows. Cells hold either a number/inline string or an index into sharedStrings. */
function xlsx(zip: Zip): string {
  const shared = [...entry(zip, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1], 't'));

  // A sheet's name is in workbook.xml; its file is found through the relationship id.
  const targets = new Map([...entry(zip, 'xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/Id="([^"]+)"/)?.[1] ?? '', m[0].match(/Target="([^"]+)"/)?.[1] ?? '']));
  const sheets = [...entry(zip, 'xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decodeEntities(m[0].match(/name="([^"]*)"/)?.[1] ?? ''),
    rid: m[0].match(/r:id="([^"]+)"/)?.[1] ?? '',
  }));

  /** "AB12" → 27 (zero-based column index). */
  const columnIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

  return sheets
    .map((sheet) => {
      const target = targets.get(sheet.rid)?.replace(/^\/?(xl\/)?/, 'xl/');
      const xml = target ? entry(zip, target) : '';
      const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
        const cells: string[] = [];
        for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ref = c[1].match(/\br="([A-Z]+\d+)"/)?.[1];
          if (!ref || !c[2]) continue;
          const type = c[1].match(/\bt="(\w+)"/)?.[1];
          const value = c[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
          cells[columnIndex(ref)] = type === 's' ? (shared[Number(value)] ?? '') : type === 'inlineStr' ? textRuns(c[2], 't') : decodeEntities(value ?? '');
        }
        return Array.from(cells, (x) => x ?? '').join('\t');
      });
      return `=== Sheet: ${sheet.name} ===\n${rows.filter((r) => r.trim()).join('\n')}`;
    })
    .join('\n\n');
}

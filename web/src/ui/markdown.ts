/**
 * A small Markdown → HTML converter for the knowledge files.
 *
 * Safety is the design constraint: the text originates in uploaded documents (via Claude),
 * so it is untrusted. Everything is HTML-escaped first and only the constructs below can
 * create elements. There is no raw-HTML passthrough and links are limited to http(s).
 *
 * Supported: headings, paragraphs, bullet/numbered lists, tables, block quotes, code
 * fences, horizontal rules, **bold**, *italic*, `code`, [links](https://…).
 * "(inferred)" / "(추정)" are highlighted because the learning prompt uses them to flag guesses.
 */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
    .replace(/\((inferred|추정)\)/gi, '<span class="tag-inferred">($1)</span>');
}

const LIST_ITEM = /^\s*([-*]|\d+\.)\s+/;
const TABLE_ROW = /^\|.*\|\s*$/;
const BLOCK_START = /^(#{1,4}\s|```|>|\s*([-*]|\d+\.)\s+|\|)/;

const tableCells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++; // closing fence
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
    } else if (/^#{1,4}\s/.test(line)) {
      // The page already has an h1, so "#" renders as h2.
      const level = line.match(/^#+/)![0].length + 1;
      out.push(`<h${level}>${inline(line.replace(/^#+\s*/, ''))}</h${level}>`);
      i++;
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      out.push('<hr>');
      i++;
    } else if (TABLE_ROW.test(line) && /^\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = tableCells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++) rows.push(tableCells(lines[i]));
      const th = head.map((c) => `<th>${inline(c)}</th>`).join('');
      const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
    } else if (LIST_ITEM.test(line)) {
      const tag = /^\s*\d+\./.test(line) ? 'ol' : 'ul';
      const items: string[] = [];
      for (; i < lines.length && LIST_ITEM.test(lines[i]); i++) items.push(inline(lines[i].replace(LIST_ITEM, '')));
      out.push(`<${tag}>${items.map((t) => `<li>${t}</li>`).join('')}</${tag}>`);
    } else if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) quoted.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(quoted.join(' '))}</blockquote>`);
    } else if (!line.trim()) {
      i++;
    } else {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]); i++) para.push(lines[i]);
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

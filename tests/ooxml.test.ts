import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { extractOoxmlText } from '../server/modules/documents/ooxml.ts';

/** Build a minimal Office zip from path → XML. */
const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

test('docx: paragraphs on their own lines, entities decoded', () => {
  const data = zip({ 'word/document.xml': '<w:document><w:p><w:r><w:t>첫 줄 &amp; 둘</w:t></w:r></w:p><w:p><w:r><w:t>둘째 줄</w:t></w:r></w:p></w:document>' });
  assert.equal(extractOoxmlText('.docx', data).trim(), '첫 줄 & 둘\n둘째 줄');
});

test('docx: table cells are separated', () => {
  const data = zip({ 'word/document.xml': '<w:tbl><w:tr><w:tc><w:p><w:t>A</w:t></w:p></w:tc><w:tc><w:p><w:t>B</w:t></w:p></w:tc></w:tr></w:tbl>' });
  assert.match(extractOoxmlText('.docx', data), /A\n? \| B/);
});

test('pptx: slides are in numeric order, with notes', () => {
  const data = zip({
    'ppt/slides/slide10.xml': '<p:sld><a:p><a:t>열 번째</a:t></a:p></p:sld>',
    'ppt/slides/slide2.xml': '<p:sld><a:p><a:t>두 번째</a:t></a:p></p:sld>',
    'ppt/notesSlides/notesSlide2.xml': '<p:notes><a:p><a:t>메모</a:t></a:p></p:notes>',
  });
  const text = extractOoxmlText('.pptx', data);
  assert.ok(text.indexOf('두 번째') < text.indexOf('열 번째'), 'slide 2 before slide 10');
  assert.match(text, /\[Notes\]\n메모/);
});

test('xlsx: shared strings, numbers and column gaps', () => {
  const data = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="가격" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>사과</t></si><si><t>배</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>1000</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>2000</v></c></row></sheetData></worksheet>',
  });
  assert.equal(extractOoxmlText('.xlsx', data), '=== Sheet: 가격 ===\n사과\t\t1000\n배\t2000');
});

test('a file with no readable text is rejected', () => {
  assert.throws(() => extractOoxmlText('.docx', zip({ 'word/document.xml': '<w:document/>' })), /no readable text/);
});

test('bytes that are not a zip are rejected', () => {
  assert.throws(() => extractOoxmlText('.docx', strToU8('plain text')));
});

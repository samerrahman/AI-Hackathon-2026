// Rebuilds the two hand-written fixtures (pasted notes and no notes) as POST /api/topic bodies.
// The two PDF fixtures were captured from the real browser upload flow instead (see README.md).
//   npx tsx evals/stu-on-topic/make-fixtures.mts
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceSpan, StudyDocument } from '../../shared/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const pdfjsVersion = (createRequire(import.meta.url)('pdfjs-dist/package.json') as { version: string }).version;
// Same value src/lib/documents.ts stamps on every document it reads.
const PROCESSING_VERSION = `native-text-v4-pdfjs-${pdfjsVersion}`;

/** Node port of ingestText in src/lib/documents.ts: same cleaning, paragraph spans, ids, pages and hash. */
export function textDocument(text: string, title: string): StudyDocument {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  const encoded = new TextEncoder().encode(clean);
  const hash = createHash('sha256').update(encoded).digest('hex');
  const id = `doc-${hash.slice(0, 24)}`;
  const paragraphs = clean.split(/\n\s*\n/).flatMap(paragraph => paragraph.length < 2000 ? [paragraph] : paragraph.match(/[\s\S]{1,1800}(?:\s|$)|\S{1,1800}/g) ?? [paragraph]);
  let pageIndex = 0;
  let pageLength = 0;
  const spans: SourceSpan[] = paragraphs.map((paragraph, index) => {
    if (pageLength && pageLength + paragraph.length > 4500) { pageIndex++; pageLength = 0; }
    pageLength += paragraph.length;
    return { id: `${id}-p${pageIndex}-s${index}`, documentId: id, pageIndex, text: paragraph.trim(), quality: 'user-supplied text; section-level location', kind: 'paragraph' };
  });
  return { id, name: title, size: encoded.byteLength, hash, pageCount: pageIndex + 1, spans, warnings: [], kind: 'text', processingVersion: PROCESSING_VERSION };
}

const write = (name: string, body: unknown) => { writeFileSync(join(here, 'fixtures', `${name}.json`), `${JSON.stringify(body, null, 2)}\n`); console.log(`wrote fixtures/${name}.json`); };
const notes = readFileSync(join(here, 'fixtures', 'photosynthesis.txt'), 'utf8');
write('photosynthesis', { title: 'Photosynthesis', depth: 'big-picture', mode: 'live', documents: [textDocument(notes, 'Photosynthesis')] });
// "Or just start talking": a title and no notes, so the Judge grades from its own knowledge.
write('supply-and-demand', { title: 'Supply and demand', depth: 'big-picture', mode: 'live', documents: [] });

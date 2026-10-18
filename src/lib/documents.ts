import { GlobalWorkerOptions, getDocument, version as pdfjsVersion } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { SourceSpan, StudyDocument } from '../../shared/types';
import { nativeLines, spansFromLines } from './pdf-spans';
import { readDocumentCache, writeDocumentCache } from './storage';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const PROCESSING_VERSION = `native-text-v4-pdfjs-${pdfjsVersion}`;
export const limits = { maxFiles: 5, maxBytes: 20 * 1024 * 1024, maxPages: 100, maxTextCharacters: 300000 } as const;

const sha256 = async (data: ArrayBuffer): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), byte => byte.toString(16).padStart(2, '0')).join('');
export async function ingestPdf(file: File, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<StudyDocument> {
  signal?.throwIfAborted();
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') throw new Error('Choose a PDF, or paste your notes as text.');
  if (!file.size) throw new Error('This file is empty. Choose another PDF or paste your notes.');
  if (file.size > limits.maxBytes) throw new Error('This PDF is larger than 20 MB. Split it into a smaller lecture first.');
  onProgress?.(`Reading ${file.name}…`);
  const bytes = await file.arrayBuffer();
  const hash = await sha256(bytes);
  signal?.throwIfAborted();
  const cacheKey = `${PROCESSING_VERSION}:${hash}`;
  const cached = await readDocumentCache<StudyDocument>(cacheKey);
  signal?.throwIfAborted();
  if (cached) { onProgress?.(`Restored ${cached.pageCount} previously read pages`); return { ...cached, name: file.name, blob: file }; }
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const abort = () => { void loading.destroy().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await loading.promise;
    signal?.throwIfAborted();
    if (pdf.numPages > limits.maxPages) throw new Error(`This PDF has ${pdf.numPages} pages. Choose up to ${limits.maxPages} pages per PDF.`);
    const documentId = `doc-${hash.slice(0, 24)}`;
    const spans: SourceSpan[] = [];
    const warnings: string[] = [];
    for (let index = 0; index < pdf.numPages; index++) {
      signal?.throwIfAborted();
      onProgress?.(`Reading page ${index + 1} of ${pdf.numPages} · ${file.name}`);
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is TextItem => 'str' in item);
      const pageSpans = spansFromLines(nativeLines(items, content.styles, page.getViewport({ scale: 1 })), documentId, index);
      const readable = pageSpans.reduce((n, span) => n + span.text.trim().length, 0);
      if (readable < 40) warnings.push(`Page ${index + 1}: ${readable ? 'very little readable text' : 'no extractable text'}. It may be scanned or contain figures; inspect the original or paste this section.`);
      if (items.some(item => item.str.includes('\uFFFD'))) warnings.push(`Page ${index + 1}: some characters could not be read reliably. Check formulas against the original.`);
      spans.push(...pageSpans);
      page.cleanup();
    }
    if (spans.reduce((n, span) => n + span.text.length, 0) < 40) throw new Error('This PDF has too little readable text to prepare a session. It may be scanned. OCR is not available yet; paste the notes or choose a text-based PDF.');
    const result: StudyDocument = { id: documentId, name: file.name, size: file.size, hash, pageCount: pdf.numPages, spans, warnings, kind: 'pdf', blob: file, processingVersion: PROCESSING_VERSION };
    signal?.throwIfAborted();
    await writeDocumentCache(cacheKey, result);
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('This PDF is password protected. Upload an unlocked copy or paste the notes.');
    if (error instanceof Error && (error.name === 'InvalidPDFException' || error.name === 'MissingPDFException')) throw new Error('This file could not be read as a PDF. Try another file or paste the notes.');
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    await loading.destroy().catch(() => undefined);
  }
}

export async function ingestText(text: string, title = 'Pasted notes', signal?: AbortSignal): Promise<StudyDocument> {
  signal?.throwIfAborted();
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (clean.length < 40) throw new Error('Paste at least a few sentences so Stu has enough material to work with.');
  if (clean.length > limits.maxTextCharacters) throw new Error('These notes are too long. Paste up to 300,000 characters at a time.');
  const encoded = new TextEncoder().encode(clean);
  const hash = await sha256(encoded.buffer);
  signal?.throwIfAborted();
  const id = `doc-${hash.slice(0, 24)}`;
  const paragraphs = clean.split(/\n\s*\n/).flatMap(paragraph => {
    if (paragraph.length < 2000) return [paragraph];
    // Break long blocks only at existing whitespace, preserving the original words.
    return paragraph.match(/[\s\S]{1,1800}(?:\s|$)|\S{1,1800}/g) ?? [paragraph];
  });
  let pageIndex = 0;
  let pageLength = 0;
  const spans: SourceSpan[] = paragraphs.map((text, index) => {
    if (pageLength && pageLength + text.length > 4500) { pageIndex++; pageLength = 0; }
    pageLength += text.length;
    return { id: `${id}-p${pageIndex}-s${index}`, documentId: id, pageIndex, text: text.trim(), quality: 'user-supplied text; section-level location', kind: 'paragraph' };
  });
  const result: StudyDocument = { id, name: title.trim() || 'Pasted notes', size: encoded.byteLength, hash, pageCount: pageIndex + 1, spans, warnings: [], kind: 'text', blob: new Blob([clean], { type: 'text/plain' }), processingVersion: PROCESSING_VERSION };
  signal?.throwIfAborted();
  await writeDocumentCache(`${PROCESSING_VERSION}:${hash}`, result);
  return result;
}

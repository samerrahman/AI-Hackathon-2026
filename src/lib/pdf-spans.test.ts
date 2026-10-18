import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { nativeLines, spansFromLines } from './pdf-spans';

const normalized = (text: string) => text.replace(/\s+/g, ' ').trim();

test('both real sample PDFs retain actual text, page identity, and bounded native highlights', async () => {
  for (const filename of ['Sequences_and_Convergence.pdf', 'Experiments_and_Causal_Claims.pdf']) {
    const data = new Uint8Array(await readFile(new URL(`../../public/examples/${filename}`, import.meta.url)));
    const loading = getDocument({ data, useSystemFonts: true });
    const pdf = await loading.promise;
    try {
      const allIds = new Set<string>();
      let textLength = 0;
      for (let index = 0; index < pdf.numPages; index++) {
        const page = await pdf.getPage(index + 1);
        const content = await page.getTextContent();
        const items = content.items.filter((item): item is TextItem => 'str' in item);
        const spans = spansFromLines(nativeLines(items, content.styles, page.getViewport({ scale: 1 })), 'sample', index);
        const extracted = normalized(spans.map(span => span.text).join(' '));
        for (const item of items.filter(item => item.str.trim().length > 40)) assert.ok(extracted.includes(normalized(item.str)), `Lost actual text on ${filename} page ${index + 1}`);
        for (const span of spans) {
          assert.equal(span.pageIndex, index);
          assert.equal(span.documentId, 'sample');
          assert.ok(!allIds.has(span.id));
          allIds.add(span.id);
          textLength += span.text.length;
          for (const rect of span.rects ?? []) {
            assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0);
            assert.ok(rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001);
          }
        }
      }
      assert.ok(textLength > 1000, 'A readable lecture must not become an empty or filename-derived study plan');
    } finally { await loading.destroy(); }
  }
});

const item = (str: string, transform = [12, 0, 0, 12, 72, 720]): TextItem => ({ str, transform, width: 180, height: 12, fontName: 'test', hasEOL: true, dir: 'ltr' });
const styles = { test: { fontFamily: 'serif', ascent: .8, descent: -.2, vertical: false } };
const viewport = { transform: [1, 0, 0, -1, 0, 792], width: 612, height: 792, scale: 1 };

test('unfamiliar reordered material preserves negation, terminology, and document/page scope', () => {
  const first = spansFromLines(nativeLines([item('An amber lattice is not stable unless the boundary remains fixed.')], styles, viewport), 'new-material', 1);
  const second = spansFromLines(nativeLines([item('A violet lattice can remain stable when its boundary changes.')], styles, viewport), 'new-material', 0);
  assert.equal(first[0].text, 'An amber lattice is not stable unless the boundary remains fixed.');
  assert.equal(second[0].text, 'A violet lattice can remain stable when its boundary changes.');
  assert.equal(first[0].pageIndex, 1);
  assert.equal(second[0].pageIndex, 0);
  assert.notEqual(first[0].id, second[0].id);
  assert.ok(first[0].id.startsWith('new-material-'));
});

test('native line bounds transform from bottom-left PDF coordinates and remain anchored at zoom', () => {
  const atOne = nativeLines([item('This condition is necessary.')], styles, viewport)[0].rects[0];
  const atTwo = nativeLines([item('This condition is necessary.')], styles, { transform: [2, 0, 0, -2, 0, 1584], width: 1224, height: 1584, scale: 2 })[0].rects[0];
  assert.deepEqual(atOne, atTwo);
  assert.equal(atOne.x, 72 / 612);
  assert.equal(atOne.y, (792 - 720 - 12 * .8) / 792);
  assert.equal(atOne.width, 180 / 612);
});

test('rotated glyphs keep text and a page reference without invented precise rectangles', () => {
  const spans = spansFromLines(nativeLines([item('Read this rotated statement on the original page.', [0, 12, -12, 0, 72, 720])], styles, viewport), 'rotated', 2);
  assert.equal(spans[0].rects?.length, 0);
  assert.equal(spans[0].pageIndex, 2);
  assert.match(spans[0].quality, /partial location/);
});

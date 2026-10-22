import test from 'node:test';
import assert from 'node:assert/strict';
import { speechChunks } from './speech.js';

test('long spoken responses preserve all text in sentence-sized requests', () => {
  const text = 'The bound controls the size of the terms. It does not alone control their direction. '.repeat(14);
  const chunks = speechChunks(text);
  assert.equal(chunks.join(''), text.trim());
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every(chunk => chunk.length <= 350));
  assert.ok(chunks.slice(0, -1).every(chunk => chunk.endsWith('. ')));
  assert.deepEqual(speechChunks('A short response. One question?'), ['A short response. One question?']);
  const unicode = '🔬'.repeat(400);
  assert.equal(speechChunks(unicode).join(''), unicode);
  assert.ok(speechChunks(unicode).every(chunk => !/[\uD800-\uDBFF]$/.test(chunk)));
});

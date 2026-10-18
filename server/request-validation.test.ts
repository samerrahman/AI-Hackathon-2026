import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest } from './request-validation.js';
import { createTopicSchema } from './teach-schema.js';
import { ApiError } from './schema.js';

const request = { title: 'π', depth: 'big-picture', documents: [], mode: 'live' };
test('topic form and server both accept a nonempty one-character title', () => {
  assert.equal(parseRequest(createTopicSchema, request).title, 'π');
});
test('invalid topic requests identify the field without echoing study content', () => {
  assert.throws(() => parseRequest(createTopicSchema, { ...request, title: 'private '.repeat(50) }), (e: unknown) =>
    e instanceof ApiError && e.status === 400 && e.code === 'INVALID_REQUEST' && e.message.includes('160') && !e.message.includes('private'));
  assert.throws(() => parseRequest(createTopicSchema, { ...request, documents: [{ id: 'secret' }] }), (e: unknown) =>
    e instanceof ApiError && e.message.includes('Notes 1') && !JSON.stringify(e).includes('secret'));
});

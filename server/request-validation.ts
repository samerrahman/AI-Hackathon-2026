import { z } from 'zod';
import { ApiError } from './schema.js';

/** Only HTTP input is a 400. Model/output validation must not blame the student's notes. */
export function parseRequest<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issues = result.error.issues.slice(0, 4);
  // Paths and constraint types only: never log values, uploaded text, or sealed state.
  const detail = issues.map(issue => `${issue.path.join('.') || 'request'}: ${issue.code}`).join('; ');
  const first = issues[0];
  let message = 'Some study data could not be read. Your notes are still here; retry preparing the topic.';
  if (first.path[0] === 'title') message = 'Enter a topic title between 1 and 160 characters, then try again.';
  else if (first.path[0] === 'text') message = `Send text between 1 and ${first.code === 'too_big' ? Number(first.maximum).toLocaleString('en-US') : '12,000'} characters. Your draft is safe.`;
  else if (first.path[0] === 'stateToken') message = 'This saved conversation cannot be resumed. Your notes are still saved; start a new topic with them.';
  else if (first.path[0] === 'documents') {
    const number = typeof first.path[1] === 'number' ? ` ${first.path[1] + 1}` : '';
    message = `Notes${number} could not be read (${first.path.slice(2).join('.') || 'documents'}: ${first.code}). Keep the original file and try uploading it again, or paste its text.`;
  }
  throw new ApiError(400, message, 'INVALID_REQUEST', detail);
}

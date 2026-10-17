import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { rubricSchema, type ConceptRubric, type Topic } from './models';

export function publicTopic(topic: Topic): Topic {
  return { ...topic, rubric: { ...topic.rubric, concepts: topic.rubric.concepts.map(({ id, title }) => ({ id, title, criterion: title })) } };
}

export function notesRubric(referenceNotes: string): ConceptRubric {
  const segments = referenceNotes.split(/\n+|[.!?]\s+/).map((s) => s.trim()).filter((s) => s.length > 12).slice(0, 6);
  return { source: 'reference notes', concepts: (segments.length ? segments : [referenceNotes.trim()]).map((text, i) => ({ id: `note-${i + 1}`, title: `Idea ${i + 1}`, criterion: text.slice(0, 360) })) };
}

export function sealRubric(rubric: ConceptRubric): string {
  const key = createHash('sha256').update(process.env.STEPFUN_API_KEY || 'demo-only-rubric-key').digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(rubric), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString('base64url');
}

export function unsealRubric(token: string): ConceptRubric {
  const bytes = Buffer.from(token, 'base64url');
  const key = createHash('sha256').update(process.env.STEPFUN_API_KEY || 'demo-only-rubric-key').digest();
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return rubricSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')));
}

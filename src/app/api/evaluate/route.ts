import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionSchema } from '@/lib/models';
import { topicById } from '@/lib/topics';
import { evaluate } from '@/lib/evaluator';
import { notesRubric, unsealRubric } from '@/lib/rubric-privacy';

const requestSchema = z.object({ session: sessionSchema, explanation: z.string().max(6000), signal: z.enum(['explain', 'too_easy', 'simpler', 'hint']) });

export async function POST(request: Request) {
  try {
    const { session, explanation, signal } = requestSchema.parse(await request.json());
    if (signal === 'explain' && !explanation.trim()) return NextResponse.json({ error: 'Write an explanation first.' }, { status: 400 });
    const preset = topicById(session.topic.id);
    const privateRubric = preset?.rubric ?? (session.referenceNotes.trim() ? notesRubric(session.referenceNotes) : session.rubricToken ? unsealRubric(session.rubricToken) : session.topic.rubric);
    const safeSession = { ...session, topic: preset ?? { ...session.topic, rubric: privateRubric } };
    const evaluation = await evaluate(safeSession, explanation, signal);
    const { questionPurpose: _privatePurpose, ...publicEvaluation } = evaluation;
    void _privatePurpose;
    return NextResponse.json({ evaluation: publicEvaluation });
  } catch { return NextResponse.json({ error: 'Could not evaluate this turn. Please try again.' }, { status: 400 }); }
}

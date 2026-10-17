import { NextResponse } from 'next/server';
import { z } from 'zod';
import { difficultySchema, type ConceptRubric, type Topic } from '@/lib/models';
import { topicById } from '@/lib/topics';
import { createSession } from '@/lib/session';
import { demoMode, generateRubric } from '@/lib/evaluator';
import { notesRubric, publicTopic, sealRubric } from '@/lib/rubric-privacy';

const requestSchema = z.object({ topicId: z.string(), customTitle: z.string().max(100), referenceNotes: z.string().max(12000), difficulty: difficultySchema });

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    let topic: Topic;
    let rubricToken: string | undefined;
    const preset = topicById(input.topicId);
    if (preset) topic = preset;
    else {
      const title = input.customTitle.trim();
      if (!title) return NextResponse.json({ error: 'Enter a topic to teach.' }, { status: 400 });
      let rubric: ConceptRubric;
      if (input.referenceNotes.trim()) rubric = notesRubric(input.referenceNotes);
      else {
        rubric = await generateRubric(title);
        rubricToken = sealRubric(rubric);
      }
      topic = { id: 'custom', title, subtitle: 'A topic chosen by you', icon: '✦', rubric };
    }
    return NextResponse.json({ session: createSession(publicTopic(topic), input.difficulty, input.referenceNotes, demoMode() ? 'demo' : 'live', rubricToken) });
  } catch { return NextResponse.json({ error: 'Could not start that session. Check the topic and try again.' }, { status: 400 }); }
}

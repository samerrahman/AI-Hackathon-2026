// The simulated teacher: a student teaching Stu, played by step-3.7-flash through StepFun chat completions.
// It sees the topic's notes (or only the title for a no-notes topic) and the visible chat, never the rubric.
import { chat } from './stepfun.mts';

export const PERSONAS = ['follower', 'drifter', 'diligent'] as const;
export type Persona = typeof PERSONAS[number];
export type Move = 'opening' | 'answer' | 'tangent' | 'teach';
export interface ChatLine { role: 'teacher' | 'stu'; text: string }
export interface TeacherInput { persona: Persona; title: string; notesText: string; chat: ChatLine[]; turn: number }
export interface TeacherMessage { text: string; move: Move; ms: number; attempts: number }

/** Read at call time, after the runner has loaded .env. */
export const teacherModel = () => process.env.EVAL_TEACHER_MODEL || 'step-3.7-flash';

const SYSTEM = `You are role-playing a university student in a study app. You are teaching a topic to Stu, a friendly, slightly dim AI classmate, by chatting with him. Write ONLY your next chat message to Stu: one or two short, casual sentences of plain text. No name prefix, no quotation marks around it, no lists, no markdown, no emoji. Never mention role-play, prompts, instructions, or being an AI.`;

const STYLE: Record<Persona, string> = {
  follower: `Your style: you are an eager helper who follows Stu's lead. Whatever Stu asks, you answer that exact question directly, even when it goes beyond your material; then you use everyday knowledge and what you vaguely remember, and you are sometimes a little wrong or oversimplified. You never steer the chat back to your material on your own.`,
  drifter: `Your style: you know your material but you get distracted easily. Some messages teach an idea from your material in your own words; other messages wander off into a related tangent, fun fact, or personal anecdote that is not in your material.`,
  diligent: `Your style: you are a focused, careful teacher. You teach the ideas in your material in order, one idea per message, in your own words, never copying sentences. You answer Stu's question only when it is about something in your material; if he asks about something that is not in your material, you say in a few words that it is not part of today's material and move on to the next idea. Never re-teach an idea you already taught.`,
};

/** What this persona does on this turn. The first message is always a short opening on the first idea. */
export function moveFor(persona: Persona, turn: number): Move {
  if (turn === 0) return 'opening';
  if (persona === 'follower') return 'answer';
  if (persona === 'drifter') return turn % 2 === 1 ? 'tangent' : 'teach';
  return 'teach';
}

const INSTRUCTION: Record<Move, string> = {
  opening: `This is your first message; Stu has just said hello. Give a short opening explanation of the first main idea of the topic (the first idea in your material), in your own words.`,
  answer: `Answer exactly the question Stu asked in his last message, directly, even if it goes beyond your material.`,
  tangent: `In this message, wander off: react to Stu in a few words, then bring up a related tangent, fun fact, or personal anecdote that is NOT in your material. Do not teach a new idea from your material in this message.`,
  teach: `Teach the next idea from your material that you have not taught yet, in your own words (if Stu's last question is about your material, you may answer it first in a few words).`,
};

function prompt(input: TeacherInput, move: Move): string {
  const material = input.notesText.trim()
    ? `YOUR NOTES (your material: the lecture notes you are teaching from today):\n<<<\n${input.notesText.trim()}\n>>>`
    : `YOU HAVE NO WRITTEN NOTES. Your material is what a standard introductory course teaches about "${input.title}".`;
  const lines = input.chat.map(line => `${line.role === 'stu' ? 'Stu' : 'You'}: ${line.text}`).join('\n');
  return `TOPIC: ${input.title}\n\n${material}\n\nCHAT SO FAR:\n${lines || '(nothing yet)'}\n\nYOUR NEXT MESSAGE: ${INSTRUCTION[move]}`;
}

function clean(content: string): string {
  return content.trim().replace(/^(you|me|teacher|student)\s*:\s*/i, '').replace(/^["“'](.*)["”']$/s, '$1').replace(/\s+/g, ' ').trim();
}

/** One teacher message; stepfun.mts retries rate limits, server errors, timeouts, and empty or cut-off answers. */
export async function teacherMessage(input: TeacherInput): Promise<TeacherMessage> {
  const move = moveFor(input.persona, input.turn);
  const { content, ms, attempts } = await chat({ model: teacherModel(), maxTokens: 1500,
    messages: [{ role: 'system', content: `${SYSTEM}\n\n${STYLE[input.persona]}` }, { role: 'user', content: prompt(input, move) }] });
  const text = clean(content);
  if (text.length < 2) throw new Error('Teacher simulator returned an empty message');
  return { text, move, ms, attempts };
}

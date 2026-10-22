import type { SourceSpan } from '../shared/types.js';
import type { TeachProvider, JudgeInput, BriefInput, StuInput, ModelResult } from './teach-provider.js';
import type { JudgeResult, RelearnBrief, RubricDraft, StuResult } from './teach-schema.js';

const ideas = {
  analysis: [
    ['boundedness', 'bounded sequence', 'stays within a finite range'],
    ['convergence', 'convergent sequence', 'approaches a limit'],
    ['completeness', 'complete real numbers', 'limits supported by completeness'],
  ],
  research: [
    ['random sampling', 'random sampling', 'who enters a study'],
    ['random assignment', 'random assignment', 'who receives a treatment'],
    ['causal claims', 'causal inference', 'what an experiment can conclude'],
  ],
} as const;
// Shorten a teacher quote at a word boundary instead of mid-word.
function clip(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:.]$/, '')}…`;
}
function sampleResult<T>(data: T, model = 'sample-fixture'): ModelResult<T> { return { data, model, durationMs: 0 }; }
export class DemoTeachProvider implements TeachProvider {
  readonly judgeModel = 'sample-fixture'; readonly stuModel = 'sample-fixture';
  constructor(private sampleId: 'analysis' | 'research') {}
  async rubric(input: { sources: SourceSpan[] }): Promise<ModelResult<RubricDraft>> {
    const coreIdeas = ideas[this.sampleId].map(idea => idea[1]);
    const items: RubricDraft['items'] = [];
    ideas[this.sampleId].forEach((idea, index) => {
      const match = input.sources.find(s => s.text.toLowerCase().includes(idea[0])) ?? input.sources[0];
      items.push({ ideaIndex: index, stage: 'cover', requirement: `Name ${idea[1]} and give its gist in plain language`, sourceIds: [match.id] });
      items.push({ ideaIndex: index, stage: 'explain', requirement: `Explain how ${idea[1]} works and what ${idea[2]}`, sourceIds: [match.id] });
    });
    items.push({ ideaIndex: 0, stage: 'connect', requirement: `Connect ${coreIdeas[0]} with ${coreIdeas[1]}`, sourceIds: [input.sources[0].id] });
    items.push({ ideaIndex: 1, stage: 'connect', requirement: `Contrast ${coreIdeas[1]} with ${coreIdeas[2]}`, sourceIds: [input.sources[0].id] });
    items.push({ ideaIndex: 2, stage: 'connect', requirement: `Show how ${coreIdeas[2]} builds on ${coreIdeas[0]}`, sourceIds: [input.sources[0].id] });
    return sampleResult({ coreIdeas, items });
  }
  async judge(input: JudgeInput): Promise<ModelResult<JudgeResult>> {
    // Grade each pending teacher message (the transcript also holds Stu's replies).
    const pending = new Set(input.pendingTeacherMessageIds);
    const credits = input.transcript.filter(message => message.role === 'user' && pending.has(message.id)).flatMap(message => {
      const text = message.text.toLowerCase();
      if (text.split(/\s+/).length < 8 || /^(yes|exactly|that's right)/i.test(text)) return [];
      return input.rubric.filter(item => !input.creditedItemIds.includes(item.id)
        && ideas[this.sampleId].some(idea => item.requirement.toLowerCase().includes(idea[1]) && text.includes(idea[0])))
        .map(item => ({ rubricItemId: item.id, teacherMessageId: message.id, quote: message.text.slice(0, 1200) }));
    });
    const seen = new Set<string>();
    return sampleResult({ credits: credits.filter(credit => !seen.has(credit.rubricItemId) && Boolean(seen.add(credit.rubricItemId))), revocations: [], problems: [] });
  }
  async brief(input: BriefInput): Promise<ModelResult<RelearnBrief>> {
    const names = ideas[this.sampleId].map(idea => idea[1]);
    return sampleResult({ teacherQuote: input.verifiedTeacherQuotes[0] ?? '', accurateSummary: `You explained ${names.join(', ')} in your own words.`,
      correction: input.pastProblems.some(problem => problem.type === 'wrong') ? 'One earlier claim needed correcting; the notes show the accurate version.' : '',
      quizFeedback: input.transition ? '' : 'Thanks, that answer uses the key idea.', quizQuestion: `How would you apply ${names[input.quizTurn % names.length]} to a new example?`,
      sourceIds: input.sources.length ? [input.sources[0].id] : [] });
  }
  async stu(input: StuInput): Promise<ModelResult<StuResult>> {
    const styles = ['literal', 'example', 'causal', 'contrast'] as const;
    // Rotate by the whole transcript and never repeat the previous style (the teach-back follows a reply directly).
    const index = input.transcript.length % styles.length;
    const questionStyle = styles[index] === input.lastQuestionStyle ? styles[(index + 1) % styles.length] : styles[index];
    if (input.mode === 'relearn') {
      const { brief, transition } = input.director as { brief: { teacherQuote: string; accurateSummary: string; quizFeedback: string; quizQuestion: string }; transition?: boolean };
      // The full teach-back once; after that, feedback on the answer and the next quiz question.
      const text = transition ? `You taught me using “${clip(brief.teacherQuote, 70)}”. ${brief.accurateSummary} ${brief.quizQuestion}` : `${brief.quizFeedback} ${brief.quizQuestion}`.trim();
      return sampleResult({ text, questionStyle });
    }
    const director = input.director as { focus: { anchorQuote: string } };
    const asks = {
      literal: (q: string) => `Wait, when you say “${q}”, do you mean that literally, word for word?`,
      example: (q: string) => `Okay, “${q}”… could you give me one real example of that?`,
      causal: (q: string) => `Hmm, you said “${q}”. Why does that happen?`,
      contrast: (q: string) => `So “${q}”. How is that different from what happens otherwise?`,
    };
    return sampleResult({ text: asks[questionStyle](clip(director.focus.anchorQuote, 60).replace(/[?!]/g, '')), questionStyle });
  }
}

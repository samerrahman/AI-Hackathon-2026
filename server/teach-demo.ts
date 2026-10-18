import type { SourceSpan } from '../shared/types.js';
import type { TeachProvider, JudgeInput, StuInput, ModelResult } from './teach-provider.js';
import type { JudgeResult, RubricDraft, StuResult } from './teach-schema.js';

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
    items.push({ ideaIndex: 2, stage: 'connect', requirement: `Show a meaningful link among these ideas`, sourceIds: [input.sources[0].id] });
    return sampleResult({ coreIdeas, items });
  }
  async judge(input: JudgeInput): Promise<ModelResult<JudgeResult>> {
    const message = input.transcript.at(-1)!;
    const text = message.text.toLowerCase();
    const rubric = input.rubric as { id: string; stage: string; requirement: string; sourceIds: string[] }[];
    const credits = rubric.filter(item => {
      const topic = ideas[this.sampleId].some(idea => item.requirement.toLowerCase().includes(idea[1]) && text.includes(idea[0]));
      return topic && text.split(/\s+/).length >= 8 && !/^(yes|exactly|that's right)/i.test(text);
    }).map(item => ({ rubricItemId: item.id, teacherMessageId: message.id, quote: message.text.slice(0, 1200) }));
    const already = input.credits as Record<string, { quote: string }>;
    const complete = new Set([...Object.keys(already), ...credits.map(c => c.rubricItemId)]).size === rubric.length;
    const firstQuote = Object.values(already)[0]?.quote ?? credits[0]?.quote ?? '';
    const brief = complete ? { teacherQuote: firstQuote, accurateSummary: `You explained ${ideas[this.sampleId].map(i => i[1]).join(', ')} in your own words.`, correction: '', quizFeedback: '', quizQuestion: `How would you apply ${ideas[this.sampleId][0][1]} to a new example?`, sourceIds: [input.sources[0].id] } : null;
    return sampleResult({ credits, revocations: [], problems: [], focus: { type: 'vague', teacherMessageId: message.id, anchorQuote: message.text.slice(0, 160), instruction: 'ask_clarify' }, mistake: null, allSatisfied: complete, relearnBrief: brief });
  }
  async stu(input: StuInput): Promise<ModelResult<StuResult>> {
    const styles = ['literal', 'example', 'causal', 'contrast'] as const;
    const index = input.transcript.filter(m => m.role === 'user').length % styles.length;
    const questionStyle = styles[index];
    if (input.mode === 'relearn') {
      const brief = (input.director as { brief: { teacherQuote: string; accurateSummary: string; quizQuestion: string } }).brief;
      return sampleResult({ text: `You taught me using “${brief.teacherQuote.slice(0, 70)}”. ${brief.accurateSummary} ${brief.quizQuestion}`, questionStyle });
    }
    const director = input.director as { focus: { anchorQuote: string } };
    return sampleResult({ text: `I’m trying to follow “${director.focus.anchorQuote.slice(0, 65)}.” Could you show me how that works?`, questionStyle });
  }
}

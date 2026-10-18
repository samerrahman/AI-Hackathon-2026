import Groq from 'groq-sdk';
import { z } from 'zod';
import type { SourceSpan } from '../shared/types.js';
import {
  ASSESSMENT_INSTRUCTION, CONCEPT_INSTRUCTION, STUDY_SYSTEM, VERIFICATION_INSTRUCTION,
  assessmentData, conceptData, verificationData, type AssessmentContext, type StudyProvider,
} from './provider.js';
import { ApiError, assessmentSchema, outlineSchema, verificationSchema, type ChallengeCandidate } from './schema.js';

type Task = 'concepts' | 'assessment' | 'verification';
type ClientOptions = NonNullable<ConstructorParameters<typeof Groq>[0]>;
const deadlines: Record<Task, number> = { concepts: 75_000, assessment: 45_000, verification: 30_000 };

export class GroqStudyProvider implements StudyProvider {
  private client?: Groq;
  constructor(key = process.env.GROQ_API_KEY, private model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b', fetchImplementation?: ClientOptions['fetch']) {
    // Disable SDK retries and logging so deadlines are predictable and uploaded
    // notes cannot appear in diagnostic logs, even if GROQ_LOG is set externally.
    if (key) this.client = new Groq({ apiKey: key, maxRetries: 0, logLevel: 'off', fetch: fetchImplementation });
  }

  private async generate<T>(schema: z.ZodType<T>, instruction: string, data: unknown, task: Task): Promise<T> {
    if (!this.client) throw new ApiError(503, 'Live study needs GROQ_API_KEY on the server. You can use either clearly labeled sample demo meanwhile.', 'PROVIDER_NOT_CONFIGURED');
    const recovery = task === 'concepts' ? 'Your notes are still here; retry preparing your study plan.' : 'Your draft is safe; try this turn again.';
    const signal = AbortSignal.timeout(deadlines[task]);
    const jsonSchema = strictSchema(z.toJSONSchema(schema)) as Record<string, unknown>;
    let content: string | null | undefined;
    try {
      const result = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'system', content: `${STUDY_SYSTEM}\n\n${instruction}` }, { role: 'user', content: JSON.stringify(data) }],
        response_format: { type: 'json_schema', json_schema: { name: `miso_${task}`, strict: true, schema: jsonSchema } },
        max_completion_tokens: 8192,
        // No tools or compound model: note text cannot enable browsing or actions.
        stream: false,
      }, { timeout: deadlines[task], maxRetries: 0, signal });
      content = result.choices?.[0]?.message?.content;
      if (result.choices?.[0]?.finish_reason !== 'stop') content = undefined;
    } catch (error) {
      if (signal.aborted || error instanceof Groq.APIConnectionTimeoutError || (error instanceof Error && error.name === 'TimeoutError')) throw new ApiError(504, `The study provider took too long to respond. ${recovery}`, 'PROVIDER_TIMEOUT');
      if (error instanceof Groq.APIConnectionError || error instanceof TypeError) throw new ApiError(502, `Miso could not connect to Groq. Check the server’s internet connection, VPN, or proxy. ${recovery}`, 'PROVIDER_NETWORK');
      if (error instanceof Groq.APIError) {
        if (error.status === 429) throw new ApiError(429, `Groq is busy or its quota was reached. Wait a moment before retrying. ${recovery}`, 'PROVIDER_LIMIT');
        if (error.status === 404) throw new ApiError(502, `The configured Groq model is unavailable. Check GROQ_MODEL and its access in your Groq account, then restart the server. ${recovery}`, 'PROVIDER_MODEL_UNAVAILABLE');
        if ([400, 401, 403, 422].includes(error.status ?? 0)) throw new ApiError(502, `Groq rejected this study request. Check the server API key and that GROQ_MODEL supports strict structured outputs. ${recovery}`, 'PROVIDER_CONFIGURATION');
        throw new ApiError(502, `Groq is temporarily unavailable. ${recovery}`, 'PROVIDER_ERROR');
      }
      throw new ApiError(502, `Miso received an incomplete study response and did not use it. ${recovery}`, 'INVALID_MODEL_OUTPUT');
    }
    try {
      if (!content) throw new Error('Empty or incomplete model output');
      return schema.parse(JSON.parse(content));
    } catch {
      throw new ApiError(502, `Miso received an incomplete study response and did not use it. ${recovery}`, 'INVALID_MODEL_OUTPUT');
    }
  }

  concepts(sources: SourceSpan[]) { return this.generate(outlineSchema, CONCEPT_INSTRUCTION, conceptData(sources), 'concepts'); }
  assess(context: AssessmentContext) { return this.generate(assessmentSchema, ASSESSMENT_INSTRUCTION, assessmentData(context), 'assessment'); }
  verify(candidate: ChallengeCandidate, sources: SourceSpan[]) { return this.generate(verificationSchema, VERIFICATION_INSTRUCTION, verificationData(candidate, sources), 'verification'); }
}

// Groq strict decoding requires closed objects and every field required. All
// current contracts already require their fields; challenge is explicitly nullable.
// Validate the original complete Zod contract after decoding, including bounds.
const localOnly = new Set(['$schema', 'minLength', 'maxLength', 'minItems', 'maxItems']);
function strictSchema(value: unknown, propertyMap = false): unknown {
  if (Array.isArray(value)) return value.map(item => strictSchema(item));
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = Object.fromEntries(Object.entries(value)
    .filter(([key]) => propertyMap || !localOnly.has(key))
    .map(([key, child]) => [key, strictSchema(child, !propertyMap && ['properties', '$defs', 'patternProperties'].includes(key))]));
  if (!propertyMap && output.type === 'object') {
    output.additionalProperties = false;
    output.required = Object.keys(output.properties as Record<string, unknown> ?? {});
  }
  return output;
}

import { z } from 'zod';
import type { SourceSpan } from '../shared/types.js';
import {
  ASSESSMENT_INSTRUCTION, CONCEPT_INSTRUCTION, STUDY_SYSTEM, VERIFICATION_INSTRUCTION,
  assessmentData, conceptData, verificationData, type AssessmentContext, type StudyProvider, type ProviderOptions,
} from './provider.js';
import { ApiError, assessmentSchema, outlineSchema, verificationSchema, type ChallengeCandidate } from './schema.js';
import { sseData } from '../shared/stream.js';
import { readReplyPrefix } from './partial-json.js';

export const DEFAULT_STEPFUN_MODEL = 'step-3.7-flash';
export const DEFAULT_STEPFUN_BASE_URL = 'https://api.stepfun.ai/v1';
type Task = 'concepts' | 'assessment' | 'verification';
const deadlines: Record<Task, number> = { concepts: 75_000, assessment: 45_000, verification: 30_000 };
const streamHeaderSchema = assessmentSchema.pick({ judgment: true, sourceIds: true, nextAction: true, challenge: true });

/** Direct StepFun HTTP calls. No OpenAI account, SDK, browser agent, or tools. */
export class StepFunStudyProvider implements StudyProvider {
  constructor(
    private key = process.env.STEPFUN_API_KEY,
    private model = process.env.STEPFUN_MODEL || DEFAULT_STEPFUN_MODEL,
    private baseUrl = process.env.STEPFUN_BASE_URL || DEFAULT_STEPFUN_BASE_URL,
    private fetchImplementation: typeof fetch = fetch,
  ) {}

  private async generate<T>(schema: z.ZodType<T>, instruction: string, data: unknown, task: Task, options:ProviderOptions = {}, sources:SourceSpan[] = []): Promise<T> {
    const started=performance.now();
    let firstChunkMs:number|undefined,firstReplyMs:number|undefined,inputTokens:number|undefined,outputTokens:number|undefined;
    if (!this.key) throw new ApiError(503, 'Live study needs STEPFUN_API_KEY on the server. You can use either clearly labeled sample demo meanwhile.', 'PROVIDER_NOT_CONFIGURED');
    const recovery = task === 'concepts' ? 'Your notes are still here; retry preparing your study plan.' : 'Your draft is safe; try this turn again.';
    const signal = options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(deadlines[task])]) : AbortSignal.timeout(deadlines[task]);
    const streaming=task==='assessment'&&Boolean(options.onText||options.onMetrics);
    const jsonSchema=wireSchema(z.toJSONSchema(schema)) as {properties?:Record<string,unknown>;required?:string[]};
    if(task==='assessment'&&jsonSchema.properties){
      const order=['judgment','sourceIds','nextAction','challenge','visibleText','interpretation','strength','gap','spokenText','correctionAccepted'];
      jsonSchema.properties=Object.fromEntries(order.map(key=>[key,jsonSchema.properties![key]]));jsonSchema.required=order;
    }
    const transportError = (error: unknown) => options.signal?.aborted
      ? new DOMException('The study turn was interrupted.', 'AbortError')
      : isTimeout(error, signal)
      ? new ApiError(504, `StepFun took too long to respond. ${recovery}`, 'PROVIDER_TIMEOUT')
      : new ApiError(502, `Stu could not connect to StepFun. Check the server’s internet connection, VPN, or proxy. ${recovery}`, 'PROVIDER_NETWORK');
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'system', content: `${STUDY_SYSTEM}\n\n${instruction}${task==='assessment'?'\nWrite JSON fields in schema order: judgment, sourceIds, nextAction, challenge, visibleText, then the remaining fields. Keep private evidence fields concise. spokenText must be empty; speech is derived from the displayed reply.':''}` }, { role: 'user', content: JSON.stringify(data) }],
          response_format: { type: 'json_schema', json_schema: { name: `miso_${task}`, strict: true, schema: jsonSchema } },
          max_tokens: task==='concepts'?4096:task==='verification'?1536:3072,
          ...(/^(step-3\.7-flash|step-3\.5-flash-2603|step-5-preview)$/.test(this.model)?{reasoning_effort:process.env.STEPFUN_REASONING_EFFORT||'low'}:{}),
          stream: streaming,
          // No tools are supplied or executed. All note text stays study data.
        }),
        signal,
      });
    } catch (error) { throw transportError(error); }
    if (!response.ok) {
      if (response.status === 429) throw new ApiError(429, `StepFun is busy or its quota was reached. Wait a moment before retrying. ${recovery}`, 'PROVIDER_LIMIT');
      if (response.status === 402) throw new ApiError(402, `StepFun could not authorize API usage. Check your StepFun API balance and spending limits. ${recovery}`, 'PROVIDER_BILLING');
      if (response.status === 404) throw new ApiError(502, `The configured StepFun model or endpoint is unavailable. Check STEPFUN_MODEL and STEPFUN_BASE_URL, then restart the server. ${recovery}`, 'PROVIDER_MODEL_UNAVAILABLE');
      if ([400, 401, 403, 422].includes(response.status)) throw new ApiError(502, `StepFun rejected this study request. Check the server API key and that STEPFUN_MODEL supports JSON Schema output. ${recovery}`, 'PROVIDER_CONFIGURATION');
      if ([408, 504].includes(response.status)) throw new ApiError(504, `StepFun took too long to respond. ${recovery}`, 'PROVIDER_TIMEOUT');
      throw new ApiError(502, `StepFun is temporarily unavailable. ${recovery}`, 'PROVIDER_ERROR');
    }
    let raw: string;
    try {
      if(streaming&&response.body&&response.headers.get('content-type')?.includes('text/event-stream')){
        let content='',finish='',refusal=false,lastText='';
        const allowedIds=new Set(sources.map(source=>source.id));
        for await(const event of sseData(response.body,signal)){
          if(event==='[DONE]')break;
          const chunk=JSON.parse(event);
          if(!chunk || typeof chunk!=='object' || Array.isArray(chunk)) throw new ApiError(502, `Stu received an invalid study stream and did not use it. ${recovery}`, 'INVALID_MODEL_OUTPUT');
          firstChunkMs??=performance.now()-started;
          const choice=chunk.choices?.[0];const delta=choice?.delta;
          if(chunk.error)throw new ApiError(502, `StepFun interrupted this study response. ${recovery}`, 'PROVIDER_ERROR');
          if(chunk.usage){inputTokens=chunk.usage.prompt_tokens;outputTokens=chunk.usage.completion_tokens;}
          if(choice?.finish_reason)finish=choice.finish_reason;
          if(delta?.refusal||delta?.tool_calls?.length)refusal=true;
          // reasoning/reasoning_content are deliberately never passed to the client.
          if(typeof delta?.content==='string'){
            content+=delta.content;if(content.length>100_000)throw new ApiError(502, `Stu received an oversized study response and did not use it. ${recovery}`, 'INVALID_MODEL_OUTPUT');
            const prefix=readReplyPrefix(content);const header=streamHeaderSchema.safeParse(prefix.fields);
            const safe=header.success&&header.data.challenge===null&&header.data.nextAction!=='challenge'
              &&header.data.sourceIds.every(id=>allowedIds.has(id));
            if(safe&&!refusal&&prefix.text&&prefix.text!==lastText){firstReplyMs??=performance.now()-started;lastText=prefix.text;options.onText?.(prefix.text);}
          }
        }
        raw=JSON.stringify({choices:[{finish_reason:finish,message:{content,refusal:refusal?'blocked':null}}]});
      }else{
        raw=await response.text();firstChunkMs=performance.now()-started;
        try{const usage=JSON.parse(raw).usage;inputTokens=usage?.prompt_tokens;outputTokens=usage?.completion_tokens;}catch{ /* full validation below */ }
      }
    }
    catch (error) {
      if(error instanceof ApiError) throw error;
      if(error instanceof SyntaxError) throw new ApiError(502, `Stu received an invalid study stream and did not use it. ${recovery}`, 'INVALID_MODEL_OUTPUT');
      throw transportError(error);
    }
    finally { options.onMetrics?.({task,durationMs:performance.now()-started,firstChunkMs,firstReplyMs,inputTokens,outputTokens,inputCharacters:JSON.stringify(data).length}); }
    try {
      const body = JSON.parse(raw) as { choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null; tool_calls?: unknown[] } }[] };
      const choice = body.choices?.[0];
      if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) throw new ApiError(422, `StepFun could not provide study feedback on this request. Try a different passage or explanation. ${recovery}`, 'PROVIDER_REFUSAL');
      if (choice?.finish_reason !== 'stop' || !choice.message?.content || choice.message.tool_calls?.length) throw new Error('Empty or incomplete model output');
      return schema.parse(JSON.parse(choice.message.content));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, `Stu received an incomplete study response and did not use it. ${recovery}`, 'INVALID_MODEL_OUTPUT');
    }
  }

  concepts(sources: SourceSpan[]) { return this.generate(outlineSchema, CONCEPT_INSTRUCTION, conceptData(sources), 'concepts'); }
  assess(context: AssessmentContext) { return this.generate(assessmentSchema, ASSESSMENT_INSTRUCTION, assessmentData(context), 'assessment',context,context.sources); }
  verify(candidate: ChallengeCandidate, sources: SourceSpan[], options?:ProviderOptions) { return this.generate(verificationSchema, VERIFICATION_INSTRUCTION, verificationData(candidate, sources), 'verification',options); }
}

// Send the structural strict schema. All original length/count bounds are still
// enforced by the complete Zod schema before the controller can use the response.
const localConstraints = new Set(['$schema', 'minLength', 'maxLength', 'minItems', 'maxItems']);
function wireSchema(value: unknown, propertyMap = false): unknown {
  if (Array.isArray(value)) return value.map(item => wireSchema(item));
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = Object.fromEntries(Object.entries(value)
    .filter(([key]) => propertyMap || !localConstraints.has(key))
    .map(([key, child]) => [key, wireSchema(child, !propertyMap && ['properties', '$defs', 'patternProperties'].includes(key))]));
  if (!propertyMap && output.type === 'object') {
    output.additionalProperties = false;
    output.required = Object.keys(output.properties as Record<string, unknown> ?? {});
  }
  return output;
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  let cause = error;
  for (let depth = 0; depth < 4 && cause && typeof cause === 'object'; depth++) {
    if ('name' in cause && cause.name === 'TimeoutError') return true;
    if ('code' in cause && ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(String(cause.code))) return true;
    cause = 'cause' in cause ? cause.cause : undefined;
  }
  return false;
}

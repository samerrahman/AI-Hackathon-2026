import type { AssessmentResult, TurnStreamEvent } from '../../shared/types';
import { sseData } from '../../shared/stream';

export async function chatTurn(body:Record<string,unknown>,signal:AbortSignal,onText:(text:string)=>void):Promise<AssessmentResult>{
  const submitted=performance.now();let firstVisible:number|undefined;
  let payload=body;
  if(body.collectionId){const {documents,...reference}=body;payload=reference;}
  const send=(data:Record<string,unknown>)=>fetch('/api/turn',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({...data,submittedAt:Date.now()}),signal});
  let response=await send(payload);
  if(response.status===410&&body.collectionId){const {collectionId,...full}=body;response=await send(full);}
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'Stu could not finish this turn. Your draft is safe; retry.');}
  if(!response.headers.get('content-type')?.includes('text/event-stream'))return await response.json();
  if(!response.body)throw new Error('The response connection was interrupted. Your draft is safe.');
  let result:AssessmentResult|undefined;
  for await(const data of sseData(response.body,signal)){
    const event=JSON.parse(data) as TurnStreamEvent;
    if(event.sessionId!==body.sessionId||event.turnId!==body.turnId||event.revision!==body.revision||event.conceptId!==(body.concept as {id:string}).id)continue;
    if(event.type==='error')throw new Error(event.error);
    if(event.type==='text'){
      if(typeof event.text!=='string')continue;
      firstVisible??=performance.now()-submitted;onText(event.text);
    }
    if(event.type==='complete'){
      result=event.result;
      // Numeric diagnostics only; no lecture, reply, recording, or credential data.
      window.dispatchEvent(new CustomEvent('stu:turn-timing',{detail:{...result.timings,clientFirstVisibleMs:firstVisible??performance.now()-submitted,clientCompleteMs:performance.now()-submitted}}));
      // Drain the final frame/EOF. Canceling a successful fetch here can discard
      // its response body in browser diagnostics and race server cleanup.
    }
  }
  signal.throwIfAborted();
  if(!result)throw new Error('The response ended before it was checked. Your draft is safe; retry.');
  return result;
}

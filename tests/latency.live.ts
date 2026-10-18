import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import {sseData} from '../shared/stream.js';

test('measure live synthetic text latency',{skip:process.env.STU_LIVE_METRICS!=='1'},async()=>{
 const source={id:'latency-p1-s1',documentId:'latency-doc',pageIndex:0,text:'A catalyst changes the reaction rate without changing the equilibrium constant. It speeds the forward and reverse reactions, so equilibrium is reached sooner but its position is unchanged.',quality:'native'};
 const document={id:source.documentId,name:'Synthetic chemistry',hash:'synthetic-latency-v1',size:200,pageCount:1,kind:'text',spans:[source],warnings:[]};
 const request={sessionId:crypto.randomUUID(),turnId:crypto.randomUUID(),revision:1,documents:[document],mode:'live',concept:{id:'catalysts',title:'Catalysts',description:'Rate versus equilibrium.',question:'I keep mixing up reaction speed and equilibrium. What changes when a catalyst is added?',sourceIds:[source.id],status:'not-discussed'},history:[],text:'A catalyst speeds both the forward and reverse reactions. It reaches equilibrium sooner without changing the equilibrium constant or the equilibrium position.',action:'answer',settings:{challenges:'off'},submittedAt:Date.now()};
 const started=performance.now();let firstVisible:number|undefined,result:any,early=false;
 const response=await fetch('http://127.0.0.1:3001/api/turn',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify(request)});
 assert.equal(response.status,200);assert.ok(response.body);
 const headersMs=performance.now()-started;
 for await(const frame of sseData(response.body)){
   const event=JSON.parse(frame);
   if(event.type==='error')throw new Error(event.error);
   if(event.type==='text'){firstVisible??=performance.now()-started;early=true;}
   if(event.type==='complete')result=event.result;
 }
 assert.ok(result);assert.ok(early,'ordinary response must stream before completion');
 const record={mode:'after-streaming',headersMs:Math.round(headersMs),firstUserVisibleMs:Math.round(firstVisible!),completeMs:Math.round(performance.now()-started),responseCharacters:result.visibleText.length,status:result.status,...result.timings};
 writeFileSync('artifacts/latency-after.json',JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
 // Next turn reuses the indexed collection instead of retransmitting its source text.
 const {documents,...reference}=request;
 const reused=await fetch('http://127.0.0.1:3001/api/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...reference,collectionId:result.collectionId,turnId:crypto.randomUUID(),revision:2,engineState:result.engineState,action:'start'})});
 assert.equal(reused.status,200);
});

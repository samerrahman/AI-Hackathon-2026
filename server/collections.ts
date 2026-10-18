import { randomUUID } from 'node:crypto';
import type { StudyDocument } from '../shared/types.js';
import { ApiError } from './schema.js';

/** Bounded process-local source cache; tokens are scoped to one session, never shared by course. */
export class CollectionCache {
  private entries=new Map<string,{sessionId:string;documents:StudyDocument[];expires:number}>();
  constructor(private ttl=60*60*1000,private limit=30){}
  put(sessionId:string,documents:StudyDocument[]){
    this.remove(sessionId);
    for(const [id,item] of this.entries)if(item.expires<Date.now())this.entries.delete(id);
    while(this.entries.size>=this.limit)this.entries.delete(this.entries.keys().next().value!);
    const id=randomUUID();this.entries.set(id,{sessionId,documents,expires:Date.now()+this.ttl});return id;
  }
  get(id:string,sessionId:string){
    const entry=this.entries.get(id);
    if(!entry||entry.sessionId!==sessionId||entry.expires<Date.now())throw new ApiError(410,'The source cache expired. Reconnect these notes and retry.','COLLECTION_EXPIRED');
    entry.expires=Date.now()+this.ttl;return entry.documents;
  }
  remove(sessionId:string){for(const [id,item] of this.entries)if(item.sessionId===sessionId)this.entries.delete(id);}
}

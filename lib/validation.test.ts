import { describe, expect, it } from 'vitest';
import { clampMeter, isLowEffortTeaching, scoreLabel, tutorReplySchema } from './validation';
import { demoReply } from './demo';
describe('lesson scoring',()=>{
 it('clamps understanding',()=>{expect(clampMeter(96,9)).toBe(100);expect(clampMeter(2,-9)).toBe(0)});
 it('assigns labels',()=>{expect(scoreLabel(90)).toBe('Master Explainer');expect(scoreLabel(74)).toBe('Getting There')});
 it('rejects unsafe response shapes',()=>{expect(tutorReplySchema.safeParse({reply:'hi'}).success).toBe(false)});
 it('flags short and repeated non-answers',()=>{expect(isLowEffortTeaching('no')).toBe(true);expect(isLowEffortTeaching('The plant uses light energy.',['The plant uses light energy.'])).toBe(true);expect(isLowEffortTeaching('Plants use light energy to make their food.')).toBe(false)});
 it('does not reward an irrelevant demo answer',()=>{const reply=demoReply({subject:'Science',topic:'Photosynthesis',gradeBand:'Grades 6–8'},[{id:'1',role:'student',text:'Explain it.'},{id:'2',role:'teacher',text:'lol no'}]);expect(reply.understandingDelta).toBe(0);expect(reply.isOnTopic).toBe(false)});
});

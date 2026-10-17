import { describe, expect, it } from 'vitest';
import { clampMeter, isLowEffortTeaching, scoreLabel, tutorReplySchema } from './validation';
import { demoAssessment, demoReply } from './demo';
describe('lesson scoring',()=>{
 it('clamps understanding',()=>{expect(clampMeter(96,9)).toBe(100);expect(clampMeter(2,-9)).toBe(0)});
 it('assigns labels',()=>{expect(scoreLabel(90)).toBe('Master Explainer');expect(scoreLabel(74)).toBe('Getting There')});
 it('rejects unsafe response shapes',()=>{expect(tutorReplySchema.safeParse({reply:'hi'}).success).toBe(false)});
 it('flags short and repeated non-answers',()=>{expect(isLowEffortTeaching('no')).toBe(true);expect(isLowEffortTeaching('The plant uses light energy.',['The plant uses light energy.'])).toBe(true);expect(isLowEffortTeaching('Plants use light energy to make their food.')).toBe(false)});
 it('does not reward an irrelevant demo answer',()=>{const reply=demoReply({subject:'Science',topic:'Photosynthesis',gradeBand:'Grades 6–8'},[{id:'1',role:'student',text:'Explain it.'},{id:'2',role:'teacher',text:'lol no'}]);expect(reply.understandingDelta).toBe(0);expect(reply.isOnTopic).toBe(false)});
 it('mirrors a substantive teacher answer in the follow-up',()=>{const reply=demoReply({subject:'Computer Science',topic:'Recursion',gradeBand:'Grades 6–8'},[{id:'1',role:'student',text:'Explain it.'},{id:'2',role:'teacher',text:'It is when functions call themselves until a stopping condition is reached.'}]);expect(reply.reply).toContain('You mentioned');expect(reply.reply).toContain('functions call themselves');expect(reply.reply).toMatch(/what does/i)});
 it('recognizes a contextual follow-up without repeating the topic name',()=>{const reply=demoReply({subject:'Computer Science',topic:'Recursion',gradeBand:'Grades 6–8'},[{id:'1',role:'teacher',text:'Functions call themselves until a stopping condition.'},{id:'2',role:'student',text:'Why is that needed?'},{id:'3',role:'teacher',text:'The stopping condition prevents the function from calling itself forever.'}]);expect(reply.isOnTopic).toBe(true);expect(reply.reply).toContain('stopping condition')});
 it('gives non-answers a zero final score and no evidence',()=>{const report=demoAssessment({subject:'Science',topic:'Photosynthesis',gradeBand:'Grades 6–8'},[{id:'1',role:'teacher',text:'nope'},{id:'2',role:'teacher',text:'i dunnnnooo'},{id:'3',role:'teacher',text:'nop'}],0);expect(report.score).toBe(0);expect(report.strengths).toEqual([]);expect(report.evidence).toEqual([]);expect(report.followUpAbility).toContain('No substantive')});
});

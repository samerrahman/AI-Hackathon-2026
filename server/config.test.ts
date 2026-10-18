import test from 'node:test';
import assert from 'node:assert/strict';
import { studyConfiguration } from './config.js';
import { voiceConfiguration } from './voice.js';

test('one StepFun key configures study and speech without exposing it or requiring other providers',()=>{
 const env={STEPFUN_API_KEY:'private-test-credential'};
 const study=studyConfiguration(env),voice=voiceConfiguration(env);
 assert.deepEqual(study,{provider:'StepFun',providerKey:'STEPFUN_API_KEY',liveAvailable:true});
 assert.deepEqual(voice,{provider:'StepFun',keyName:'STEPFUN_API_KEY',available:true});
 assert.ok(!JSON.stringify({study,voice}).includes(env.STEPFUN_API_KEY));
 assert.equal(studyConfiguration({OPENAI_API_KEY:'unused',GEMINI_API_KEY:'unused',GROQ_API_KEY:'unused'}).liveAvailable,false);
 assert.deepEqual(voiceConfiguration({...env,VOICE_PROVIDER:'off'}),{provider:'Off',keyName:null,available:false});
 assert.throws(()=>studyConfiguration({STUDY_PROVIDER:'gemini'}));
});

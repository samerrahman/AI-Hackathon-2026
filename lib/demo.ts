import type { Assessment, LessonConfig, Message, TutorReply } from './types';
import { isLowEffortTeaching, scoreLabel } from './validation';

const moves = [
  ['Definition detective', 'What does the most important word in that explanation mean?', 'Try defining the key word in everyday language.'],
  ['Example builder', 'Can you give me a real-world example so I can picture that?', 'Try: “One example is…”'],
  ['Why chain', 'Why does that happen? Walk me through the cause and effect.', 'Try connecting it with “because.”'],
  ['Connection check', 'How is that connected to what you said earlier?', 'Try: “This connects because…”'],
  ['New angle', 'Can you explain that in a different way—maybe with an analogy?', 'Compare it to something familiar.'],
  ['What-if test', 'What would happen if one important part were missing?', 'Try predicting what would change.'],
];

export function demoReply(config: LessonConfig, messages: Message[]): TutorReply {
  const turns = messages.filter((m) => m.role === 'teacher').length;
  const latest = messages.filter((m) => m.role === 'teacher').at(-1)?.text ?? '';
  const previous = messages.filter((m) => m.role === 'teacher').slice(0,-1).map((m)=>m.text);
  const lowEffort = isLowEffortTeaching(latest, previous);
  const topicWords = config.topic.toLowerCase().split(/[^a-z0-9]+/).filter((word)=>word.length>3);
  const teachingWords = /\b(because|means|example|works|happens|causes|uses|step|first|then|therefore|process|when|which|where|energy|result)\b/i.test(latest);
  const contextWords = new Set(previous.join(' ').toLowerCase().match(/[a-z][a-z-]{4,}/g) || []);
  const continuesPriorIdea = (latest.toLowerCase().match(/[a-z][a-z-]{4,}/g) || []).some((word)=>contextWords.has(word));
  const onTopic = !lowEffort && (topicWords.some((word)=>latest.toLowerCase().includes(word)) || teachingWords || continuesPriorIdea);
  const substantial = onTopic && latest.trim().split(/\s+/).length >= 8;
  const cleanLatest = latest.trim().replace(/\s+/g,' ').replace(/[.!?]+$/,'');
  const reflected = cleanLatest.length>82?`${cleanLatest.slice(0,79)}…`:cleanLatest;
  const stopWords = new Set(['about','after','again','because','before','being','could','does','from','have','into','just','means','most','really','that','their','there','these','they','this','those','through','very','what','when','where','which','while','with','would','your']);
  const keyWord = cleanLatest.toLowerCase().match(/[a-z][a-z-]{4,}/g)?.filter((word)=>!stopWords.has(word)).sort((a,b)=>b.length-a.length)[0] || config.topic;
  if (!onTopic) return { reply:`I’m not learning about ${config.topic} from that answer yet. Could you explain one idea about it in a full sentence?`, teachingMove:'Refocus', understandingDelta:0, isOnTopic:false, feedbackReason:'No progress yet—the response did not explain the lesson topic.', conceptsDemonstrated:[], possibleMisconceptions:[], intentionalMistake:false, suggestedPrompts:[`One important idea about ${config.topic} is…`,'Let me answer the question directly…'], shouldOfferCompletion:false };
  if (turns === 3) return { reply: `You mentioned “${reflected}.” Let me check if I understood: ${config.topic} means everything happens all at once with no steps. Is that right, or did I mix something up?`, teachingMove:'Mistake spotter', understandingDelta:substantial?9:5, isOnTopic:true, feedbackReason:'Progress earned for an on-topic explanation.', conceptsDemonstrated:substantial?['Gave a detailed explanation']:[], possibleMisconceptions:[], intentionalMistake:true, suggestedPrompts:['That’s not quite right because…','The steps actually go…'], shouldOfferCompletion:false };
  const move = moves[(Math.max(1, turns)-1) % moves.length];
  const mirroredQuestion = turns===1 ? `You mentioned “${reflected}.” That’s interesting—but what does “${keyWord}” mean here?` : `You mentioned “${reflected}.” ${move[1]}`;
  return { reply:mirroredQuestion, teachingMove:move[0], understandingDelta:substantial?9:5, isOnTopic:true, feedbackReason:'Progress earned for an on-topic explanation.', conceptsDemonstrated:substantial?['Explained an idea with supporting detail']:[], possibleMisconceptions:latest.length<20?['Explanation may need more detail']:[], intentionalMistake:false, suggestedPrompts:[move[2], 'Let me explain that another way…'], shouldOfferCompletion:turns >= 5 };
}

export function demoAssessment(config: LessonConfig, messages: Message[], xp: number): Assessment {
  const allTeacher = messages.filter((m) => m.role === 'teacher');
  const teacher: Message[] = [];
  for (const message of allTeacher) {
    if (!isLowEffortTeaching(message.text, teacher.map((item)=>item.text))) teacher.push(message);
  }
  const words = teacher.reduce((sum,m)=>sum+m.text.trim().split(/\s+/).length,0);
  const score = teacher.length===0 ? 0 : Math.min(92, 12 + teacher.length*10 + Math.min(30, Math.floor(words/6)));
  const quoted = teacher.slice(0,2).map(m => `You explained: “${m.text.slice(0,90)}${m.text.length>90?'…':''}”`);
  return { score, label:scoreLabel(score), strengths:teacher.length?['Gave at least one substantive explanation']:[], growthAreas:teacher.length?['Add one more concrete example','Name the key steps in order']:[`Explain one accurate idea about ${config.topic} in a complete sentence`], misconceptions:[], exampleQuality:words>45?'You used helpful detail; a vivid everyday analogy would make it even stronger.':'No usable example was demonstrated yet.', followUpAbility:teacher.length>1?`You gave ${teacher.length-1} substantive follow-up answer${teacher.length===2?'':'s'}.`:'No substantive follow-up answer was demonstrated yet.', recommendation:`Draw a one-page map of ${config.topic}, then teach it again without notes.`, reviewQuestions:[`What is ${config.topic} in one sentence?`,`What is one example of ${config.topic}?`,`What common mix-up about ${config.topic} would you correct?`], xp, badge:score>=75?'Clarity Champion':null, evidence:quoted };
}

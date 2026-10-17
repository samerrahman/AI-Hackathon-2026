'use client';

import { useEffect, useState } from 'react';
import { publicEvaluationSchema, sessionSchema, type Difficulty, type PublicEvaluation, type TeachingSession } from '@/lib/models';
import { topicCards } from '@/lib/public-topics';
import { appendTurn, buildReport, shouldEnd } from '@/lib/session';

const STORAGE_KEY = 'dumbai-session-v1';

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Something went wrong.');
  return json as T;
}

function Pupil({ progress = 0, small = false }: { progress?: number; small?: boolean }) {
  return <div className={`pupil ${small ? 'pupil-small' : ''} ${progress > 0.6 ? 'pupil-bright' : ''}`} aria-label={`DumbAI pupil, ${progress > 0.6 ? 'curious and understanding' : 'still learning'}`} role="img">
    <div className="pupil-rays" aria-hidden="true">✧</div><div className="pupil-face"><span className="pupil-eye"/><span className="pupil-eye"/><span className="pupil-mouth">{progress > 0.6 ? '⌣' : '﹏'}</span></div>
  </div>;
}

function ConceptMap({ session, initial = false }: { session: TeachingSession; initial?: boolean }) {
  const concepts = session.topic.rubric.concepts;
  const covered = concepts.filter((c) => session.statuses[c.id] === 'covered').length;
  return <div className="map-wrap">
    <div className="map-heading"><div><span className="eyebrow">UNDERSTANDING MAP</span><h3>Ideas taking shape</h3>{session.topic.rubric.source !== 'curated' && <span className="rubric-source">{session.topic.rubric.source}{session.mode === 'demo' && session.topic.rubric.source === 'AI-generated rubric' ? ' · demo template' : ''}</span>}</div><span className="map-count">{initial ? '0' : covered}/{concepts.length} clear</span></div>
    <div className="concept-grid">{concepts.map((concept, index) => {
      const status = initial ? 'missing' : session.statuses[concept.id];
      return <div className={`concept-node status-${status}`} key={concept.id} style={{ animationDelay: `${index * 65}ms` }}>
        <span className="concept-icon" aria-hidden="true">{status === 'covered' ? '✦' : status === 'partial' ? '◐' : '○'}</span>
        <span>{concept.title}</span><small>{status === 'covered' ? 'Clear' : status === 'partial' ? 'Emerging' : 'To explore'}</small>
      </div>;
    })}</div>
    <div className="map-legend"><span><b className="dot covered"/>Clear</span><span><b className="dot partial"/>Emerging</span><span><b className="dot missing"/>To explore</span></div>
  </div>;
}

function Progress({ session }: { session: TeachingSession }) {
  return <div className="progress-track" aria-label={`${session.turns.length} of 6 teaching turns complete`} role="progressbar" aria-valuenow={session.turns.length} aria-valuemin={0} aria-valuemax={6}>
    {Array.from({ length: 6 }, (_, i) => <span key={i} className={i < session.turns.length ? 'filled' : ''} />)}
  </div>;
}

function Setup({ onStart, busy, error }: { onStart: (id: string, title: string, notes: string, difficulty: Difficulty) => void; busy: boolean; error: string }) {
  const [selected, setSelected] = useState('gradient-descent');
  const [customTitle, setCustomTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('introductory');
  const selectedTopic = topicCards.find((t) => t.id === selected);
  return <main className="setup-main">
    <section className="hero"><div className="hero-copy"><div className="hero-kicker"><span className="kicker-star">✳</span> A DIFFERENT WAY TO LEARN</div><h1>Meet the pupil who <em>needs you</em> to explain.</h1><p>Teach DumbAI a topic. Its curious questions reveal what you really understand—and what you&apos;re still figuring out.</p><div className="hero-note"><span>✎</span> If you can teach it, you understand it.</div></div><div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><span className="orbit-spark spark-one">✦</span><span className="orbit-spark spark-two">✧</span><Pupil/><div className="speech-mini">Wait... how does that work?</div></div></section>
    <section className="setup-panel"><div className="section-intro"><div><span className="eyebrow">01 / CHOOSE YOUR LESSON</span><h2>What will you teach today?</h2></div><p>Pick a ready-to-go topic or bring your own.</p></div>
      <div className="topic-cards">{topicCards.map((topic) => <button key={topic.id} type="button" className={`topic-card ${selected === topic.id ? 'selected' : ''}`} onClick={() => setSelected(topic.id)} aria-pressed={selected === topic.id}><span className="topic-icon">{topic.icon}</span><span className="topic-card-text"><strong>{topic.title}</strong><small>{topic.subtitle}</small></span><span className="topic-check">{selected === topic.id ? '✓' : '○'}</span></button>)}</div>
      <div className="custom-block"><label className="input-label" htmlFor="custom-topic">Or create your own topic</label><input id="custom-topic" value={customTitle} onChange={(e) => { setCustomTitle(e.target.value); if (e.target.value) setSelected('custom'); }} onFocus={() => setSelected('custom')} placeholder="e.g. The water cycle" maxLength={100}/><label className="input-label notes-label" htmlFor="reference-notes">Reference notes <span>optional</span></label><textarea id="reference-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Paste a few key ideas you want DumbAI to listen for..." rows={3} maxLength={12000}/><p className="field-help">Without notes, we&apos;ll create an AI-generated rubric for your topic.</p></div>
      <div className="setup-footer"><div><span className="input-label">Choose a level</span><div className="segmented" role="group" aria-label="Difficulty">{(['introductory', 'intermediate', 'advanced'] as Difficulty[]).map((level) => <button type="button" key={level} className={difficulty === level ? 'active' : ''} onClick={() => setDifficulty(level)} aria-pressed={difficulty === level}>{level}</button>)}</div></div><button type="button" className="primary-button start-button" disabled={busy || (selected === 'custom' && !customTitle.trim())} onClick={() => onStart(selected, customTitle, notes, difficulty)}>{busy ? 'Preparing your lesson…' : `Start teaching ${selectedTopic ? '↗' : '→'}`}</button></div>
      {error && <p className="error" role="alert">{error}</p>}
    </section><div className="home-footnote">Made for the moment an idea finally clicks. <span>✳</span></div>
  </main>;
}

function Teaching({ session, onSubmit, onControl, busy, error, onFinish }: { session: TeachingSession; onSubmit: (text: string) => void; onControl: (signal: 'too_easy' | 'simpler' | 'hint') => void; busy: boolean; error: string; onFinish: () => void }) {
  const [draft, setDraft] = useState('');
  const covered = Object.values(session.statuses).filter((s) => s === 'covered').length;
  const progress = covered / session.topic.rubric.concepts.length;
  return <main className="lesson-main"><div className="lesson-top"><div><span className="eyebrow">YOUR TEACHING SESSION</span><h1>Teach me <em>{session.topic.title}.</em></h1><p>Put it in your own words. I&apos;ll stop when I need a little more clarity.</p></div><div className="lesson-count"><strong>{session.turns.length}<span>/6</span></strong><small>teaching turns</small></div></div>
    <div className="lesson-layout"><div className="lesson-primary"><div className="pupil-card"><Pupil progress={progress} small/><div className="pupil-words"><span className="eyebrow">DUMBAI IS WONDERING</span><p>{session.currentQuestion}</p></div><span className="pupil-state">{progress > 0.6 ? 'Getting it!' : progress > 0 ? 'Thinking...' : 'Curious'}</span></div>
      {session.hint && <div className="hint-card" role="status"><strong>✧ A little nudge</strong><p>{session.hint}</p></div>}
      <div className="explanation-card"><label htmlFor="explanation">Your explanation</label><textarea id="explanation" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Start with what you know. A rough explanation is a great beginning..." rows={7} maxLength={6000} disabled={busy}/><div className="editor-footer"><span>{draft.length}/6000 characters</span><button className="primary-button" type="button" disabled={busy || !draft.trim()} onClick={() => { onSubmit(draft); setDraft(''); }}>{busy ? 'Thinking…' : 'Send explanation →'}</button></div></div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="lesson-actions"><button type="button" disabled={busy} onClick={() => onControl('too_easy')}>↪ That question is too easy</button><button type="button" disabled={busy} onClick={() => onControl('simpler')}>↓ Make it simpler</button><button type="button" disabled={busy} onClick={() => onControl('hint')}>✧ Give me a small hint</button><button type="button" disabled={busy} onClick={onFinish}>Finish session ↗</button></div>
      {session.turns.length > 0 && <section className="history"><div className="history-header"><span className="eyebrow">YOUR TEACHING TRAIL</span><h2>How the idea grew</h2></div>{session.turns.map((turn, i) => <div className="history-turn" key={turn.id}><div className="history-number">{String(i + 1).padStart(2, '0')}</div><div><p className="history-question">{turn.question}</p><p className="history-answer">{turn.explanation}</p></div></div>)}</section>}
    </div><aside className="lesson-aside"><div className="aside-sticky"><div className="progress-card"><div className="progress-head"><span className="eyebrow">YOUR PROGRESS</span><span>{Math.round(progress * 100)}% clear</span></div><Progress session={session}/><p>Each explanation lights up what you&apos;ve made clear.</p></div><ConceptMap session={session}/><div className="aside-note"><span>✳</span><p>The map is a guide, not a grade. Keep teaching in your own way.</p></div></div></aside></div>
  </main>;
}

function Report({ session, onNew }: { session: TeachingSession; onNew: () => void }) {
  const report = session.report ?? buildReport(session);
  const first = session.turns[0]?.evaluation;
  const initialStatuses = Object.fromEntries(session.topic.rubric.concepts.map((c) => [c.id, first?.coveredConceptIds.includes(c.id) ? 'covered' : first?.partialConceptIds.includes(c.id) ? 'partial' : 'missing'])) as TeachingSession['statuses'];
  const firstClear = Object.values(initialStatuses).filter((s) => s === 'covered').length;
  const lastClear = Object.values(session.statuses).filter((s) => s === 'covered').length;
  const scoreLabels: Record<string, string> = { correctness: 'Correctness', completeness: 'Completeness', clarity: 'Clarity', examples: 'Examples', connections: 'Connections' };
  return <main className="report-main"><div className="report-hero"><div><span className="eyebrow">YOUR LEARNING REPORT</span><h1>Look how far your <em>thinking traveled.</em></h1><p>{report.finalUnderstanding}</p><div className="report-badge">✦ AI-generated learning feedback · not an academic grade</div></div><div className="report-medal"><span>✳</span><strong>{session.turns.length}</strong><small>teaching turns</small></div></div>
    <div className="comparison"><div className="comparison-card before"><span className="eyebrow">AT THE START</span><strong>{firstClear} clear ideas</strong><p>“{report.initialExplanation}”</p></div><div className="comparison-arrow">→</div><div className="comparison-card after"><span className="eyebrow">NOW</span><strong>{lastClear} clear ideas</strong><p>{report.improvement}</p></div></div>
    <div className="report-layout"><div><ConceptMap session={session}/><section className="report-section"><span className="eyebrow">WHAT YOU SHOWED</span><h2>Your understanding, in detail</h2><div className="report-columns"><div><h3>✦ Clearly demonstrated</h3><ul>{(report.demonstrated.length ? report.demonstrated : ['Still forming—keep teaching!']).map((x) => <li key={x}>{x}</li>)}</ul></div><div><h3>◐ Coming into focus</h3><ul>{(report.partial.length ? report.partial : ['No partial ideas yet']).map((x) => <li key={x}>{x}</li>)}</ul></div><div><h3>○ Worth revisiting</h3><ul>{(report.gaps.length ? report.gaps : ['You covered every core idea']).map((x) => <li key={x}>{x}</li>)}</ul></div></div></section></div>
    <aside className="report-side"><div className="score-card"><span className="eyebrow">LEARNING SIGNALS</span><h2>Five ways to look at it</h2>{Object.entries(report.scores).map(([key, value]) => <div className="score-row" key={key}><div><span>{scoreLabels[key]}</span><strong>{value}</strong></div><div className="score-bar"><span style={{ width: `${value}%` }}/></div></div>)}<small>AI-generated estimates to guide reflection, not grades.</small></div><div className="next-card"><span className="eyebrow">A GOOD NEXT STEP</span><h3>Review: {report.nextReviewTopic}</h3><p>Try explaining this idea with a new example.</p></div></aside></div>
    <div className="report-bottom"><div><h2>What worked well</h2><ul>{(report.strengths.length ? report.strengths : ['You gave yourself space to work through the idea.']).map((s) => <li key={s}>{s}</li>)}</ul></div><div><h2>Possible misconceptions</h2><ul>{(report.misconceptions.length ? report.misconceptions : ['None flagged in this session.']).map((s) => <li key={s}>{s}</li>)}</ul></div></div><button type="button" className="primary-button new-button" onClick={onNew}>Teach something else →</button>
  </main>;
}

export default function DumbAIApp() {
  const [session, setSession] = useState<TeachingSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const frame = requestAnimationFrame(() => { try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) setSession(sessionSchema.parse(JSON.parse(saved))); } catch { localStorage.removeItem(STORAGE_KEY); } setHydrated(true); }); return () => cancelAnimationFrame(frame); }, []);
  useEffect(() => { if (hydrated) { if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); else localStorage.removeItem(STORAGE_KEY); } }, [session, hydrated]);
  const start = async (topicId: string, customTitle: string, referenceNotes: string, difficulty: Difficulty) => { setBusy(true); setError(''); try { const result = await post<{ session: TeachingSession }>('/api/start', { topicId, customTitle, referenceNotes, difficulty }); setSession(sessionSchema.parse(result.session)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not start.'); } finally { setBusy(false); } };
  const submit = async (explanation: string) => { if (!session) return; setBusy(true); setError(''); try { const result = await post<{ evaluation: PublicEvaluation }>('/api/evaluate', { session, explanation, signal: 'explain' }); const evaluation = publicEvaluationSchema.parse(result.evaluation); const next = appendTurn(session, explanation, evaluation); setSession(shouldEnd(next, evaluation) ? { ...next, phase: 'report', report: buildReport(next) } : next); } catch (e) { setError(e instanceof Error ? e.message : 'Could not evaluate.'); } finally { setBusy(false); } };
  const control = async (signal: 'too_easy' | 'simpler' | 'hint') => { if (!session) return; setBusy(true); setError(''); try { const result = await post<{ evaluation: PublicEvaluation }>('/api/evaluate', { session, explanation: session.turns.at(-1)?.explanation ?? '', signal }); const evaluation = publicEvaluationSchema.parse(result.evaluation); setSession({ ...session, currentQuestion: signal === 'hint' ? session.currentQuestion : evaluation.nextQuestion, hint: signal === 'hint' ? evaluation.suggestedHint ?? 'Try a concrete example.' : undefined }); } catch (e) { setError(e instanceof Error ? e.message : 'Could not adjust the question.'); } finally { setBusy(false); } };
  const finish = () => { if (session) setSession({ ...session, phase: 'report', report: buildReport(session) }); };
  if (!hydrated) return <div className="loading-screen">Preparing your lesson…</div>;
  return <div className="app-shell"><header className="site-header"><button className="wordmark" type="button" onClick={() => { setSession(null); setError(''); }} aria-label="DumbAI home"><span className="wordmark-symbol">✳</span> DumbAI<span className="wordmark-dot">.</span></button><div className="header-right"><span className="header-tagline">If you can teach it, you understand it.</span>{session?.mode === 'demo' && <span className="demo-badge">● Demo mode</span>}</div></header>{!session ? <Setup onStart={start} busy={busy} error={error}/> : session.phase === 'teaching' ? <Teaching session={session} onSubmit={submit} onControl={control} busy={busy} error={error} onFinish={finish}/> : <Report session={session} onNew={() => setSession(null)}/>}</div>;
}

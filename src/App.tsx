import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, BookOpen, Check, ChevronRight, FileText, HelpCircle, Keyboard, Lightbulb, LoaderCircle, Menu, MessageCircle, Mic, Pause, Pencil, Plus, Send, Settings2, ShieldCheck, Sparkles, Square, Trash2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import type { AppConfig, SelectionContext, StudyDocument } from '../shared/types';
import { ingestPdf, ingestText } from './lib/documents';
import { saveSession, loadSession, deleteSession } from './lib/storage';
import { TurnGate } from './lib/turnGate';
import { DocumentViewer } from './components/DocumentViewer';
import { Miso } from './components/Miso';
import { RichText } from './components/RichText';
import { CurrentPrompt } from './components/CurrentPrompt';
import { useVoice } from './hooks/useVoice';

type Depth = 'big-picture' | 'exam-ready' | 'expert';
type Mode = 'teach' | 'relearn';
type Screen = 'welcome' | 'study' | 'recap';
type Progress = { total: number; credited: number; percent: number; mode: Mode };
type DebugEvidence = { credits: { itemId: string; quote: string }[]; revocations: { itemId: string; quote: string }[];
  problems: { type: string; description: string }[]; focus: { type: string; anchorQuote: string; instruction: string };
  mistakeAccepted: boolean; models: { judge: string; stu: string }; durationMs: { judge: number; stu: number } };
type Message = { id: string; role: 'user' | 'assistant'; text: string; sourceIds?: string[]; debug?: DebugEvidence };
type TopicResponse = { topicId: string; stateToken: string; progress: Progress; message?: Message; transition?: boolean; liveStep5: boolean; debug?: DebugEvidence };
type SavedSession = { id: string; name: string; depth: Depth; mode: 'live' | 'demo'; sampleId?: 'analysis' | 'research';
  documents: StudyDocument[]; stateToken: string; history: Message[]; progress: Progress; liveStep5: boolean;
  documentId: string; pageIndex: number; draft: string; audioOutput: boolean; status: 'active' | 'paused' | 'completed'; updatedAt: number };
type FileRow = { id: string; file?: File; title: string; text?: string; size: number; state: string };
const uid = () => crypto.randomUUID();
const depthNames: Record<Depth, string> = { 'big-picture': 'Big picture', 'exam-ready': 'Exam ready', expert: 'Expert' };
const fallbackConfig: AppConfig = { liveAvailable: false, voiceAvailable: false, provider: 'Step 5 Preview', limits: { maxFiles: 5, maxFileBytes: 20 * 1024 * 1024, maxPages: 100, maxTextCharacters: 300000 } };
const plainDocs = (docs: StudyDocument[]) => docs.map(({ blob, ...doc }) => doc);
async function api<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(170000);
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const data = await response.json().catch(() => ({ error: 'The connection was interrupted. Your words are still here.' }));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Stu could not finish this request. Please retry.');
  return data as T;
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="modal" onCancel={onClose} onClick={event => { if (event.target === ref.current) onClose(); }}>
    <div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>{children}
  </dialog>;
}
function JudgePanel({ debug }: { debug: DebugEvidence }) {
  return <details className="judge-evidence"><summary>Judge evidence</summary>
    {debug.credits.map((credit, index) => <p key={`credit-${index}`}><strong>Credited {credit.itemId}</strong> · “{credit.quote}”</p>)}
    {debug.revocations.map((revoke, index) => <p key={`revoke-${index}`}><strong>Revoked {revoke.itemId}</strong> · “{revoke.quote}”</p>)}
    {debug.problems.map((problem, index) => <p key={`problem-${index}`}><strong>{problem.type}</strong> · {problem.description}</p>)}
    <p>Focus: {debug.focus.instruction} · “{debug.focus.anchorQuote}”</p>
    <p>Proposed mistake: {debug.mistakeAccepted ? 'accepted' : 'rejected or absent'}</p>
    <small>Judge {debug.models.judge} · {debug.durationMs.judge} ms / Stu {debug.models.stu} · {debug.durationMs.stu} ms</small>
  </details>;
}
export default function App() {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [session, setSession] = useState<SavedSession | null>(null);
  const [saved, setSaved] = useState<SavedSession | null>(null);
  const [config, setConfig] = useState<AppConfig>(fallbackConfig);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [title, setTitle] = useState('');
  const [depth, setDepth] = useState<Depth>('big-picture');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState('');
  const [modal, setModal] = useState<'sample' | 'paste' | 'settings' | 'how' | 'delete' | null>(null);
  const [paste, setPaste] = useState('');
  const [pasteTitle, setPasteTitle] = useState('My lecture notes');
  const [tab, setTab] = useState<'notes' | 'conversation'>('conversation');
  const [sidebar, setSidebar] = useState(() => window.innerWidth >= 1190);
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showJudgeEvidence, setShowJudgeEvidence] = useState(false);
  const [saveState, setSaveState] = useState('Saved on this device');
  const gate = useRef(new TurnGate());
  const sessionRef = useRef(session); sessionRef.current = session;
  const saveQueue = useRef(Promise.resolve());
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const voice = useVoice({ enabled: config.voiceAvailable, onTranscript: text => { patch({ draft: [sessionRef.current?.draft, text].filter(Boolean).join(' ') }); editor.current?.focus(); }, onError: setError });
  useEffect(() => {
    fetch('/api/config').then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(setConfig).catch(() => setError('The study server is unavailable. Start npm run dev, then reload.'));
    loadSession<SavedSession>().then(value => { if (value?.stateToken && value?.progress) setSaved(value); }).catch(() => setError('Local storage is unavailable. This session may not survive a refresh.'));
  }, []);
  useEffect(() => { const breakpoint = window.matchMedia('(min-width: 1191px)'); const changed = () => setSidebar(breakpoint.matches); breakpoint.addEventListener('change', changed); return () => breakpoint.removeEventListener('change', changed); }, []);
  useEffect(() => { if (!session) return; setSaveState('Saving…'); saveQueue.current = saveQueue.current.then(() => saveSession(session)).then(() => { setSaved(session); setSaveState('Saved on this device'); }).catch(() => setSaveState('Could not save — keep this tab open')); }, [session]);
  function patch(update: Partial<SavedSession>) { setSession(current => current ? { ...current, ...update, updatedAt: Date.now() } : current); }
  function interrupt() { gate.current.cancel(); setBusy(false); voice.cancelRecording(); voice.stopPlayback(); }
  function navigate(documentId: string, pageIndex: number) { interrupt(); patch({ documentId, pageIndex }); setSelection(null); setHighlights([]); }
  function showSources(ids: string[]) {
    const current = sessionRef.current; if (!current) return;
    const span = current.documents.flatMap(document => document.spans).find(item => ids.includes(item.id));
    if (span) { interrupt(); patch({ documentId: span.documentId, pageIndex: span.pageIndex }); setHighlights(ids); setTab('notes'); setSidebar(false); if (screen === 'recap') setScreen('study'); }
  }
  function sourceLabel(ids: string[]) {
    const current = sessionRef.current ?? saved;
    const span = current?.documents.flatMap(document => document.spans).find(item => ids.includes(item.id));
    if (!span) return 'Source';
    const document = current?.documents.find(item => item.id === span.documentId);
    return `${document?.name.replace(/\.pdf$/i, '') ?? 'Notes'} · ${document?.kind === 'text' ? 'section' : 'p.'} ${span.pageIndex + 1}`;
  }
  const citations = (ids: string[]) => <div className="citations">{[...new Set(ids)].slice(0, 3).map(id => <button key={id} onClick={() => showSources([id])}><BookOpen size={13} />{sourceLabel([id])}<ChevronRight size={12} /></button>)}</div>;
  function addFiles(files: File[]) {
    setError(''); const available = config.limits.maxFiles - rows.length;
    const valid = files.filter(file => { if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Choose a text-based PDF, or use Paste notes.'); return false; } if (file.size > config.limits.maxFileBytes) { setError(`${file.name} exceeds the file limit.`); return false; } return true; });
    if (valid.length > available) setError(`You can add up to ${config.limits.maxFiles} documents.`);
    setRows(current => [...current, ...valid.slice(0, Math.max(0, available)).map(file => ({ id: uid(), file, title: file.name, size: file.size, state: 'Ready to read' }))]);
  }
  async function prepare(sampleId?: 'analysis' | 'research') {
    if (!sampleId && !title.trim()) { setError('Give your topic a title first.'); return; }
    if (!sampleId && !rows.length) { setError('Paste notes or upload a text-based PDF first.'); return; }
    interrupt(); const ticket = gate.current.begin(); setError(''); setBusy(true); setModal(null);
    const docs: StudyDocument[] = []; const errors: string[] = [];
    try {
      let work = rows;
      if (sampleId) { const name = sampleId === 'analysis' ? 'Sequences_and_Convergence.pdf' : 'Experiments_and_Causal_Claims.pdf'; setProcessing('Opening sample notes…'); const response = await fetch(`/examples/${name}`, { signal: ticket.signal }); if (!response.ok) throw new Error('The sample file could not be opened.'); const file = new File([await response.blob()], name, { type: 'application/pdf' }); work = [{ id: uid(), file, title: name, size: file.size, state: 'Reading pages' }]; }
      for (const row of work) {
        if (!gate.current.current(ticket.revision)) return;
        const report = (message: string) => { if (gate.current.current(ticket.revision)) { setProcessing(message); setRows(current => current.map(item => item.id === row.id ? { ...item, state: message } : item)); } };
        try { report(`Reading ${row.title}…`); const document = row.file ? await ingestPdf(row.file, report, ticket.signal) : await ingestText(row.text ?? '', row.title, ticket.signal); if (!docs.some(existing => existing.id === document.id)) docs.push(document); report(`${document.pageCount} pages read`); }
        catch (cause) { errors.push(`${row.title}: ${cause instanceof Error ? cause.message : 'Could not read this file.'}`); report('Could not read this file'); }
      }
      if (!docs.length) throw new Error(errors.join(' ') || 'Add readable notes first.');
      setProcessing('Building a private study plan…');
      const name = sampleId === 'analysis' ? 'Sequences & convergence' : sampleId === 'research' ? 'Experiments & causal claims' : title.trim();
      const result = await api<TopicResponse>('/api/topic', { title: name, depth, documents: plainDocs(docs), mode: sampleId ? 'demo' : 'live', sampleId }, ticket.signal);
      if (!gate.current.current(ticket.revision)) return;
      const next: SavedSession = { id: result.topicId, name, depth, mode: sampleId ? 'demo' : 'live', sampleId, documents: docs,
        stateToken: result.stateToken, history: result.message ? [result.message] : [], progress: result.progress, liveStep5: false,
        documentId: docs[0].id, pageIndex: 0, draft: '', audioOutput: false, status: 'active', updatedAt: Date.now() };
      setSession(next); sessionRef.current = next; setScreen('study'); setTab('conversation'); setSidebar(window.innerWidth >= 1190); setRows([]); setHighlights([]); setSelection(null); setError(errors.join('\n'));
    } catch (cause) { if (gate.current.current(ticket.revision)) setError(cause instanceof Error ? cause.message : 'Could not prepare this topic.'); }
    finally { if (gate.current.current(ticket.revision)) { setBusy(false); setProcessing(''); } }
  }
  async function teach() {
    const current = sessionRef.current; if (!current?.draft.trim()) return;
    voice.cancelRecording(); voice.stopPlayback(); const ticket = gate.current.begin(); const turnId = uid(); const messageId = uid(); setBusy(true); setError('');
    try {
      const result = await api<TopicResponse>('/api/teach', { topicId: current.id, stateToken: current.stateToken, documents: plainDocs(current.documents), turnId, messageId, revision: ticket.revision, text: current.draft.trim() }, ticket.signal);
      if (!gate.current.current(ticket.revision) || sessionRef.current?.id !== current.id || result.topicId !== current.id) return;
      const teacher: Message = { id: messageId, role: 'user', text: current.draft.trim(), ...(config.judgeDebugAvailable && result.debug ? { debug: result.debug } : {}) };
      const next: SavedSession = { ...sessionRef.current, stateToken: result.stateToken, progress: result.progress, liveStep5: current.mode === 'live' && result.liveStep5,
        history: [...current.history, teacher, ...(result.message ? [result.message] : [])], draft: '', updatedAt: Date.now() };
      setSession(next); sessionRef.current = next;
      if (next.audioOutput && config.voiceAvailable && result.message) void voice.speak(result.message.text);
    } catch (cause) { if (gate.current.current(ticket.revision)) { patch({ liveStep5: false }); setError(cause instanceof Error ? cause.message : 'The connection was interrupted. Your draft is safe.'); } }
    finally { if (gate.current.current(ticket.revision)) setBusy(false); }
  }
  function pause() { interrupt(); patch({ status: 'paused' }); setScreen('welcome'); setError(''); }
  function resume() { if (!saved) return; interrupt(); setSession(saved); sessionRef.current = saved; setScreen('study'); setTab('conversation'); setError(''); }
  async function erase() { const id = sessionRef.current?.id ?? saved?.id; if (id) void fetch(`/api/session/${id}`, { method: 'DELETE' }).catch(() => {}); interrupt(); setSession(null); sessionRef.current = null; setSaved(null); await saveQueue.current; await deleteSession(); setRows([]); setScreen('welcome'); setModal(null); setError(''); }
  const inWorkspace = screen === 'study';
  const latest = session?.history.filter(message => message.role === 'assistant').at(-1);
  const latestTeacher = session?.history.filter(message => message.role === 'user').at(-1);
  const modeLabel = session?.progress.mode === 'relearn' ? 'Re-learn' : 'Teaching';
  return <div className={`app ${inWorkspace ? 'workspace-app' : ''}`}>
    <header className="topbar"><button className="brand" onClick={() => { if (inWorkspace) pause(); else setScreen('welcome'); }} aria-label="Teach Stu home"><span className="brand-dot" />teach stu<span className="brand-period">.</span></button>
      {screen !== 'welcome' && session ? <><span className="header-divider" /><span className="collection-title">{session.name}</span>{session.mode === 'demo' && <span className="mode-badge demo">Sample demo</span>}{session.liveStep5 && <span className="live-badge" role="status">Step 5 Preview · Live</span>}</> : <span className="brand-tagline">If you can teach it, you know it.</span>}
      <div className="header-actions">{inWorkspace ? <><span className="save-indicator"><Check size={13} />{saveState}</span><button className="quiet small" onClick={pause}><Pause size={15} /><span>Pause session</span></button><button className="outline small" onClick={() => { interrupt(); patch({ status: 'completed' }); setScreen('recap'); }}>End session<ArrowUp className="diagonal-arrow" size={14} /></button></> : <button className="quiet" onClick={() => setModal('how')}>How it works<HelpCircle size={16} /></button>}<button className="icon-button" aria-label="Study settings" onClick={() => setModal('settings')}><Settings2 size={19} /></button></div>
    </header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}><X size={16} /></button></div>}
    {screen === 'welcome' && <main className="welcome">
      {saved && <div className="resume-strip"><div><span className="eyebrow">RIGHT WHERE YOU LEFT OFF</span><strong>{saved.name}</strong><span>{saved.mode === 'demo' ? 'Sample demo · ' : ''}{saved.progress.percent}% overall progress · {depthNames[saved.depth]}</span></div><button className="outline" onClick={resume}>Resume session<ArrowRight size={16} /></button></div>}
      <section className="welcome-hero"><div><span className="eyebrow orange"><span className="tiny-line" /> YOUR NOTES. YOUR WORDS. YOUR LIGHTBULB MOMENT.</span><h1>Learn it by<br /><em>teaching it.</em></h1><p>Teach your course material to Stu, an earnest AI student<br className="desktop-break" /> who needs you to make every idea click.</p></div><div className="hero-character"><span className="handwritten">Meet Stu.</span><Miso size={246} /><div className="character-caption"><span className="online-dot" />Cheerful. Confused. All ears.</div></div></section>
      <section className={`upload-card ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) addFiles(Array.from(event.dataTransfer.files)); }}>
        <div className="upload-topline"><span className="section-number">01</span><span>Start a topic</span><span className="local-note"><ShieldCheck size={14} />No account needed</span></div>
        <div className="topic-fields"><label>Topic title<input aria-label="Topic title" value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Sequences and convergence" maxLength={160} /></label><label>Teaching depth<select aria-label="Teaching depth" value={depth} onChange={event => setDepth(event.target.value as Depth)}><option value="big-picture">Big picture · gist and plain language</option><option value="exam-ready">Exam ready · precise mechanisms</option><option value="expert">Expert · limitations and formal details</option></select></label><small>Depth stays fixed after teaching starts. Start a new topic to change it.</small></div>
        <div className="drop-target"><div className="upload-icon"><Upload size={25} strokeWidth={1.5} /></div><h2>Give Stu something to learn.</h2><p>Paste course notes or upload text-based lecture PDFs.</p><input ref={fileInput} type="file" multiple accept="application/pdf,.pdf" className="visually-hidden" aria-label="Choose PDF files" onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} /><div className="upload-buttons"><button className="primary" disabled={busy} onClick={() => setModal('paste')}><Pencil size={16} />Paste notes</button><button className="text-button" disabled={busy} onClick={() => fileInput.current?.click()}><Plus size={16} />Choose PDFs</button></div><small>Text-based PDFs · Up to {config.limits.maxFiles} files · {Math.round(config.limits.maxFileBytes / 1024 / 1024)} MB each</small></div>
        {rows.length > 0 && <div className="file-list">{rows.map(row => <div className="file-row" key={row.id}><FileText size={19} /><div><strong>{row.title}</strong><small>{(row.size / 1024).toFixed(0)} KB · {row.state}</small></div><button className="icon-button" disabled={busy} aria-label={`Remove ${row.title}`} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}><X size={16} /></button></div>)}<div className="prepare-row">{processing ? <span role="status"><LoaderCircle className="spin" size={16} />{processing}</span> : <span>{rows.length} {rows.length === 1 ? 'source' : 'sources'} for this topic.</span>}{busy ? <button className="outline" onClick={() => { interrupt(); setProcessing(''); }}>Cancel processing</button> : <button className="primary" disabled={!title.trim()} onClick={() => void prepare()}>Start teaching<ArrowRight size={16} /></button>}</div></div>}
        <div className="sample-strip"><span>Just looking around?</span><button className="text-button" disabled={busy} onClick={() => setModal('sample')}>Try a sample session<ArrowRight size={15} /></button></div>
      </section><p className="onboarding"><Sparkles size={16} /><span>Teach Stu the ideas yourself. When you have covered the topic, he’ll teach it back and quiz you.</span></p>
      <div className="how-strip"><div><span>01</span><BookOpen size={20} /><strong>Bring your notes</strong><p>Paste text or upload PDFs.</p></div><div><span>02</span><MessageCircle size={20} /><strong>Teach Stu</strong><p>Make the ideas clear in your own words.</p></div><div><span>03</span><Lightbulb size={20} /><strong>Learn it back</strong><p>Hear a grounded recap and take a quiz.</p></div></div>
      <footer className="welcome-footer"><span>If you can teach it, you know it.</span><span>Stu’s ready when you are.</span></footer>
    </main>}
    {inWorkspace && session && <><div className="overall-progress"><div><strong>{session.name}</strong><span>{depthNames[session.depth]} · {modeLabel}</span></div><progress aria-label="Overall topic progress" value={session.progress.credited} max={session.progress.total || 1} /><b>{session.progress.percent}%</b></div>
      {session.progress.mode === 'relearn' && <div className="transition-note" role="status">You taught Stu the whole topic. Now he’ll teach it back.</div>}
      <nav className="mobile-tabs" aria-label="Workspace view"><button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}><BookOpen size={16} />Notes</button><button className={tab === 'conversation' ? 'active' : ''} onClick={() => setTab('conversation')}><MessageCircle size={16} />Conversation</button><button onClick={() => setSidebar(!sidebar)} aria-expanded={sidebar}><Menu size={16} />Topic</button></nav>
      <div className={`workspace ${sidebar ? 'sidebar-open' : ''}`}>
        <aside className="concept-sidebar"><div className="sidebar-title"><span className="eyebrow">YOUR TOPIC</span><button className="icon-button" aria-label="Collapse topic panel" onClick={() => setSidebar(false)}><Menu size={17} /></button></div><div className="sidebar-doc"><BookOpen size={20} /><div><strong>{session.name}</strong><small>{session.documents.length} sources</small></div></div><div className="topic-panel"><p><strong>Depth</strong><span>{depthNames[session.depth]} · fixed</span></p><p><strong>Progress</strong><span>{session.progress.percent}% overall</span></p><p><strong>Mode</strong><span>{modeLabel}</span></p><button className="text-button" onClick={() => { setTab('notes'); setSidebar(false); }}>Open notes<ArrowRight size={14} /></button></div><div className="sidebar-note"><Lightbulb size={18} /><p>Stu learns from your words.<br />Take one idea at a time.</p></div>{session.mode === 'demo' && <p className="demo-explainer">Sample demo<br /><span>Guided fixture responses, not live AI assessment.</span></p>}</aside>
        <section className={`notes-pane ${tab === 'notes' ? 'mobile-active' : ''}`} aria-label="Lecture notes"><div className="notes-heading"><button className="icon-button sidebar-toggle" aria-label="Toggle topic panel" onClick={() => setSidebar(!sidebar)}><Menu size={18} /></button><span className="eyebrow">THE NOTES, RIGHT BESIDE YOU</span><span><FileText size={13} />Original source</span></div><DocumentViewer documents={session.documents} documentId={session.documentId} pageIndex={session.pageIndex} onNavigate={navigate} highlightIds={highlights} onSelection={setSelection} selection={selection} />{selection && <div className="selection-bar"><span>“{selection.text.slice(0, 90)}{selection.text.length > 90 ? '…' : ''}”</span><button className="icon-button" aria-label="Clear passage selection" onClick={() => setSelection(null)}><X size={15} /></button></div>}<div className="notes-foot"><span><Pencil size={13} />Use your notes while preparing your explanation.</span><span>Your original stays unchanged.</span></div></section>
        <aside className={`companion-panel ${tab === 'conversation' ? 'mobile-active' : ''}`}><div className="companion-top"><span><span className="online-dot" />STU’S LISTENING</span><button className="icon-button" aria-label={session.audioOutput ? 'Mute spoken responses' : 'Enable spoken responses'} onClick={() => { voice.stopPlayback(); if (!config.voiceAvailable) { setError('Spoken responses need a server-side OpenAI API key. Typing is fully available.'); return; } patch({ audioOutput: !session.audioOutput }); }}>{session.audioOutput ? <Volume2 size={17} /> : <VolumeX size={17} />}</button></div><div className="companion-character"><Miso size={152} state={voice.recording ? 'listening' : voice.speaking ? 'speaking' : busy || voice.transcribing ? 'thinking' : 'neutral'} /><span className="character-state">{voice.recording ? 'Listening to you…' : voice.transcribing ? 'Transcribing your explanation…' : voice.speaking ? 'Speaking · AI-generated voice' : busy ? 'Judge is checking, then Stu will reply…' : 'Earnest. A little confused.'}</span></div>
          <div className="conversation-current" aria-live="polite"><span className="interaction-label">{session.progress.mode === 'relearn' ? 'STU TEACHES BACK' : 'YOUR TURN TO TEACH'}</span><CurrentPrompt text={latest?.text ?? 'Teach Stu one idea to begin.'} />{session.progress.mode === 'relearn' && latest?.sourceIds?.length ? citations(latest.sourceIds) : null}{session.mode === 'live' && !config.liveAvailable && <p className="inline-notice">Live study needs a server-side StepFun key. Your notes remain available.</p>}{latestTeacher && <details className="last-explanation"><summary>Your last explanation</summary><p>{latestTeacher.text}</p>{showJudgeEvidence && latestTeacher.debug && <JudgePanel debug={latestTeacher.debug} />}</details>}</div>
          {session.history.length > 1 && <details className="history"><summary><MessageCircle size={13} />Earlier conversation <span>{session.history.length} messages</span></summary><div>{session.history.slice(0, -1).map(message => <article key={message.id}><strong>{message.role === 'user' ? 'You' : 'Stu'}</strong><p><RichText text={message.text} /></p>{session.progress.mode === 'relearn' && message.sourceIds?.length ? citations(message.sourceIds) : null}{showJudgeEvidence && message.role === 'user' && message.debug && <JudgePanel debug={message.debug} />}</article>)}</div></details>}
          <div className="response-area">{voice.recording ? <div className="recording-controls"><span className="recording-label"><span />Listening…</span><button className="primary" onClick={() => void voice.stopRecording()}><Square size={14} />I’m done</button><button className="text-button" onClick={voice.cancelRecording}>Cancel</button></div> : <button className="primary mic-button" disabled={busy || voice.transcribing || voice.requestingPermission} onClick={() => { setError(''); void voice.startRecording(); }}><Mic size={18} />Start explaining<span>↗</span></button>}
            {(voice.transcribing || voice.requestingPermission) && <button className="text-button" onClick={voice.cancelRecording}><Square size={13} />{voice.transcribing ? 'Cancel transcription' : 'Cancel microphone request'}</button>}
            {(voice.speaking || voice.speechLoading) && <button className="text-button" onClick={voice.stopPlayback}><Square size={13} />Stop speaking</button>}
            {config.voiceAvailable && <small className="voice-limit">Up to 3 minutes per turn · review before sending</small>}
            {latest && config.voiceAvailable && !voice.speaking && <button className="text-button" onClick={() => void voice.speak(latest.text)}><Volume2 size={13} />Read aloud</button>}
            <button className="type-label text-button" onClick={() => { voice.cancelRecording(); editor.current?.focus(); }}><Keyboard size={15} />Type instead<span>or edit your transcript</span></button>
            <form className="answer-form" onSubmit={event => { event.preventDefault(); if (session.draft.trim()) void teach(); }}><textarea ref={editor} aria-label="Your explanation" placeholder={session.progress.mode === 'relearn' ? 'Answer Stu’s question in your own words…' : 'Teach Stu in your own words…'} value={session.draft} onChange={event => { if (busy || voice.recording || voice.transcribing || voice.requestingPermission) interrupt(); patch({ draft: event.target.value }); }} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && session.draft.trim()) { event.preventDefault(); void teach(); } }} /><div><span>{voice.transcribing ? 'Review the transcript before sending.' : 'Your words are the lesson.'}</span><button className="send-button" aria-label="Send explanation" disabled={busy || !session.draft.trim()}><Send size={16} /></button></div></form>
            {busy && <button className="text-button" onClick={interrupt}><Square size={12} />Cancel response</button>}
            <div className="help-actions"><button onClick={() => { setTab('notes'); setSidebar(false); }}><BookOpen size={16} />Look at my notes<ChevronRight size={13} /></button></div>
            <div className="companion-footer"><span>One idea at a time.</span></div>
          </div></aside>
      </div></>}
    {screen === 'recap' && session && <main className="recap-page"><div className="recap-heading"><Miso size={132} state="pleased" /><span className="eyebrow orange">YOUR TEACHING SESSION</span><h1>Here’s what you<br />worked through.</h1><p>{session.mode === 'demo' ? 'A guided sample session.' : 'Your words, your notes, and Stu’s questions.'}</p></div><div className="recap-facts"><span><MessageCircle size={17} />{session.history.filter(message => message.role === 'user').length} contributions</span><span><BookOpen size={17} />{session.documents.length} sources</span><span><Check size={17} />{session.progress.percent}% overall</span></div><section className="next-session"><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>{session.progress.mode === 'relearn' ? 'Keep answering Stu’s quiz.' : 'Keep teaching Stu in your own words.'}</h2><p>Your notes and conversation are saved on this device.</p><button className="text-button" onClick={() => { patch({ status: 'active' }); setScreen('study'); setTab('conversation'); }}>Continue session<ArrowRight size={16} /></button></section><div className="recap-bottom"><button className="primary" onClick={() => setScreen('welcome')}>Continue next time<ArrowRight size={16} /></button><button className="text-button" onClick={() => { setScreen('welcome'); setRows([]); }}>Start a new topic</button><button className="text-button danger" onClick={() => setModal('delete')}><Trash2 size={14} />Delete session & files</button></div></main>}
    {modal === 'sample' && <Modal title="A small taste of Teach Stu." onClose={() => setModal(null)}><p className="modal-description">Choose a subject. Sample responses are deterministic and clearly labeled.</p><div className="sample-options"><button onClick={() => void prepare('analysis')}><span className="sample-symbol">∑</span><span><strong>Sequences & convergence</strong><small>Real analysis · 4 pages</small><p>Bounds, limits, and the conditions that matter.</p></span><ArrowRight size={19} /></button><button onClick={() => void prepare('research')}><span className="sample-symbol">✧</span><span><strong>Experiments & causal claims</strong><small>Research methods · 2 pages</small><p>Sampling, assignment, and causality.</p></span><ArrowRight size={19} /></button></div></Modal>}
    {modal === 'paste' && <Modal title="Paste course notes." onClose={() => setModal(null)}><form onSubmit={event => { event.preventDefault(); if (paste.trim().length < 40) { setError('Paste at least 40 characters of course content.'); return; } const name = pasteTitle.trim() || 'Pasted notes'; setRows(current => [...current, { id: uid(), title: name, text: paste, size: new Blob([paste]).size, state: 'Ready to read' }]); if (!title.trim()) setTitle(name); setPaste(''); setModal(null); }}><label className="field-label">Title<input value={pasteTitle} onChange={event => setPasteTitle(event.target.value)} required /></label><label className="field-label">Lecture text<textarea className="paste-editor" placeholder="Paste a definition, a lecture, or the section you keep rereading…" maxLength={config.limits.maxTextCharacters} value={paste} onChange={event => setPaste(event.target.value)} required /></label><div className="modal-footer"><small>{paste.length.toLocaleString()} / {config.limits.maxTextCharacters.toLocaleString()} characters</small><button className="primary" disabled={paste.trim().length < 40}>Add these notes<ArrowRight size={15} /></button></div></form></Modal>}
    {modal === 'settings' && <Modal title="Make yourself comfortable." onClose={() => setModal(null)}><div className="setting-row"><div><strong>Teaching depth</strong><p>{session ? 'Fixed for this topic. Start a new topic to change it.' : 'Choose a depth when starting a topic.'}</p></div><span>{session ? depthNames[session.depth] : depthNames[depth]}</span></div><div className="setting-row"><div><strong>Spoken responses</strong><p>{config.voiceAvailable ? 'AI-generated voice. You can stop it at any time.' : 'Connect speech to talk and listen. Typing always works.'}</p></div><button className="outline" disabled={!session || !config.voiceAvailable} onClick={() => { voice.stopPlayback(); patch({ audioOutput: !session?.audioOutput }); }}>{session?.audioOutput ? 'On' : 'Off'}</button></div>{config.judgeDebugAvailable && <div className="setting-row"><div><strong>Show Judge Evidence</strong><p>Show verified quotes and safe verdict summaries under your turns.</p></div><button className="outline" aria-pressed={showJudgeEvidence} onClick={() => setShowJudgeEvidence(!showJudgeEvidence)}>{showJudgeEvidence ? 'On' : 'Off'}</button></div>}<div className="provider-status"><span className="eyebrow">CONNECTIONS</span><p><span className={`status-dot ${session?.liveStep5 ? 'connected' : ''}`} /><strong>Step 5 Preview Judge</strong><span>{session?.liveStep5 ? 'Live turn completed' : config.liveAvailable ? 'Key configured · connection unverified' : 'Setup needed'}</span></p><p><span className={`status-dot ${config.voiceAvailable ? 'connected' : ''}`} /><strong>OpenAI speech</strong><span>{config.voiceAvailable ? 'Configured' : 'Setup needed'}</span></p><details><summary>Developer setup</summary><p>Copy <code>.env.example</code> to <code>.env</code>. Set <code>STEPFUN_API_KEY</code> for live study and optionally <code>OPENAI_API_KEY</code> for voice. Restart the server. Keys stay server-side.</p></details></div><div className="privacy-note"><ShieldCheck size={19} /><p>Notes, drafts, and session history are saved in this browser. The hidden StepFun Judge receives relevant notes and teacher messages. During teaching, Stu receives the conversation and a grounded director note, never the private rubric or notes. Re-learn uses a source-grounded brief. Optional voice sends requested audio or response text to OpenAI. Teach Stu uses inference; it does not train or permanently learn from you. Provider retention policies still apply.</p></div>{saved && <button className="text-button danger" onClick={() => setModal('delete')}><Trash2 size={14} />Delete saved session and uploaded files</button>}</Modal>}
    {modal === 'how' && <Modal title="If you can teach it, you know it." onClose={() => setModal(null)}><div className="how-content"><p><strong>1. Bring the material.</strong><br />Paste notes or upload text-based PDFs, then choose one fixed depth.</p><p><strong>2. Teach Stu.</strong><br />Explain ideas in your own words. A private Judge checks what your words actually establish; Stu asks one question at a time.</p><p><strong>3. Learn it back.</strong><br />Once you have taught the topic, Stu teaches it back and quizzes you with source-grounded help.</p><p>Teach Stu does not train or fine-tune a model. Stu does not permanently learn from users.</p></div><button className="primary" onClick={() => setModal(null)}>Let’s begin<ArrowRight size={16} /></button></Modal>}
    {modal === 'delete' && <Modal title="Clear this topic?" onClose={() => setModal(null)}><p>This removes the saved session, uploaded PDFs, extracted text, and document cache from this browser. It does not delete your original files.</p><div className="modal-footer"><button className="outline" onClick={() => setModal(null)}>Keep my session</button><button className="danger-button" onClick={() => void erase()}>Delete session & files</button></div></Modal>}
  </div>;
}

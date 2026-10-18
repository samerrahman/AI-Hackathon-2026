import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, BookOpen, Check, ChevronRight, FileText, HelpCircle, Keyboard, Lightbulb, LoaderCircle, Menu, MessageCircle, Mic, Pause, Pencil, Plus, Send, Settings2, ShieldCheck, Sparkles, Square, Trash2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import type { AppConfig, CharacterState, SelectionContext, StudyDocument } from '../shared/types';
import { ingestPdf, ingestText } from './lib/documents';
import { saveSession, loadSession, deleteSession } from './lib/storage';
import { TurnGate } from './lib/turnGate';
import { DocumentViewer } from './components/DocumentViewer';
import { Miso } from './components/Miso';
import { RichText } from './components/RichText';
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
  documentId: string; pageIndex: number; draft: string; audioOutput: boolean; status: 'active' | 'paused' | 'completed'; updatedAt: number;
  /** Stu's reaction to the last teaching turn, derived only from the overall progress change. */
  mood?: CharacterState };
type FileRow = { id: string; file?: File; title: string; text?: string; size: number; state: string };
const uid = () => crypto.randomUUID();
const depthNames: Record<Depth, string> = { 'big-picture': 'Big picture', 'exam-ready': 'Exam ready', expert: 'Expert' };
const expressions: { state: CharacterState; label: string }[] = [
  { state: 'neutral', label: 'Neutral' }, { state: 'listening', label: 'Listening' }, { state: 'thinking', label: 'Thinking' },
  { state: 'speaking', label: 'Speaking' }, { state: 'puzzled', label: 'Puzzled' }, { state: 'pleased', label: 'Pleased' }, { state: 'blink', label: 'Blink' },
];
const moodCaptions: Partial<Record<CharacterState, string>> = { pleased: 'Ohh, something just clicked!', puzzled: 'Hmm… still a little confused.' };
const fallbackConfig: AppConfig = { liveAvailable: false, voiceAvailable: false, provider: 'Step 5 Preview', limits: { maxFiles: 5, maxFileBytes: 20 * 1024 * 1024, maxPages: 100, maxTextCharacters: 300000 } };
const hostingPreview = import.meta.env.VITE_HOSTING_ONLY === 'true';
const previewToken = 'hosting-preview';
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
  const [modal, setModal] = useState<'sample' | 'paste' | 'settings' | 'how' | 'delete' | 'expressions' | null>(null);
  const [expression, setExpression] = useState<CharacterState>('neutral');
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
  const thread = useRef<HTMLDivElement>(null);
  const voice = useVoice({ enabled: config.voiceAvailable, onTranscript: text => { patch({ draft: [sessionRef.current?.draft, text].filter(Boolean).join(' ') }); editor.current?.focus(); }, onError: setError });
  useEffect(() => {
    if (!hostingPreview) fetch('/api/config').then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(setConfig).catch(() => setError('The study server is unavailable. Please reload in a moment.'));
    loadSession<SavedSession>().then(value => { if (value?.stateToken && value?.progress && (hostingPreview ? value.stateToken === previewToken : value.stateToken !== previewToken)) setSaved(value); }).catch(() => setError('Local storage is unavailable. This session may not survive a refresh.'));
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
  /** talkOnly: no notes; the hidden Judge grades from Step 5 Preview's own knowledge. */
  async function prepare(sampleId?: 'analysis' | 'research', talkOnly = false) {
    if (!sampleId && !title.trim()) { setError(talkOnly ? 'Give your topic a title, then just start talking.' : 'Give your topic a title first.'); return; }
    if (talkOnly && hostingPreview) { setError('Talking without notes needs the study server, which this preview does not have.'); return; }
    if (!sampleId && !talkOnly && !rows.length) { setError('Paste notes or upload a text-based PDF first.'); return; }
    interrupt(); const ticket = gate.current.begin(); setError(''); setBusy(true); setModal(null);
    const docs: StudyDocument[] = []; const errors: string[] = [];
    try {
      let work = talkOnly ? [] : rows;
      if (sampleId) { const name = sampleId === 'analysis' ? 'Sequences_and_Convergence.pdf' : 'Experiments_and_Causal_Claims.pdf'; setProcessing('Opening sample notes…'); const response = await fetch(`/examples/${name}`, { signal: ticket.signal }); if (!response.ok) throw new Error('The sample file could not be opened.'); const file = new File([await response.blob()], name, { type: 'application/pdf' }); work = [{ id: uid(), file, title: name, size: file.size, state: 'Reading pages' }]; }
      for (const row of work) {
        if (!gate.current.current(ticket.revision)) return;
        const report = (message: string) => { if (gate.current.current(ticket.revision)) { setProcessing(message); setRows(current => current.map(item => item.id === row.id ? { ...item, state: message } : item)); } };
        try { report(`Reading ${row.title}…`); const document = row.file ? await ingestPdf(row.file, report, ticket.signal) : await ingestText(row.text ?? '', row.title, ticket.signal); if (!docs.some(existing => existing.id === document.id)) docs.push(document); report(`${document.pageCount} pages read`); }
        catch (cause) { errors.push(`${row.title}: ${cause instanceof Error ? cause.message : 'Could not read this file.'}`); report('Could not read this file'); }
      }
      if (!docs.length && !talkOnly) throw new Error(errors.join(' ') || 'Add readable notes first.');
      const name = sampleId === 'analysis' ? 'Sequences & convergence' : sampleId === 'research' ? 'Experiments & causal claims' : title.trim();
      if (hostingPreview) {
        const next: SavedSession = { id: uid(), name, depth, mode: sampleId ? 'demo' : 'live', sampleId, documents: docs,
          stateToken: previewToken, history: [], progress: { total: 0, credited: 0, percent: 0, mode: 'teach' }, liveStep5: false,
          documentId: docs[0].id, pageIndex: 0, draft: '', audioOutput: false, status: 'active', updatedAt: Date.now() };
        setSession(next); sessionRef.current = next; setScreen('study'); setTab('notes'); setSidebar(window.innerWidth >= 1190); setRows([]); setHighlights([]); setSelection(null); setError(errors.join('\n'));
        return;
      }
      setProcessing(talkOnly ? 'Getting Stu ready…' : 'Building a private study plan…');
      const result = await api<TopicResponse>('/api/topic', { title: name, depth, documents: plainDocs(docs), mode: sampleId ? 'demo' : 'live', sampleId }, ticket.signal);
      if (!gate.current.current(ticket.revision)) return;
      const next: SavedSession = { id: result.topicId, name, depth, mode: sampleId ? 'demo' : 'live', sampleId, documents: docs,
        stateToken: result.stateToken, history: result.message ? [result.message] : [], progress: result.progress, liveStep5: false,
        documentId: docs[0]?.id ?? '', pageIndex: 0, draft: '', audioOutput: false, status: 'active', updatedAt: Date.now() };
      setSession(next); sessionRef.current = next; setScreen('study'); setTab('conversation'); setSidebar(window.innerWidth >= 1190); setRows([]); setHighlights([]); setSelection(null); setError(errors.join('\n'));
    } catch (cause) { if (gate.current.current(ticket.revision)) setError(cause instanceof Error ? cause.message : 'Could not prepare this topic.'); }
    finally { if (gate.current.current(ticket.revision)) { setBusy(false); setProcessing(''); } }
  }
  async function teach() {
    if (hostingPreview) return;
    const current = sessionRef.current; if (!current?.draft.trim()) return;
    voice.cancelRecording(); voice.stopPlayback(); const ticket = gate.current.begin(); const turnId = uid(); const messageId = uid(); setBusy(true); setError('');
    try {
      const result = await api<TopicResponse>('/api/teach', { topicId: current.id, stateToken: current.stateToken, documents: plainDocs(current.documents), turnId, messageId, revision: ticket.revision, text: current.draft.trim() }, ticket.signal);
      if (!gate.current.current(ticket.revision) || sessionRef.current?.id !== current.id || result.topicId !== current.id) return;
      const teacher: Message = { id: messageId, role: 'user', text: current.draft.trim(), ...(config.judgeDebugAvailable && result.debug ? { debug: result.debug } : {}) };
      // Stu's face reacts to the overall bar only, so it never hints at which idea was credited.
      const mood: CharacterState = result.progress.credited > current.progress.credited ? 'pleased' : result.progress.credited < current.progress.credited || result.progress.mode === 'teach' ? 'puzzled' : 'neutral';
      const next: SavedSession = { ...sessionRef.current, stateToken: result.stateToken, progress: result.progress, liveStep5: current.mode === 'live' && result.liveStep5, mood,
        history: [...current.history, teacher, ...(result.message ? [result.message] : [])], draft: '', updatedAt: Date.now() };
      setSession(next); sessionRef.current = next;
      if (next.audioOutput && config.voiceAvailable && result.message) void voice.speak(result.message.text);
    } catch (cause) { if (gate.current.current(ticket.revision)) { patch({ liveStep5: false }); setError(cause instanceof Error ? cause.message : 'The connection was interrupted. Your draft is safe.'); } }
    finally { if (gate.current.current(ticket.revision)) setBusy(false); }
  }
  function pause() { interrupt(); patch({ status: 'paused' }); setScreen('welcome'); setError(''); }
  function resume() { if (!saved) return; interrupt(); setSession(saved); sessionRef.current = saved; setScreen('study'); setTab(hostingPreview ? 'notes' : 'conversation'); setError(''); }
  async function erase() { const id = sessionRef.current?.id ?? saved?.id; if (id && !hostingPreview) void fetch(`/api/session/${id}`, { method: 'DELETE' }).catch(() => {}); interrupt(); setSession(null); sessionRef.current = null; setSaved(null); await saveQueue.current; await deleteSession(); setRows([]); setScreen('welcome'); setModal(null); setError(''); }
  const inWorkspace = screen === 'study';
  const relearn = session?.progress.mode === 'relearn';
  const latest = session?.history.filter(message => message.role === 'assistant').at(-1);
  const modeLabel = relearn ? 'Re-learn' : 'Teaching';
  const stuState: CharacterState = voice.recording ? 'listening' : voice.speaking ? 'speaking' : busy || voice.transcribing ? 'thinking' : session?.mood ?? 'neutral';
  const stuCaption = voice.recording ? 'Stu is listening…' : voice.transcribing ? 'Transcribing your explanation…' : voice.speaking ? 'Speaking · AI-generated voice' : busy ? 'Stu is thinking…'
    : (session?.mood && moodCaptions[session.mood]) || (relearn ? 'Your turn to be the student.' : 'Earnest. A little confused.');
  useEffect(() => { const element = thread.current; if (element) element.scrollTop = element.scrollHeight; }, [session?.history.length, busy, tab, inWorkspace]);
  return <div className={`app ${inWorkspace ? 'workspace-app' : ''}`}>
    <header className="topbar"><button className="brand" onClick={() => { if (inWorkspace) pause(); else setScreen('welcome'); }} aria-label="Teach Stu home"><span className="brand-dot" />teach stu</button>
      {screen !== 'welcome' && session ? <><span className="header-divider" /><span className="collection-title">{session.name}</span>{session.mode === 'demo' && <span className="mode-badge demo">{hostingPreview ? 'Sample notes' : 'Sample demo'}</span>}{session.liveStep5 && <span className="live-badge" role="status">Step 5 Preview · Live</span>}</> : <span className="brand-tagline">If you can teach it, you know it.</span>}
      <div className="header-actions">{inWorkspace ? <><span className="save-indicator"><Check size={13} />{saveState}</span><button className="quiet small" onClick={pause}><Pause size={15} /><span>{hostingPreview ? 'Close notes' : 'Pause session'}</span></button>{!hostingPreview && <button className="outline small" onClick={() => { interrupt(); patch({ status: 'completed' }); setScreen('recap'); }}>End session<ArrowUp className="diagonal-arrow" size={14} /></button>}</> : <button className="quiet" onClick={() => setModal('how')}>How it works<HelpCircle size={16} /></button>}<button className="icon-button" aria-label="Study settings" onClick={() => setModal('settings')}><Settings2 size={19} /></button></div>
    </header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}><X size={16} /></button></div>}

    {screen === 'welcome' && <main className="welcome">
      {saved && <div className="resume-strip"><div><span className="eyebrow">RIGHT WHERE YOU LEFT OFF</span><strong>{saved.name}</strong><span>{hostingPreview ? 'Notes preview' : `${saved.mode === 'demo' ? 'Sample demo · ' : ''}${saved.progress.percent}% overall progress · ${depthNames[saved.depth]}`}</span></div><button className="outline" onClick={resume}>{hostingPreview ? 'Reopen notes' : 'Resume session'}<ArrowRight size={16} /></button></div>}
      <section className="welcome-hero"><div><h1>Meet Stu.<br /><em>Your new AI student.</em></h1><p>Bring your lecture notes. Explain the ideas to Stu,<br className="desktop-break" /> catch his mix-ups, and make the tricky parts click.</p></div><div className="hero-character"><span className="handwritten">Click Stu. Boing!</span><Miso size={246} state="neutral" /><div className="character-caption"><span className="online-dot" />Curious. Occasionally confused. All ears.</div></div></section>
      <section className={`upload-card ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) addFiles(Array.from(event.dataTransfer.files)); }}>
        <div className="upload-topline"><span className="section-number">01</span><span>Start with what you’re studying</span><span className="local-note"><ShieldCheck size={14} />No account needed</span></div>
        <div className="topic-fields"><label>Topic title<input aria-label="Topic title" value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Sequences and convergence" maxLength={160} /></label><label>Teaching depth<select aria-label="Teaching depth" value={depth} onChange={event => setDepth(event.target.value as Depth)}><option value="big-picture">Big picture · gist and plain language</option><option value="exam-ready">Exam ready · precise mechanisms</option><option value="expert">Expert · limitations and formal details</option></select></label><small>Depth stays fixed after teaching starts. Start a new topic to change it.</small></div>
        <div className="drop-target"><div className="upload-icon"><Upload size={25} strokeWidth={1.5} /></div><h2>A fresh pair of eyes on your notes.</h2><p>Drop your lecture PDFs here, or paste your notes.</p><input ref={fileInput} type="file" multiple accept="application/pdf,.pdf" className="visually-hidden" aria-label="Choose PDF files" onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} /><div className="upload-buttons"><button className="primary" disabled={busy} onClick={() => fileInput.current?.click()}><Plus size={17} />Choose lecture notes</button><button className="text-button" disabled={busy || rows.length >= config.limits.maxFiles} onClick={() => setModal('paste')}><Pencil size={15} />Paste notes</button></div>{!hostingPreview && <button className="text-button start-talking" disabled={busy} onClick={() => void prepare(undefined, true)}>or just start talking<ArrowRight size={13} /></button>}<small>Text-based PDFs · Up to {config.limits.maxFiles} files · {Math.round(config.limits.maxFileBytes / 1024 / 1024)} MB and {config.limits.maxPages} pages each</small></div>
        {rows.length > 0 && <div className="file-list">{rows.map(row => <div className="file-row" key={row.id}><FileText size={19} /><div><strong>{row.title}</strong><small>{(row.size / 1024).toFixed(0)} KB · {row.state}</small></div><button className="icon-button" disabled={busy} aria-label={`Remove ${row.title}`} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}><X size={16} /></button></div>)}<div className="prepare-row">{processing ? <span role="status"><LoaderCircle className="spin" size={16} />{processing}</span> : <span>{rows.length} {rows.length === 1 ? 'source' : 'sources'} for this topic.</span>}{busy ? <button className="outline" onClick={() => { interrupt(); setProcessing(''); }}>Cancel processing</button> : <button className="primary" disabled={!title.trim()} onClick={() => void prepare()}>{hostingPreview ? 'Browse notes' : 'Start teaching'}<ArrowRight size={16} /></button>}</div></div>}
        <div className="sample-strip"><span>Just looking around?</span><button className="text-button" disabled={busy} onClick={() => setModal('sample')}>{hostingPreview ? 'Browse sample notes' : 'Try a sample session'}<ArrowRight size={15} /></button><span className="sample-divider">or</span><button className="text-button" disabled={busy} onClick={() => { setExpression('neutral'); setModal('expressions'); }}>Test Stu’s expressions<ArrowRight size={15} /></button></div>
      </section>
      <p className="onboarding"><Sparkles size={16} /><span>Stu sometimes gets an idea wrong on purpose. Your job is to explain it clearly and catch the mix-ups.</span></p>
      <div className="how-strip"><div><span>01</span><BookOpen size={20} /><strong>Bring your notes</strong><p>Any subject. Your actual material.</p></div><div><span>02</span><MessageCircle size={20} /><strong>Teach Stu</strong><p>Explain, question, and connect.</p></div><div><span>03</span><Lightbulb size={20} /><strong>Learn it back</strong><p>Stu teaches it back and quizzes you.</p></div></div>
      <footer className="welcome-footer"><span>Made for the “wait, I think I get it” moments.</span><span>Take your time. Stu’s here.</span></footer>
    </main>}

    {inWorkspace && session && <><div className="session-chrome">
      <nav className="session-tabs" aria-label="Session navigation">{!hostingPreview && <button className={tab === 'conversation' ? 'active' : ''} onClick={() => setTab('conversation')}><MessageCircle size={16} />Teach Stu</button>}{session.documents.length > 0 && <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}><BookOpen size={16} />Notes</button>}<button className="session-tab-end" onClick={() => setSidebar(!sidebar)} aria-expanded={sidebar}><Menu size={16} />Topic</button></nav>
      {!hostingPreview && <div className="top-progress"><div><span>{relearn ? 'RE-LEARN MODE' : 'TEACHING PROGRESS'}</span><strong>{depthNames[session.depth]} · {session.progress.percent}% taught</strong></div><progress aria-label="Overall topic progress" value={session.progress.credited} max={session.progress.total || 1} /></div>}
    </div>
      {relearn && <div className="transition-note" role="status">You taught Stu the whole topic. Now he’ll teach it back.</div>}
      <div className={`workspace focused-workspace ${sidebar ? 'sidebar-open' : ''}`}>
        <aside className="concept-sidebar topic-sidebar"><div className="sidebar-title"><span className="eyebrow">YOUR TOPIC</span><button className="icon-button" aria-label="Close topic panel" onClick={() => setSidebar(false)}><X size={16} /></button></div><div className="sidebar-doc"><BookOpen size={20} /><div><strong>{session.name}</strong><small>{session.documents.length ? `${session.documents.length} ${session.documents.length === 1 ? 'source' : 'sources'}` : 'No notes · judged from general knowledge'}</small></div></div>
          <div className="topic-panel">{!hostingPreview && <><p><strong>Depth</strong><span>{depthNames[session.depth]} · fixed</span></p><p><strong>Progress</strong><span>{session.progress.percent}% overall</span></p><p><strong>Mode</strong><span>{modeLabel}</span></p></>}{session.documents.length > 0 && <button className="text-button" onClick={() => { setTab('notes'); if (window.innerWidth < 1191) setSidebar(false); }}>Open notes<ArrowRight size={14} /></button>}</div>
          <div className="sidebar-note"><Lightbulb size={18} /><p>Stu learns only from your words.<br />Take one idea at a time.</p></div>{session.mode === 'demo' && <p className="demo-explainer">{hostingPreview ? 'Sample notes' : 'Sample demo'}<br /><span>{hostingPreview ? 'Read the source material in this preview.' : 'Guided fixture responses, not live AI assessment.'}</span></p>}</aside>
        {tab === 'notes' ? <section className="notes-pane mobile-active" aria-label="Lecture notes"><div className="notes-heading"><span className="eyebrow">THE NOTES, RIGHT BESIDE YOU</span><span><FileText size={13} />Original source</span></div><DocumentViewer documents={session.documents} documentId={session.documentId} pageIndex={session.pageIndex} onNavigate={navigate} highlightIds={highlights} onSelection={setSelection} selection={selection} />{selection && <div className="selection-bar"><span>“{selection.text.slice(0, 90)}{selection.text.length > 90 ? '…' : ''}”</span><button className="icon-button" aria-label="Clear passage selection" onClick={() => setSelection(null)}><X size={15} /></button></div>}<div className="notes-foot">{!hostingPreview && <button className="text-button" onClick={() => setTab('conversation')}><ArrowLeft size={13} />Back to Stu</button>}<span>Your original stays unchanged.</span></div></section>
          : <main className="teaching-chat" aria-label="Teach Stu conversation">
            <div className="chat-header"><div className="chat-stu"><Miso size={78} state={stuState} /><div><span className="eyebrow"><span className="online-dot" /> {relearn ? 'STU TEACHES BACK' : 'YOU’RE TEACHING STU'}</span><strong>{session.name}</strong><small className="character-state">{stuCaption}</small></div></div><button className="icon-button" aria-label={session.audioOutput ? 'Mute spoken responses' : 'Enable spoken responses'} onClick={() => { voice.stopPlayback(); if (!config.voiceAvailable) { setError('Spoken responses are unavailable right now. Typing is fully available.'); return; } patch({ audioOutput: !session.audioOutput }); }}>{session.audioOutput ? <Volume2 size={17} /> : <VolumeX size={17} />}</button></div>
            <div className="chat-thread" ref={thread} aria-live="polite">{session.history.map(message => <div className={`message-row ${message.role === 'user' ? 'student-message' : 'stu-message'}`} key={message.id}>{message.role === 'assistant' && <Miso size={42} interactive={false} state={message.id === latest?.id ? stuState : 'neutral'} />}<div className="message-wrap"><span>{message.role === 'user' ? 'You' : 'Stu'}</span><div className="message-bubble"><RichText text={message.text} /></div>{relearn && message.role === 'assistant' && message.sourceIds?.length ? citations(message.sourceIds) : null}{showJudgeEvidence && message.role === 'user' && message.debug && <JudgePanel debug={message.debug} />}</div></div>)}
              {busy && <div className="message-row stu-message pending-message"><Miso size={42} interactive={false} state="thinking" /><div className="message-wrap"><span>Stu</span><div className="message-bubble" aria-label="Stu is thinking"><i /><i /><i /></div></div></div>}</div>
            {session.mode === 'live' && !config.liveAvailable && <p className="inline-notice">Live study needs a server-side StepFun key. Your notes remain available.</p>}
            <div className="response-area chat-composer">
              {voice.recording ? <div className="recording-controls"><span className="recording-label"><span />Listening… {Math.floor(voice.recordingSeconds / 60)}:{String(voice.recordingSeconds % 60).padStart(2, '0')} / 3:00</span><button className="primary" onClick={() => void voice.stopRecording()}><Square size={14} />I’m done</button><button className="text-button" onClick={voice.cancelRecording}>Cancel</button></div> : <button className="primary mic-button" disabled={busy || voice.transcribing || voice.requestingPermission} onClick={() => { setError(''); void voice.startRecording(); }}><Mic size={18} />Start explaining<span>↗</span></button>}
              {(voice.transcribing || voice.requestingPermission) && <button className="text-button" onClick={voice.cancelRecording}><Square size={13} />{voice.transcribing ? 'Cancel transcription' : 'Cancel microphone request'}</button>}
              {(voice.speaking || voice.speechLoading) && <button className="text-button" onClick={voice.stopPlayback}><Square size={13} />Stop speaking</button>}
              {config.voiceAvailable && <small className="voice-limit">Up to 3 minutes per turn · review before sending</small>}
              {latest && config.voiceAvailable && !voice.speaking && <button className="text-button" onClick={() => void voice.speak(latest.text)}><Volume2 size={13} />Read aloud</button>}
              <button className="type-label text-button" onClick={() => { voice.cancelRecording(); editor.current?.focus(); }}><Keyboard size={15} />Type instead<span>or edit your transcript</span></button>
              <form className="answer-form" onSubmit={event => { event.preventDefault(); if (session.draft.trim()) void teach(); }}><textarea ref={editor} aria-label="Your explanation" placeholder={relearn ? 'Answer Stu’s question in your own words…' : 'In my own words…'} value={session.draft} onChange={event => { if (busy || voice.recording || voice.transcribing || voice.requestingPermission) interrupt(); patch({ draft: event.target.value }); }} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && session.draft.trim()) { event.preventDefault(); void teach(); } }} /><div><span>{voice.transcribing ? 'Review the transcript before sending.' : 'Your words are the lesson.'}</span><button className="send-button" aria-label="Send explanation" disabled={busy || !session.draft.trim()}><Send size={16} /></button></div></form>
              {busy && <button className="text-button" onClick={interrupt}><Square size={12} />Cancel response</button>}
              <div className="help-actions">{session.documents.length > 0 && <button onClick={() => setTab('notes')}><BookOpen size={16} />Look at my notes<ChevronRight size={13} /></button>}<button onClick={() => setSidebar(!sidebar)}><Lightbulb size={16} />About this topic<ChevronRight size={13} /></button></div>
              <div className="companion-footer"><span>One idea at a time.</span><span>No rush.</span></div>
            </div></main>}
      </div></>}

    {screen === 'recap' && session && <main className="recap-page"><div className="recap-heading"><Miso size={132} state="pleased" /><span className="eyebrow orange">A LITTLE CLEARER THAN BEFORE</span><h1>Here’s what you<br />worked through.</h1><p>{session.mode === 'demo' ? 'A guided sample session.' : 'Your words, your notes, and Stu’s questions.'}</p></div><div className="recap-facts"><span><MessageCircle size={17} />{session.history.filter(message => message.role === 'user').length} contributions</span><span><BookOpen size={17} />{session.documents.length} sources</span><span><Check size={17} />{session.progress.percent}% overall</span></div><section className="next-session"><span className="eyebrow">NEXT TIME, START HERE</span><h2>{relearn ? 'Keep answering Stu’s quiz.' : 'Keep teaching Stu in your own words.'}</h2><p>Your notes and conversation are saved on this device.</p><button className="text-button" onClick={() => { patch({ status: 'active' }); setScreen('study'); setTab('conversation'); }}>Continue session<ArrowRight size={16} /></button></section><div className="recap-bottom"><button className="primary" onClick={() => setScreen('welcome')}>Continue next time<ArrowRight size={16} /></button><button className="text-button" onClick={() => { setScreen('welcome'); setRows([]); }}>Start a new topic</button><button className="text-button danger" onClick={() => setModal('delete')}><Trash2 size={14} />Delete session & files</button></div></main>}

    {modal === 'sample' && <Modal title={hostingPreview ? 'Browse sample notes.' : 'A small taste of Teach Stu.'} onClose={() => setModal(null)}><p className="modal-description">{hostingPreview ? 'Choose original synthetic notes to explore. Sample conversations will be available after the study server is deployed.' : 'Choose a subject and try the whole teaching loop. These are original synthetic notes with guided demo responses.'}</p><div className="sample-options"><button onClick={() => void prepare('analysis')}><span className="sample-symbol">∑</span><span><strong>Sequences & convergence</strong><small>Real analysis · 4 pages</small><p>Bounds, limits, and the conditions that matter.</p></span><ArrowRight size={19} /></button><button onClick={() => void prepare('research')}><span className="sample-symbol"><FlaskIcon /></span><span><strong>Experiments & causal claims</strong><small>Research methods · 2 pages</small><p>What a study can—and can’t—tell us.</p></span><ArrowRight size={19} /></button></div><p className="subtle-note">{hostingPreview ? 'Note browsing works in this preview. Interactive study is coming soon.' : 'Always labeled Sample demo. Your own notes use live AI only.'}</p></Modal>}
    {modal === 'expressions' && <Modal title="Stu’s expressions." onClose={() => setModal(null)}><p className="modal-description">Preview how Stu reacts while you teach. Click Stu for a boing.</p><div className="expression-stage"><Miso size={170} state={expression} /></div><div className="mock-controls expression-controls" aria-label="Stu expression controls">{expressions.map(item => <button key={item.state} aria-pressed={expression === item.state} onClick={() => setExpression(item.state)}>{item.label}</button>)}</div></Modal>}
    {modal === 'paste' && <Modal title="Bring your notes, in your words." onClose={() => setModal(null)}><form onSubmit={event => { event.preventDefault(); if (paste.trim().length < 40) { setError('Paste at least 40 characters of course content.'); return; } const name = pasteTitle.trim() || 'Pasted notes'; setRows(current => [...current, { id: uid(), title: name, text: paste, size: new Blob([paste]).size, state: 'Ready to read' }]); if (!title.trim()) setTitle(name); setPaste(''); setModal(null); }}><label className="field-label">Title<input value={pasteTitle} onChange={event => setPasteTitle(event.target.value)} required /></label><label className="field-label">Lecture text<textarea className="paste-editor" placeholder="Paste a definition, a lecture, or the section you keep rereading…" maxLength={config.limits.maxTextCharacters} value={paste} onChange={event => setPaste(event.target.value)} required /></label><div className="modal-footer"><small>{paste.length.toLocaleString()} / {config.limits.maxTextCharacters.toLocaleString()} characters</small><button className="primary" disabled={paste.trim().length < 40}>Add these notes<ArrowRight size={15} /></button></div></form></Modal>}
    {modal === 'settings' && <Modal title="Settings" onClose={() => setModal(null)}>{session && <><div className="setting-row"><div><strong>Teaching depth</strong><p>Fixed for this topic. Start a new topic to change it.</p></div><span>{depthNames[session.depth]}</span></div><div className="setting-row"><div><strong>Spoken responses</strong><p>{config.voiceAvailable ? 'AI-generated voice. You can stop it at any time.' : hostingPreview ? 'Voice is coming soon with the study server.' : 'Connect speech to talk and listen. Typing always works.'}</p></div><button className="outline" disabled={!config.voiceAvailable} onClick={() => { voice.stopPlayback(); patch({ audioOutput: !session.audioOutput }); }}>{session.audioOutput ? 'On' : 'Off'}</button></div></>}{config.judgeDebugAvailable && <div className="setting-row"><div><strong>Show Judge Evidence</strong><p>Show verified quotes and safe verdict summaries under your turns.</p></div><button className="outline" aria-pressed={showJudgeEvidence} onClick={() => setShowJudgeEvidence(!showJudgeEvidence)}>{showJudgeEvidence ? 'On' : 'Off'}</button></div>}<div className="provider-status"><span className="eyebrow">CONNECTIONS</span><p><span className={`status-dot ${session?.liveStep5 ? 'connected' : ''}`} /><strong>Step 5 Preview Judge</strong><span>{session?.liveStep5 ? 'Live turn completed' : config.liveAvailable ? 'Key configured · connection unverified' : hostingPreview ? 'Coming soon' : 'Setup needed'}</span></p><p><span className={`status-dot ${config.voiceAvailable ? 'connected' : ''}`} /><strong>StepFun speech</strong><span>{config.voiceAvailable ? 'Configured' : hostingPreview ? 'Coming soon' : 'Setup needed'}</span></p><details><summary>Developer setup</summary><p>Copy <code>.env.example</code> to <code>.env</code>. Set <code>STEPFUN_API_KEY</code> for live study and voice. Restart the server. Keys stay server-side.</p></details></div><div className="privacy-note"><ShieldCheck size={19} /><p>Notes, drafts, and session history are saved in this browser. The hidden StepFun Judge receives relevant notes and teacher messages. During teaching, Stu receives the conversation and a grounded director note, never the private rubric or notes. Re-learn uses a source-grounded brief. Optional voice sends requested audio or response text to StepFun. Teach Stu uses inference; it does not train or permanently learn from you. Provider retention policies still apply.</p></div>{saved && <button className="text-button danger" onClick={() => setModal('delete')}><Trash2 size={14} />Delete saved session and uploaded files</button>}</Modal>}
    {modal === 'how' && <Modal title="Understanding goes both ways." onClose={() => setModal(null)}><div className="how-content"><p><strong>1. Bring the material.</strong><br />Paste notes or upload text-based PDFs, then choose one fixed depth.</p><p><strong>2. Teach Stu.</strong><br />Explain ideas in your own words. A private Judge checks what your words actually establish; Stu asks one question at a time.</p><p><strong>3. Catch the mix-ups.</strong><br />Stu sometimes gets an idea wrong on purpose. Your job is to notice and correct it.</p><p><strong>4. Learn it back.</strong><br />Once you have taught the topic, Stu teaches it back and quizzes you with source-grounded help.</p><p><strong>Under the hood.</strong><br />StepFun’s Step 5 Preview builds the hidden rubric and judges every message. Stu replies on the faster Step 3.7 Flash, and only sees your conversation. Optional voice uses StepFun speech models.</p><p>Teach Stu does not train or fine-tune a model. Stu does not permanently learn from users.</p></div><button className="primary" onClick={() => setModal(null)}>Let’s give it a try<ArrowRight size={16} /></button></Modal>}
    {modal === 'delete' && <Modal title="Clear this topic?" onClose={() => setModal(null)}><p>This removes the saved session, uploaded PDFs, extracted text, and document cache from this browser. It does not delete your original files.</p><div className="modal-footer"><button className="outline" onClick={() => setModal(null)}>Keep my session</button><button className="danger-button" onClick={() => void erase()}>Delete session & files</button></div></Modal>}
  </div>;
}
function FlaskIcon() { return <svg width="27" height="30" viewBox="0 0 24 28" fill="none" aria-hidden="true"><path d="M8 2h8M9 2v9L3 23c-.6 1.3.2 3 2 3h14c1.8 0 2.6-1.7 2-3l-6-12V2M6 18h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>; }

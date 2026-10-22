import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ArrowLeft, ArrowRight, ArrowUp, BookOpen, Check, ChevronRight, ClipboardList, FileText, Hand, HelpCircle, Lightbulb, LoaderCircle, MessageCircle, Mic, Pause, Pencil, Plus, Presentation, Settings2, ShieldCheck, Square, Trash2, Undo2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import type { AppConfig, CharacterState, SelectionContext, StudyDocument } from '../shared/types';
import { ingestPdf, ingestText } from './lib/documents';
import { saveSession, loadSession, deleteSession } from './lib/storage';
import { TurnGate } from './lib/turnGate';
import { loopStep } from './lib/loop';
import { DocumentViewer } from './components/DocumentViewer';
import { Miso } from './components/Miso';
import { LandingFooter, LandingNav, LandingPage } from './components/Landing';
import { RichText } from './components/RichText';
import { useVoice } from './hooks/useVoice';

type Depth = 'big-picture' | 'exam-ready' | 'expert';
type Mode = 'teach' | 'relearn';
type Screen = 'welcome' | 'study' | 'recap';
type Progress = { total: number; credited: number; percent: number; mode: Mode };
type DebugEvidence = { credits: { itemId: string; quote: string }[]; revocations: { itemId: string; quote: string }[];
  problems: { type: string; description: string }[]; focus?: { type: string; anchorQuote: string; instruction: string };
  mistakeAccepted: boolean; models: { judge: string; stu: string }; durationMs: { judge: number; stu: number } };
type Message = { id: string; role: 'user' | 'assistant'; text: string; sourceIds?: string[]; debug?: DebugEvidence;
  /** Shown in the thread at once, before the server confirms it with Stu's reply. Never saved. */
  pending?: boolean;
  /** Client-only: sent or received after the re-learn flip. Never sent to the server. */
  phase?: 'relearn' };
type TopicResponse = { topicId: string; stateToken: string; progress: Progress; message?: Message; transition?: boolean; liveStep5: boolean; debug?: DebugEvidence;
  judgePending?: boolean; judgedMessageIds?: string[]; next?: 'brief' };
type SavedSession = { id: string; name: string; depth: Depth; mode: 'live' | 'demo'; sampleId?: 'analysis' | 'research';
  documents: StudyDocument[]; stateToken: string; history: Message[]; progress: Progress; liveStep5: boolean;
  documentId: string; pageIndex: number; draft: string; audioOutput: boolean; status: 'active' | 'paused' | 'completed'; updatedAt: number;
  /** Stu's reaction to the last teaching turn, derived only from the overall progress change. */
  mood?: CharacterState;
  /** Stu has answered but the Step 5 Judge has not graded the latest explanation yet. */
  judgePending?: boolean };
type FileRow = { id: string; file?: File; title: string; text?: string; size: number; state: string };
const uid = () => crypto.randomUUID();
const depthNames: Record<Depth, string> = { 'big-picture': 'Big picture', 'exam-ready': 'Exam ready', expert: 'Expert' };
const expressions: { state: CharacterState; label: string }[] = [
  { state: 'neutral', label: 'Neutral' }, { state: 'listening', label: 'Listening' }, { state: 'thinking', label: 'Thinking' },
  { state: 'speaking', label: 'Speaking' }, { state: 'puzzled', label: 'Puzzled' }, { state: 'pleased', label: 'Pleased' }, { state: 'blink', label: 'Blink' },
];
/** The Feynman loop, shown in the lesson plan. Its active step comes from local UI state only (see lib/loop). */
const loopSteps = [
  { title: 'Pick one idea', hint: 'Start with the one everything hangs on' },
  { title: 'Explain it simply', hint: 'Like Stu has never heard of it' },
  { title: 'Spot the gap', hint: 'Stu’s question shows what’s missing' },
  { title: 'Say it simpler', hint: 'Fill the gap in plainer words' },
];
const wideQuery = '(min-width: 1101px)';
const wide = () => window.matchMedia(wideQuery).matches;
/** Touch keyboards have no Shift+Enter, so there Enter starts a new line and Add to board sends. */
const coarseQuery = '(pointer: coarse)';
const coarse = () => window.matchMedia(coarseQuery).matches;
const moodCaptions: Partial<Record<CharacterState, string>> = { pleased: 'Ohh, something just clicked!', puzzled: 'Hmm… still a little confused.' };
const fallbackConfig: AppConfig = { liveAvailable: false, voiceAvailable: false, provider: 'Step 5 Preview', limits: { maxFiles: 5, maxFileBytes: 20 * 1024 * 1024, maxPages: 100, maxTextCharacters: 300000 } };
const hostingPreview = import.meta.env.VITE_HOSTING_ONLY === 'true';
const previewToken = 'hosting-preview';
const plainDocs = (docs: StudyDocument[]) => docs.map(({ blob, ...doc }) => doc);
/** An unconfirmed message goes back into the box, so a failed, cancelled or reloaded send loses nothing. */
function unsend(session: SavedSession, ids?: Set<string>): SavedSession {
  const unsent = session.history.filter(message => message.pending && (!ids || ids.has(message.id)));
  if (!unsent.length) return session;
  return { ...session, history: session.history.filter(message => !unsent.includes(message)), draft: [...unsent.map(message => message.text), session.draft.trim()].filter(Boolean).join('\n\n') };
}
async function api<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  // Slightly longer than the server's 180 s function limit so the server's own error message arrives.
  const timeout = AbortSignal.timeout(185000);
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const data = await response.json().catch(() => ({ error: 'The connection was interrupted. Your words are still here.' }));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Stu could not finish this request. Please retry.');
  return data as T;
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  // The dialog unmounts without close(), which drops focus on <body>; hand it back to whatever opened it.
  // Read during render, so StrictMode's second effect pass can't mistake a control inside the dialog for the opener.
  const [opener] = useState(() => document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
  useEffect(() => {
    ref.current?.showModal();
    return () => { const active = document.activeElement; if (opener?.isConnected && (!active || active === document.body)) opener.focus({ preventScroll: true }); };
  }, [opener]);
  return <dialog ref={ref} className="modal" onCancel={onClose} onClick={event => { if (event.target === ref.current) onClose(); }}>
    <div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>{children}
  </dialog>;
}
function JudgePanel({ debug }: { debug: DebugEvidence }) {
  return <details className="judge-evidence"><summary>Judge evidence</summary>
    {debug.credits.map((credit, index) => <p key={`credit-${index}`}><strong>Credited {credit.itemId}</strong> · “{credit.quote}”</p>)}
    {debug.revocations.map((revoke, index) => <p key={`revoke-${index}`}><strong>Revoked {revoke.itemId}</strong> · “{revoke.quote}”</p>)}
    {debug.problems.map((problem, index) => <p key={`problem-${index}`}><strong>{problem.type}</strong> · {problem.description}</p>)}
    {debug.focus && <p>Next question for Stu: {debug.focus.instruction} · “{debug.focus.anchorQuote}”</p>}
    <small>Judge {debug.models.judge} · {debug.durationMs.judge} ms</small>
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
  // Background grading by the Step 5 Judge, separate from Stu's reply so typing never cancels it.
  const [judging, setJudging] = useState(false);
  const [waitingForJudge, setWaitingForJudge] = useState(false);
  const [judgeError, setJudgeError] = useState('');
  const judgeRun = useRef<Promise<void> | null>(null);
  const [processing, setProcessing] = useState('');
  const [modal, setModal] = useState<'sample' | 'paste' | 'settings' | 'how' | 'delete' | 'expressions' | null>(null);
  const [expression, setExpression] = useState<CharacterState>('neutral');
  const [paste, setPaste] = useState('');
  const [pasteTitle, setPasteTitle] = useState('My lecture notes');
  const [tab, setTab] = useState<'notes' | 'conversation'>('conversation');
  const [sidebar, setSidebar] = useState(() => wide());
  const [isWide, setIsWide] = useState(wide);
  const [touch, setTouch] = useState(coarse);
  // The newest Stu line the teacher has had on screen; a newer one while Notes is open gets announced.
  const [boardSeen, setBoardSeen] = useState<string>();
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
  // Focus targets for controls that unmount or swap (sheet, voice, tabs), so keyboard focus never drops to <body>.
  const topicButton = useRef<HTMLButtonElement>(null);
  const planClose = useRef<HTMLButtonElement>(null);
  const teachTab = useRef<HTMLButtonElement>(null);
  const notesTab = useRef<HTMLButtonElement>(null);
  const talkButton = useRef<HTMLButtonElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const voiceCancel = useRef<HTMLButtonElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const [titleMissing, setTitleMissing] = useState(false);
  const voice = useVoice({ enabled: config.voiceAvailable, onTranscript: text => { patch({ draft: [sessionRef.current?.draft, text].filter(Boolean).join(' ') }); editor.current?.focus(); }, onError: setError });
  useEffect(() => {
    if (!hostingPreview) fetch('/api/config').then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(setConfig).catch(() => setError('The study server is unavailable. Please reload in a moment.'));
    loadSession<SavedSession>().then(value => { if (value?.stateToken && value?.progress && (hostingPreview ? value.stateToken === previewToken : value.stateToken !== previewToken)) setSaved(value); }).catch(() => setError('Local storage is unavailable. This session may not survive a refresh.'));
  }, []);
  useEffect(() => {
    const breakpoint = window.matchMedia(wideQuery); const pointer = window.matchMedia(coarseQuery);
    const changed = () => { setSidebar(breakpoint.matches); setIsWide(breakpoint.matches); }; const pointed = () => setTouch(pointer.matches);
    breakpoint.addEventListener('change', changed); pointer.addEventListener('change', pointed);
    return () => { breakpoint.removeEventListener('change', changed); pointer.removeEventListener('change', pointed); };
  }, []);
  useEffect(() => { if (!session) return; const settled = unsend(session); setSaveState('Saving…'); saveQueue.current = saveQueue.current.then(() => saveSession(settled)).then(() => { setSaved(settled); setSaveState('Saved on this device'); }).catch(() => setSaveState('Could not save — keep this tab open')); }, [session]);
  function patch(update: Partial<SavedSession>) { setSession(current => current ? { ...current, ...update, updatedAt: Date.now() } : current); }
  function interrupt() {
    gate.current.cancel(); setBusy(false); setWaitingForJudge(false); voice.cancelRecording(); voice.stopPlayback();
    const current = sessionRef.current; const restored = current && unsend(current);
    if (restored && restored !== current) { setSession(restored); sessionRef.current = restored; }
  }
  // Reading the notes leaves a reply in flight alone; only voice stops.
  function stopVoice() { voice.cancelRecording(); voice.stopPlayback(); }
  /** After a control unmounts or turns disabled under the keyboard, put focus on a stable one instead of <body>. */
  function refocus(target: () => HTMLElement | null | undefined) {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected && !(active instanceof HTMLButtonElement && active.disabled)) return;
      target()?.focus({ preventScroll: true });
    });
  }
  // On touch screens a focused textarea pops the keyboard, so focus returns to the board's tab there instead.
  const boardFocus = () => touch ? teachTab.current : editor.current;
  function closePlan() { setSidebar(false); refocus(() => topicButton.current); }
  /** The landing page's Start teaching links: bring the start card into view and put the cursor in Topic title. */
  function goToStart() {
    const card = document.getElementById('start'); const input = titleInput.current; if (!card || !input) return;
    // Focus first, then scroll: focusing during a smooth scroll cancels it in real browsers.
    input.focus({ preventScroll: true });
    const nav = document.querySelector('.lp-nav')?.getBoundingClientRect().bottom ?? 0; const box = card.getBoundingClientRect();
    // Also scroll when the card starts low on the screen, so the depth select and drop zone come into view too.
    if (box.top < nav || box.top > window.innerHeight * 0.4 || input.getBoundingClientRect().bottom > window.innerHeight) card.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  /** The "say it simpler" step: bring your last explanation back to the writing line to rework it. */
  function rewriteLast() {
    const current = sessionRef.current; if (!current) return;
    const last = [...current.history].reverse().find(message => message.role === 'user' && !message.pending);
    if (!last) return;
    patch({ draft: last.text });
    requestAnimationFrame(() => { const box = editor.current; if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } });
  }
  function navigate(documentId: string, pageIndex: number) { stopVoice(); patch({ documentId, pageIndex }); setSelection(null); setHighlights([]); }
  function showSources(ids: string[]) {
    const current = sessionRef.current; if (!current) return;
    const span = current.documents.flatMap(document => document.spans).find(item => ids.includes(item.id));
    if (span) { stopVoice(); patch({ documentId: span.documentId, pageIndex: span.pageIndex }); setHighlights(ids); setTab('notes'); if (!wide()) setSidebar(false); if (screen === 'recap') setScreen('study'); }
  }
  function sourceLabel(ids: string[]) {
    const current = sessionRef.current ?? saved;
    const span = current?.documents.flatMap(document => document.spans).find(item => ids.includes(item.id));
    if (!span) return 'Source';
    const document = current?.documents.find(item => item.id === span.documentId);
    return `${document?.name.replace(/\.pdf$/i, '') ?? 'Notes'} · ${document?.kind === 'text' ? 'section' : 'p.'} ${span.pageIndex + 1}`;
  }
  function sourceSnippet(id: string) {
    const text = (sessionRef.current ?? saved)?.documents.flatMap(document => document.spans).find(item => item.id === id)?.text.replace(/\s+/g, ' ').trim() ?? '';
    return text.length > 70 ? `${text.slice(0, 70).replace(/\s\S*$/, '')}…` : text;
  }
  const citations = (ids: string[]) => {
    const unique = [...new Set(ids)].slice(0, 3); const labels = unique.map(id => sourceLabel([id]));
    // Several passages on one page get a number, and every chip is named by the passage it opens.
    return <div className="citations">{unique.map((id, index) => {
      const repeats = labels.filter(label => label === labels[index]).length;
      const label = repeats > 1 ? `${labels[index]} · passage ${labels.slice(0, index + 1).filter(item => item === labels[index]).length}` : labels[index];
      const snippet = sourceSnippet(id);
      return <button key={id} aria-label={snippet ? `${label}: “${snippet}”` : undefined} title={snippet ? `“${snippet}”` : undefined} onClick={() => showSources([id])}><BookOpen size={13} aria-hidden="true" />{label}<ChevronRight size={12} aria-hidden="true" /></button>;
    })}</div>;
  };
  function addFiles(files: File[]) {
    setError(''); const available = config.limits.maxFiles - rows.length;
    const valid = files.filter(file => { if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Choose a text-based PDF, or use Paste notes.'); return false; } if (file.size > config.limits.maxFileBytes) { setError(`${file.name} exceeds the file limit.`); return false; } return true; });
    if (valid.length > available) setError(`You can add up to ${config.limits.maxFiles} documents.`);
    setRows(current => [...current, ...valid.slice(0, Math.max(0, available)).map(file => ({ id: uid(), file, title: file.name, size: file.size, state: 'Ready to read' }))]);
  }
  /** talkOnly: no notes; the hidden Judge grades from Step 5 Preview's own knowledge. */
  async function prepare(sampleId?: 'analysis' | 'research', talkOnly = false) {
    if (!sampleId && !title.trim()) {
      // Point at the field itself; a banner at the top of the page is easy to miss from the buttons below.
      // Focus first, then jump: focusing during a smooth scroll cancels it in real browsers.
      // flushSync: the field is aria-invalid and described by the error before focus lands, so screen readers say why.
      flushSync(() => setTitleMissing(true)); titleInput.current?.focus({ preventScroll: true }); titleInput.current?.scrollIntoView({ block: 'center' });
      return;
    }
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
        setSession(next); sessionRef.current = next; setScreen('study'); setTab('notes'); setSidebar(wide()); setRows([]); setHighlights([]); setSelection(null); setError(errors.join('\n'));
        return;
      }
      setProcessing(talkOnly ? 'Getting Stu ready… this can take up to a minute.' : 'Building a private study plan… this can take up to a minute.');
      const result = await api<TopicResponse>('/api/topic', { title: name, depth, documents: plainDocs(docs), mode: sampleId ? 'demo' : 'live', sampleId }, ticket.signal);
      if (!gate.current.current(ticket.revision)) return;
      const next: SavedSession = { id: result.topicId, name, depth, mode: sampleId ? 'demo' : 'live', sampleId, documents: docs,
        stateToken: result.stateToken, history: result.message ? [result.message] : [], progress: result.progress, liveStep5: false,
        documentId: docs[0]?.id ?? '', pageIndex: 0, draft: '', audioOutput: false, status: 'active', updatedAt: Date.now() };
      setSession(next); sessionRef.current = next; setScreen('study'); setTab('conversation'); setSidebar(wide()); setRows([]); setHighlights([]); setSelection(null); setError(errors.join('\n'));
    } catch (cause) { if (gate.current.current(ticket.revision)) setError(cause instanceof Error ? cause.message : 'Could not prepare this topic.'); }
    finally { if (gate.current.current(ticket.revision)) { setBusy(false); setProcessing(''); } }
  }
  async function teach() {
    if (hostingPreview) return;
    const start = sessionRef.current; const text = start?.draft.trim();
    if (!start || !text || start.history.some(message => message.pending)) return;
    voice.cancelRecording(); voice.stopPlayback(); const ticket = gate.current.begin(); const turnId = uid(); const messageId = uid(); setBusy(true); setError('');
    // Client-only styling tag: after the re-learn flip, Stu writes on the board and your answers are notes.
    const phase = start.progress.mode === 'relearn' ? 'relearn' as const : undefined;
    // The message shows as sent right away; Stu's reply confirms it.
    let failed = false;
    const sent: SavedSession = { ...start, history: [...start.history, { id: messageId, role: 'user', text, pending: true, ...(phase && { phase }) }], draft: '',
      // Stu's mood belongs to the previous explanation; it waits for this one to be graded.
      mood: undefined, updatedAt: Date.now() };
    setSession(sent); sessionRef.current = sent;
    try {
      // The next reply must build on the latest grading, so let a running grading land first.
      if (judgeRun.current) { setWaitingForJudge(true); await judgeRun.current; setWaitingForJudge(false); }
      ticket.signal.throwIfAborted();
      const current = sessionRef.current; if (current?.id !== start.id) return;
      const result = await api<TopicResponse>('/api/teach', { topicId: current.id, stateToken: current.stateToken, documents: plainDocs(current.documents), turnId, messageId, revision: ticket.revision, text }, ticket.signal);
      const latest = sessionRef.current;
      if (!gate.current.current(ticket.revision) || latest?.id !== current.id || result.topicId !== current.id) return;
      const history = latest.history.map(message => message.id === messageId ? { id: messageId, role: 'user' as const, text, ...(phase && { phase }) } : message);
      const reply = result.message && (result.progress.mode === 'relearn' ? { ...result.message, phase: 'relearn' as const } : result.message);
      const next: SavedSession = { ...latest, stateToken: result.stateToken, progress: result.progress, liveStep5: latest.liveStep5 || (latest.mode === 'live' && result.liveStep5),
        judgePending: Boolean(result.judgePending), history: [...history, ...(reply ? [reply] : [])], updatedAt: Date.now() };
      setSession(next); sessionRef.current = next;
      if (next.audioOutput && config.voiceAvailable && result.message) void voice.speak(result.message.text);
      if (result.judgePending) void runJudge();
    } catch (cause) { if (gate.current.current(ticket.revision)) { failed = true; setError(cause instanceof Error ? cause.message : 'The connection was interrupted. Your words are back in the box.'); } }
    finally {
      setWaitingForJudge(false);
      if (gate.current.current(ticket.revision)) setBusy(false);
      // Still unconfirmed here means it failed or was cancelled: put the words back.
      const latest = sessionRef.current;
      if (latest?.id === start.id) { const restored = unsend(latest, new Set([messageId])); if (restored !== latest) { setSession(restored); sessionRef.current = restored; } }
      if (failed) refocus(boardFocus);
    }
  }
  /** Step 5 Judge grades what Stu already answered; on completion a second call brings Stu's teach-back. */
  function runJudge(): Promise<void> {
    if (judgeRun.current) return judgeRun.current;
    const run = (async () => {
      setJudging(true); setJudgeError('');
      try {
        for (let step = 0; step < 2; step++) {
          const before = sessionRef.current; if (!before) return;
          const result = await api<TopicResponse>('/api/judge', { topicId: before.id, stateToken: before.stateToken, documents: plainDocs(before.documents) });
          const latest = sessionRef.current;
          // Replies wait for grading, so the token only changes if the user left or started another topic.
          if (!latest || latest.id !== before.id || latest.stateToken !== before.stateToken) return;
          // Stu's face reacts to the overall bar only, so it never hints at which idea was credited.
          const mood: CharacterState = result.progress.credited > latest.progress.credited ? 'pleased' : result.progress.mode === 'teach' ? 'puzzled' : latest.mood ?? 'neutral';
          const judged = new Set(result.judgedMessageIds ?? []);
          const history = latest.history.map(message => config.judgeDebugAvailable && result.debug && judged.has(message.id) ? { ...message, debug: result.debug } : message);
          const brief = result.message && (result.progress.mode === 'relearn' ? { ...result.message, phase: 'relearn' as const } : result.message);
          const next: SavedSession = { ...latest, stateToken: result.stateToken, progress: result.progress, mood, judgePending: result.next === 'brief',
            liveStep5: latest.liveStep5 || (latest.mode === 'live' && result.liveStep5), history: brief ? [...history.filter(message => !message.pending), brief, ...history.filter(message => message.pending)] : history, updatedAt: Date.now() };
          setSession(next); sessionRef.current = next;
          if (result.message && next.audioOutput && config.voiceAvailable) void voice.speak(result.message.text);
          if (result.next !== 'brief') return;
        }
      } catch (cause) {
        // Nothing is lost: the server keeps the message queued and grades it with the next one.
        setJudgeError(cause instanceof Error ? cause.message : 'Stu could not check that explanation yet.');
      } finally { setJudging(false); judgeRun.current = null; }
    })();
    judgeRun.current = run;
    return run;
  }
  function pause() { interrupt(); patch({ status: 'paused' }); setScreen('welcome'); setError(''); }
  function resume() { if (!saved) return; interrupt(); setSession(saved); sessionRef.current = saved; setScreen('study'); setTab(hostingPreview ? 'notes' : 'conversation'); setError(''); if (saved.judgePending && !hostingPreview) void runJudge(); }
  async function erase() { const id = sessionRef.current?.id ?? saved?.id; if (id && !hostingPreview) void fetch(`/api/session/${id}`, { method: 'DELETE' }).catch(() => {}); interrupt(); setSession(null); sessionRef.current = null; setSaved(null); await saveQueue.current; await deleteSession(); setRows([]); setScreen('welcome'); setModal(null); setError(''); }
  const inWorkspace = screen === 'study';
  const relearn = session?.progress.mode === 'relearn';
  const latest = session?.history.filter(message => message.role === 'assistant').at(-1);
  const modeLabel = relearn ? 'Re-learn' : 'Teaching';
  const stuState: CharacterState = voice.recording ? 'listening' : voice.speaking ? 'speaking' : busy || waitingForJudge || voice.transcribing ? 'thinking' : session?.draft.trim() ? 'listening' : session?.mood ?? 'neutral';
  // Stu answered while the Notes tab was open: say so, since the board's live log is not on screen.
  const unseenReply = inWorkspace && !hostingPreview && tab === 'notes' && Boolean(latest) && latest?.id !== boardSeen;
  const stuCaption = voice.recording ? 'Stu is listening…' : voice.transcribing ? 'Transcribing your explanation…' : voice.speaking ? 'Speaking · AI-generated voice' : waitingForJudge ? 'Still thinking about your last explanation…' : busy ? 'Stu is thinking…'
    : unseenReply ? 'Stu wrote back on the board.' : (session?.mood && moodCaptions[session.mood]) || (relearn ? 'Your turn to be the student.' : 'Earnest. A little confused.');
  useEffect(() => { const element = thread.current; if (element) element.scrollTop = element.scrollHeight; }, [session?.history.length, busy, tab, inWorkspace]);
  useEffect(() => { if (inWorkspace && tab === 'conversation') setBoardSeen(latest?.id); }, [inWorkspace, tab, latest?.id]);
  const sheet = sidebar && !isWide;
  // The lesson plan is a sheet below the desktop breakpoint: focus moves into it and the classroom behind it goes inert.
  useEffect(() => { if (sheet && inWorkspace) planClose.current?.focus({ preventScroll: true }); }, [sheet]);
  // Voice controls swap in place (Start explaining → I’m done → Cancel transcription), so focus follows the one showing.
  const voicePhase = voice.recording ? 'recording' : voice.transcribing ? 'transcribing' : voice.requestingPermission ? 'permission' : 'idle';
  const lastVoicePhase = useRef(voicePhase);
  useEffect(() => {
    if (lastVoicePhase.current === voicePhase) return; lastVoicePhase.current = voicePhase;
    refocus(() => voicePhase === 'recording' ? doneButton.current : voicePhase === 'idle' ? talkButton.current : voiceCancel.current);
  }, [voicePhase]);
  const talking = voice.speaking || voice.speechLoading;
  const lastTalking = useRef(talking);
  useEffect(() => {
    if (lastTalking.current === talking) return; lastTalking.current = talking;
    refocus(() => document.querySelector<HTMLButtonElement>('.desk-tools .desk-tool:last-child'));
  }, [talking]);
  // Safari and Firefox have no field-sizing yet: grow the writing line with its text, up to its max-height.
  useLayoutEffect(() => {
    const box = editor.current; if (!box || CSS.supports('field-sizing', 'content')) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, parseFloat(getComputedStyle(box).maxHeight) || Infinity)}px`;
  }, [session?.draft, tab, inWorkspace]);
  const thinking = busy || waitingForJudge;
  const capturing = voice.recording || voice.transcribing || voice.requestingPermission;
  const messages = session?.history ?? [];
  const teachCount = messages.filter(message => message.role === 'user' && message.phase !== 'relearn').length;
  const rounds = messages.filter(message => message.role === 'user' && message.phase !== 'relearn' && !message.pending).length;
  const lastTaught = [...messages].reverse().find(message => message.role === 'user' && !message.pending);
  const firstRelearn = messages.findIndex(message => message.phase === 'relearn');
  const step = loopStep({ rounds, writing: Boolean(session?.draft.trim()) || capturing, thinking });
  const canRewrite = !relearn && !thinking && !capturing && !session?.draft.trim() && Boolean(lastTaught);
  const placeholder = relearn ? 'Answer Stu’s question in your own words…' : thinking ? 'Stu is reading. Start your next idea if you like…' : rounds === 0 ? 'Explain it like Stu’s never heard of it…' : 'Fill Stu’s gap in plainer words…';
  const hint = voice.transcribing ? 'Review the transcript before it goes up.' : `${touch ? `${relearn ? 'Answer Stu' : 'Add to board'} when you’re ready` : `Enter to ${relearn ? 'answer' : 'add'} · Shift+Enter for a new line`}${config.voiceAvailable ? ' · talk up to 3 min' : ''}`;
  // Stu's doodle reacts to the overall mood only, never to which idea was credited, and only once the latest explanation is graded.
  const doodle = !relearn && !thinking && !capturing && !judging && !session?.judgePending && !voice.speaking && (session?.mood === 'pleased' || session?.mood === 'puzzled');
  let entryNumber = 0;
  const boardRows = messages.map((message, index) => {
    const user = message.role === 'user';
    const onBoard = user !== (message.phase === 'relearn'); // whoever is teaching writes on the board
    if (user && message.phase !== 'relearn') entryNumber++;
    const extras = <>{relearn && !user && message.sourceIds?.length ? citations(message.sourceIds) : null}{showJudgeEvidence && user && message.debug && <JudgePanel debug={message.debug} />}</>;
    return <Fragment key={message.id}>
      {index === firstRelearn && <div className="phase-divider" role="separator" aria-label="Stu’s turn at the board">Stu’s turn at the board</div>}
      {onBoard
        ? <div className={`message-row ${user ? 'student-message' : 'stu-message by-stu'} board-entry${message.pending ? ' is-pending' : ''}`}>
            <span className="entry-margin" aria-hidden="true">{user ? entryNumber : 'Stu'}</span>
            <div className="entry-body"><span className="visually-hidden">{user ? 'You:' : 'Stu:'}</span><div className="message-bubble"><RichText text={message.text} /></div>{extras}</div>
          </div>
        : <div className={`message-row ${user ? 'student-message your-answer' : 'stu-message'} stu-note${message.pending ? ' is-pending' : ''}`}>
            <span className="note-tag">{user ? 'Your answer' : <><Hand size={12} aria-hidden="true" />Stu asks</>}</span>
            <div className="message-bubble"><RichText text={message.text} /></div>{extras}
          </div>}
    </Fragment>;
  });
  return <div className={`app ${inWorkspace ? 'workspace-app' : ''}${screen === 'welcome' ? ' landing-app' : ''}`}>
    {screen === 'welcome' ? <LandingNav hostingPreview={hostingPreview} onStart={goToStart} onSample={() => setModal('sample')} onSettings={() => setModal('settings')} /> : <header className="topbar"><button className="brand" onClick={() => { if (inWorkspace) pause(); else setScreen('welcome'); }} aria-label="Teach Stu home"><span className="brand-dot" />teach stu</button>
      {session ? <><span className="header-divider" /><span className="collection-title">{session.name}</span>{session.mode === 'demo' && <span className="mode-badge demo">{hostingPreview ? 'Sample notes' : 'Sample demo'}</span>}{session.liveStep5 && <span className="live-badge" role="status">Step 5 Preview · Live</span>}</> : <span className="brand-tagline">If you can teach it, you know it.</span>}
      <div className="header-actions">{inWorkspace ? <><span className="save-indicator"><Check size={13} />{saveState}</span><button className="quiet small" onClick={pause}><Pause size={15} /><span>{hostingPreview ? 'Close notes' : 'Pause session'}</span></button>{!hostingPreview && <button className="outline small" onClick={() => { interrupt(); patch({ status: 'completed' }); setScreen('recap'); }}><span>End<span className="end-word"> session</span></span><ArrowUp className="diagonal-arrow" size={14} /></button>}</> : <button className="quiet" onClick={() => setModal('how')}>How it works<HelpCircle size={16} /></button>}<button className="icon-button" aria-label="Study settings" onClick={() => setModal('settings')}><Settings2 size={19} /></button></div>
    </header>}
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}><X size={16} /></button></div>}

    {screen === 'welcome' && <><LandingPage hostingPreview={hostingPreview} limits={config.limits} onStart={goToStart} onSample={() => setModal('sample')}
      resume={saved && <div className="resume-strip" role="region" aria-label="Saved session"><div><span className="eyebrow">RIGHT WHERE YOU LEFT OFF</span><strong>{saved.name}</strong><span>{hostingPreview ? 'Notes preview' : `${saved.mode === 'demo' ? 'Sample demo · ' : ''}${saved.progress.percent}% overall progress · ${depthNames[saved.depth]}`}</span></div><button className="outline" onClick={resume}>{hostingPreview ? 'Reopen notes' : 'Resume session'}<ArrowRight size={16} /></button></div>}
      startCard={<section className={`upload-card ${dragging ? 'dragging' : ''}`} aria-label="Start a topic" onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) addFiles(Array.from(event.dataTransfer.files)); }}>
        <div className="upload-topline"><h2>Start with what you’re studying</h2><span className="local-note"><ShieldCheck size={14} />No account needed</span></div>
        <div className="topic-fields"><label>Topic title<input ref={titleInput} aria-label="Topic title" aria-invalid={titleMissing} aria-describedby={titleMissing ? 'title-missing' : undefined} value={title} onChange={event => { setTitle(event.target.value); setTitleMissing(false); }} placeholder="e.g. Sequences and convergence" maxLength={160} /></label><label>Teaching depth<select aria-label="Teaching depth" value={depth} onChange={event => setDepth(event.target.value as Depth)}><option value="big-picture">Big picture · gist and plain language</option><option value="exam-ready">Exam ready · precise mechanisms</option><option value="expert">Expert · limitations and formal details</option></select></label>{titleMissing && <small id="title-missing" className="field-error">Give your topic a title first, then pick how to start.</small>}<small>Depth stays fixed after teaching starts. Start a new topic to change it.</small></div>
        <div className="drop-target"><div className="upload-icon"><Upload size={25} strokeWidth={1.5} /></div><h3>A fresh pair of eyes on your notes.</h3><p>Drop your lecture PDFs here, or paste your notes.</p><input ref={fileInput} type="file" multiple accept="application/pdf,.pdf" className="visually-hidden" tabIndex={-1} aria-label="Choose PDF files" onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} /><div className="upload-buttons"><button className="primary" disabled={busy} onClick={() => fileInput.current?.click()}><Plus size={17} />Choose lecture notes</button><button className="text-button" disabled={busy || rows.length >= config.limits.maxFiles} onClick={() => setModal('paste')}><Pencil size={15} />Paste notes</button></div>{!hostingPreview && <button className="text-button start-talking" disabled={busy} onClick={() => void prepare(undefined, true)}>or just start talking<ArrowRight size={13} /></button>}{busy && processing && !rows.length && <span className="talk-status" role="status"><LoaderCircle className="spin" size={14} />{processing}</span>}<small>Text-based PDFs · Up to {config.limits.maxFiles} files · {Math.round(config.limits.maxFileBytes / 1024 / 1024)} MB and {config.limits.maxPages} pages each</small></div>
        {rows.length > 0 && <div className="file-list">{rows.map(row => <div className="file-row" key={row.id}><FileText size={19} /><div><strong>{row.title}</strong><small>{(row.size / 1024).toFixed(0)} KB · {row.state}</small></div><button className="icon-button" disabled={busy} aria-label={`Remove ${row.title}`} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}><X size={16} /></button></div>)}<div className="prepare-row">{processing ? <span role="status"><LoaderCircle className="spin" size={16} />{processing}</span> : <span>{rows.length} {rows.length === 1 ? 'source' : 'sources'} for this topic.</span>}{busy ? <button className="outline" onClick={() => { interrupt(); setProcessing(''); }}>Cancel processing</button> : <button className="primary" disabled={!title.trim()} onClick={() => void prepare()}>{hostingPreview ? 'Browse notes' : 'Start teaching'}<ArrowRight size={16} /></button>}</div></div>}
        <div className="sample-strip"><span>Just looking around?</span><button className="text-button" disabled={busy} onClick={() => setModal('sample')}>{hostingPreview ? 'Browse sample notes' : 'Try a sample session'}<ArrowRight size={15} /></button><span className="sample-divider">or</span><button className="text-button" disabled={busy} onClick={() => { setExpression('neutral'); setModal('expressions'); }}>Test Stu’s expressions<ArrowRight size={15} /></button></div>
      </section>} />
      <LandingFooter hostingPreview={hostingPreview} onHow={() => setModal('how')} onSample={() => setModal('sample')} onExpressions={() => { setExpression('neutral'); setModal('expressions'); }} /></>}

    {inWorkspace && session && <main className="classroom" aria-label="Teach Stu lesson">
      <div className="board-column" inert={sheet || undefined}>
        <nav className="board-tabs" aria-label="Session navigation">
          {!hostingPreview && <button ref={teachTab} type="button" aria-pressed={tab === 'conversation'} onClick={() => setTab('conversation')}><Presentation size={15} aria-hidden="true" />Teach Stu{unseenReply && <span className="tab-dot" aria-hidden="true" />}</button>}
          {session.documents.length > 0 && <button ref={notesTab} type="button" aria-pressed={tab === 'notes'} onClick={() => setTab('notes')}><BookOpen size={15} aria-hidden="true" />Notes</button>}
          <button ref={topicButton} type="button" className="board-topic" aria-expanded={sidebar} aria-controls={sidebar ? 'lesson-plan' : undefined} onClick={() => { if (sidebar) closePlan(); else setSidebar(true); }}><ClipboardList size={15} aria-hidden="true" />Topic</button>
        </nav>
        <div className={`lesson-board${hostingPreview ? ' no-ledge' : ''}`}>
          {tab === 'notes' ? <section className="notes-pane mobile-active" aria-label="Lecture notes">
              <div className="notes-heading"><span className="eyebrow">{relearn ? 'Your notes · Stu’s citations point here' : 'Your notes · Stu can’t see them'}</span><span><FileText size={13} />Original source</span></div>
              <DocumentViewer documents={session.documents} documentId={session.documentId} pageIndex={session.pageIndex} onNavigate={navigate} highlightIds={highlights} onSelection={setSelection} selection={selection} />{selection && <div className="selection-bar"><span>“{selection.text.slice(0, 90)}{selection.text.length > 90 ? '…' : ''}”</span><button className="icon-button" aria-label="Clear passage selection" onClick={() => setSelection(null)}><X size={15} /></button></div>}
              <div className="notes-foot">{!hostingPreview && <button className="text-button" onClick={() => { setTab('conversation'); refocus(boardFocus); }}><ArrowLeft size={13} />Back to the board</button>}<span>Your original stays unchanged.</span></div>
            </section>
          : <>
              <div className="board-head"><span className="eyebrow">{relearn ? 'Re-learn' : 'Today’s lesson'}</span><h2>{session.name}</h2><span className="depth-chip">{depthNames[session.depth]}</span></div>
              {relearn && <div className="transition-note transition-ribbon" role="status"><span className="ribbon-sticker" aria-hidden="true">Swap seats!</span><span>You taught Stu the whole topic. Now he’ll teach it back.</span></div>}
              <div className="board-thread" ref={thread} role="log" aria-label="Lesson board">
                {boardRows}
                {thinking && <div className="message-row stu-message stu-note pending-message"><span className="note-tag"><Hand size={12} aria-hidden="true" />Stu</span><div className="message-bubble" aria-label="Stu is thinking"><svg className="scribble" viewBox="0 0 64 16" aria-hidden="true"><path d="M2 11c5-7 9 5 14-1s9 5 14-1 9 5 14-1 9 5 14-1" /></svg><span>{waitingForJudge ? 'Still thinking about your last explanation…' : 'Stu is thinking…'}</span></div></div>}
                {!relearn && teachCount === 0 && <p className="board-empty">Start with the one idea everything else hangs on.</p>}
              </div>
              {session.mode === 'live' && !config.liveAvailable && <p className="inline-notice">Live study needs a server-side StepFun key. Your notes remain available.</p>}
              <form id="board-writing" className="writing-line" onSubmit={event => { event.preventDefault(); if (session.draft.trim() && !busy) void teach(); }}>
                <span className="entry-margin" aria-hidden="true">{relearn ? '' : teachCount + 1}</span>
                <textarea ref={editor} aria-label="Your explanation" aria-describedby="writing-hint" rows={2} enterKeyHint={touch ? 'enter' : 'send'} placeholder={placeholder} value={session.draft} onChange={event => { if (voice.recording || voice.transcribing || voice.requestingPermission) voice.cancelRecording(); patch({ draft: event.target.value }); }} onKeyDown={event => {
                  if (event.key === 'Escape' && talking) { event.preventDefault(); voice.stopPlayback(); return; }
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                  // Touch keyboards have no Shift+Enter: there Enter is a new line, and Add to board (or Ctrl/Cmd+Enter) sends.
                  if (touch && !event.metaKey && !event.ctrlKey) return;
                  event.preventDefault(); if (session.draft.trim() && !busy) void teach();
                }} />
              </form>
              {judgeError && !judging && <p className="judge-retry" role="status">Couldn’t check your last explanation yet ({judgeError}) It will be checked with your next message. <button className="text-button" onClick={() => { void runJudge(); refocus(boardFocus); }}>Check now</button></p>}
              <div className="board-tools">
                <span className="visually-hidden" role="status">{voicePhase === 'recording' ? 'Recording. Choose I’m done when you finish.' : voicePhase === 'transcribing' ? 'Transcribing your explanation.' : ''}</span>
                {voice.recording ? <div className="recording-controls"><span className="recording-label"><span />Listening… {Math.floor(voice.recordingSeconds / 60)}:{String(voice.recordingSeconds % 60).padStart(2, '0')} / 3:00</span><button ref={doneButton} className="primary" onClick={() => void voice.stopRecording()}><Square size={12} fill="currentColor" aria-hidden="true" />I’m done</button><button className="text-button" onClick={voice.cancelRecording}>Cancel</button></div>
                  : <button ref={talkButton} type="button" className="talk-button" disabled={busy || voice.transcribing || voice.requestingPermission} onClick={() => { setError(''); void voice.startRecording(); }}><Mic size={17} />Start explaining</button>}
                {(voice.transcribing || voice.requestingPermission) && <button ref={voiceCancel} type="button" className="text-button" onClick={voice.cancelRecording}><X size={13} aria-hidden="true" />{voice.transcribing ? 'Cancel transcription' : 'Cancel microphone request'}</button>}
                {canRewrite && <button type="button" className="text-button rewrite-button" title="Rewrite my last idea" onClick={rewriteLast}><Pencil size={14} aria-hidden="true" /><span>Rewrite my last idea</span></button>}
                {busy && <button type="button" className="text-button" onClick={() => { interrupt(); refocus(boardFocus); }}><Undo2 size={13} aria-hidden="true" />Cancel · keep my words</button>}
                <small id="writing-hint" className="tool-hint">{hint}</small>
                {/* aria-disabled, not disabled: a keyboard send keeps focus here instead of dropping it to <body>. The form guards the send. */}
                <button type="submit" form="board-writing" className="add-to-board" aria-disabled={busy || !session.draft.trim()}>{relearn ? 'Answer Stu' : 'Add to board'}{!touch && <kbd aria-hidden="true">↵</kbd>}</button>
              </div>
            </>}
        </div>
        {!hostingPreview && <div className="board-ledge">
          <span className="ledge-label">{relearn ? 'Re-learn · Stu teaches it back' : 'Teaching progress'}</span>
          {/* The grading note sits under the bar, so the bar never changes width while its fill moves. */}
          <span className="ledge-track"><progress aria-label="Overall topic progress" value={session.progress.credited} max={session.progress.total || 1} />{judging && <span className="ledge-checking">Checking your explanation…</span>}</span>
          <strong className="ledge-value"><span className="ledge-depth">{depthNames[session.depth]} · </span>{session.progress.percent}% taught</strong>
          <span className="markers" aria-hidden="true"><i /><i /></span>
        </div>}
      </div>
      <aside className="desk-column" aria-label="Stu" inert={sheet || undefined}>
        <div className="stu-desk" data-mood={session.mood ?? 'neutral'}>
          <p className="thought character-state">{stuCaption}</p>
          <div className="desk-stu"><Miso size={150} state={stuState} />{doodle && <span key={`${session.mood}-${session.progress.credited}`} className="desk-doodle" data-kind={session.mood} aria-hidden="true">{session.mood === 'pleased' ? <><Lightbulb size={12} />Click!</> : '?'}</span>}</div>
          <div className="desk-top" aria-hidden="true" />
          <span className="desk-mode">{relearn ? 'Stu teaches back' : 'Stu is learning'}</span>
          <span className="visually-hidden" role="status">{unseenReply ? 'Stu wrote back on the board.' : ''}</span>
          {!hostingPreview && <div className={`desk-tools${talking ? ' is-speaking' : ''}`}>
            <button type="button" className="desk-tool icon-only" aria-label={session.audioOutput ? 'Mute spoken responses' : 'Enable spoken responses'} title={session.audioOutput ? 'Mute spoken responses' : 'Enable spoken responses'} onClick={() => { voice.stopPlayback(); if (!config.voiceAvailable) { setError('Spoken responses are unavailable right now. Typing is fully available.'); return; } patch({ audioOutput: !session.audioOutput }); }}>{session.audioOutput ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
            {talking
              ? <button type="button" className="desk-tool stop-speaking" onClick={voice.stopPlayback}><Square size={11} fill="currentColor" aria-hidden="true" /><span>Stop speaking</span></button>
              : latest && config.voiceAvailable && <button type="button" className="desk-tool" onClick={() => void voice.speak(latest.text)}><Volume2 size={14} /><span>Read aloud</span></button>}
          </div>}
        </div>
      </aside>
      {sheet && <div className="plan-scrim" aria-hidden="true" onClick={closePlan} />}
      {sidebar && <section id="lesson-plan" className="lesson-plan" aria-label="Lesson plan" role={sheet ? 'dialog' : undefined} aria-modal={sheet || undefined} onKeyDown={event => { if (sheet && event.key === 'Escape') { event.stopPropagation(); closePlan(); } }}><div className="plan-scroll">
        <div className="plan-head"><h2 className="plan-label">Lesson plan</h2><button ref={planClose} type="button" className="icon-button" aria-label="Close topic panel" onClick={closePlan}><X size={16} /></button></div>
        <p className="plan-topic">{session.name}</p>
        <p className="plan-sources">{session.documents.length ? `${session.documents.length} ${session.documents.length === 1 ? 'source' : 'sources'}` : 'No notes · judged from general knowledge'}</p>
        {session.mode === 'demo' && <p className="demo-explainer">{hostingPreview ? 'Sample notes' : 'Sample demo'}<br /><span>{hostingPreview ? 'Read the source material in this preview.' : 'Guided fixture responses, not live AI assessment.'}</span></p>}
        {!hostingPreview && <div className="feynman-loop"><h3 className="loop-title">The Feynman loop</h3>
          <ol>{loopSteps.map((item, index) => { const n = index + 1; const done = relearn || n < step; return <li key={item.title} className={done ? 'done' : ''} aria-current={!relearn && n === step ? 'step' : undefined}><span className="loop-dot" aria-hidden="true">{done ? <Check size={12} /> : n}</span><span><strong>{item.title}</strong><small>{item.hint}</small></span></li>; })}</ol>
          {relearn && <p className="loop-swap">Now swap seats: Stu teaches it back, and you answer his questions.</p>}
        </div>}
        <div className="topic-panel">{!hostingPreview && <><p><strong>Depth</strong><span>{depthNames[session.depth]} · fixed</span></p><p><strong>Progress</strong><span>{session.progress.percent}% overall</span></p><p><strong>Mode</strong><span>{modeLabel}</span></p></>}{session.documents.length > 0 && <button className="text-button" onClick={() => { setTab('notes'); if (!wide()) { setSidebar(false); refocus(() => notesTab.current); } }}>Open notes<ArrowRight size={14} /></button>}</div>
        <p className="plan-tip">Stu learns only from your words. Take one idea at a time.</p>
      </div></section>}
    </main>}

    {screen === 'recap' && session && <main className="recap-page"><div className="recap-heading"><Miso size={132} state="pleased" /><span className="eyebrow orange">CLASS DISMISSED</span><h1>Here’s what you<br />worked through.</h1><p>{session.mode === 'demo' ? 'A guided sample session.' : 'Your words, your notes, and Stu’s questions.'}</p></div><div className="recap-facts"><span><MessageCircle size={17} />{session.history.filter(message => message.role === 'user').length} contributions</span><span><BookOpen size={17} />{session.documents.length} sources</span><span><Check size={17} />{session.progress.percent}% overall</span></div><section className="next-session"><span className="eyebrow">NEXT TIME, START HERE</span><h2>{relearn ? 'Keep answering Stu’s quiz.' : 'Keep teaching Stu in your own words.'}</h2><p>Your notes and conversation are saved on this device.</p><button className="text-button" onClick={() => { patch({ status: 'active' }); setScreen('study'); setTab('conversation'); }}>Continue session<ArrowRight size={16} /></button></section><div className="recap-bottom"><button className="primary" onClick={() => setScreen('welcome')}>Continue next time<ArrowRight size={16} /></button><button className="text-button" onClick={() => { setScreen('welcome'); setRows([]); }}>Start a new topic</button><button className="text-button danger" onClick={() => setModal('delete')}><Trash2 size={14} />Delete session & files</button></div></main>}

    {modal === 'sample' && <Modal title={hostingPreview ? 'Browse sample notes.' : 'A small taste of Teach Stu.'} onClose={() => setModal(null)}><p className="modal-description">{hostingPreview ? 'Choose original synthetic notes to explore. Sample conversations will be available after the study server is deployed.' : 'Choose a subject and try the whole teaching loop. These are original synthetic notes with guided demo responses.'}</p><div className="sample-options"><button onClick={() => void prepare('analysis')}><span className="sample-symbol">∑</span><span><strong>Sequences & convergence</strong><small>Real analysis · 4 pages</small><p>Bounds, limits, and the conditions that matter.</p></span><ArrowRight size={19} /></button><button onClick={() => void prepare('research')}><span className="sample-symbol"><FlaskIcon /></span><span><strong>Experiments & causal claims</strong><small>Research methods · 2 pages</small><p>What a study can—and can’t—tell us.</p></span><ArrowRight size={19} /></button></div><p className="subtle-note">{hostingPreview ? 'Note browsing works in this preview. Interactive study is coming soon.' : 'Always labeled Sample demo. Your own notes use live AI only.'}</p></Modal>}
    {modal === 'expressions' && <Modal title="Stu’s expressions." onClose={() => setModal(null)}><p className="modal-description">Preview how Stu reacts while you teach. Click Stu for a boing.</p><div className="expression-stage"><Miso size={170} state={expression} /></div><div className="mock-controls expression-controls" aria-label="Stu expression controls">{expressions.map(item => <button key={item.state} aria-pressed={expression === item.state} onClick={() => setExpression(item.state)}>{item.label}</button>)}</div></Modal>}
    {modal === 'paste' && <Modal title="Bring your notes, in your words." onClose={() => setModal(null)}><form onSubmit={event => { event.preventDefault(); if (paste.trim().length < 40) { setError('Paste at least 40 characters of course content.'); return; } const name = pasteTitle.trim() || 'Pasted notes'; setRows(current => [...current, { id: uid(), title: name, text: paste, size: new Blob([paste]).size, state: 'Ready to read' }]); if (!title.trim()) setTitle(name); setPaste(''); setModal(null); }}><label className="field-label">Title<input value={pasteTitle} onChange={event => setPasteTitle(event.target.value)} required /></label><label className="field-label">Lecture text<textarea className="paste-editor" placeholder="Paste a definition, a lecture, or the section you keep rereading…" maxLength={config.limits.maxTextCharacters} value={paste} onChange={event => setPaste(event.target.value)} required /></label><div className="modal-footer"><small>{paste.length.toLocaleString()} / {config.limits.maxTextCharacters.toLocaleString()} characters</small><button className="primary" disabled={paste.trim().length < 40}>Add these notes<ArrowRight size={15} /></button></div></form></Modal>}
    {modal === 'settings' && <Modal title="Settings" onClose={() => setModal(null)}>{session && <><div className="setting-row"><div><strong>Teaching depth</strong><p>Fixed for this topic. Start a new topic to change it.</p></div><span>{depthNames[session.depth]}</span></div><div className="setting-row"><div><strong>Spoken responses</strong><p>{config.voiceAvailable ? 'AI-generated voice. You can stop it at any time.' : hostingPreview ? 'Voice is coming soon with the study server.' : 'Connect speech to talk and listen. Typing always works.'}</p></div><button className="outline" disabled={!config.voiceAvailable} onClick={() => { voice.stopPlayback(); patch({ audioOutput: !session.audioOutput }); }}>{session.audioOutput ? 'On' : 'Off'}</button></div></>}{config.judgeDebugAvailable && <div className="setting-row"><div><strong>Show Judge Evidence</strong><p>Show verified quotes and safe verdict summaries under your turns.</p></div><button className="outline" aria-pressed={showJudgeEvidence} onClick={() => setShowJudgeEvidence(!showJudgeEvidence)}>{showJudgeEvidence ? 'On' : 'Off'}</button></div>}<div className="provider-status"><span className="eyebrow">CONNECTIONS</span><p><span className={`status-dot ${session?.liveStep5 ? 'connected' : ''}`} /><strong>Step 5 Preview Judge</strong><span>{session?.liveStep5 ? 'Live turn completed' : config.liveAvailable ? 'Key configured · connection unverified' : hostingPreview ? 'Coming soon' : 'Setup needed'}</span></p><p><span className={`status-dot ${config.voiceAvailable ? 'connected' : ''}`} /><strong>StepFun speech</strong><span>{config.voiceAvailable ? 'Configured' : hostingPreview ? 'Coming soon' : 'Setup needed'}</span></p><details><summary>Developer setup</summary><p>Copy <code>.env.example</code> to <code>.env</code>. Set <code>STEPFUN_API_KEY</code> for live study and voice. Restart the server. Keys stay server-side.</p></details></div><div className="privacy-note"><ShieldCheck size={19} /><p>Notes, drafts, and session history are saved in this browser. The hidden StepFun Judge receives relevant notes and teacher messages. During teaching, Stu receives the conversation and a grounded director note, never the private rubric or notes. Re-learn uses a source-grounded brief. Optional voice sends requested audio or response text to StepFun. Teach Stu uses inference; it does not train or permanently learn from you. Provider retention policies still apply.</p></div>{saved && <button className="text-button danger" onClick={() => setModal('delete')}><Trash2 size={14} />Delete saved session and uploaded files</button>}</Modal>}
    {modal === 'how' && <Modal title="The Feynman technique, with a student who asks back." onClose={() => setModal(null)}><div className="how-content"><p><strong>1. Pick one idea.</strong><br />Paste notes or upload text-based PDFs, choose one fixed depth, and start with the idea everything else hangs on.</p><p><strong>2. Explain it simply.</strong><br />Teach Stu in plain words, as if he has never heard of it. A private Judge checks what your words actually establish.</p><p><strong>3. Spot the gaps.</strong><br />Stu asks one question at a time about what your explanation left out, and sometimes gets an idea wrong on purpose. Catch it.</p><p><strong>4. Say it simpler, then swap seats.</strong><br />Fill each gap in plainer words. Once you have taught the whole topic, Stu teaches it back and quizzes you with source-grounded help.</p><p><strong>Under the hood.</strong><br />StepFun’s Step 5 Preview builds the hidden rubric and judges every message. Stu replies on the faster Step 3.7 Flash. He sees your conversation, the names of the lesson’s ideas and a one-line nudge from the Judge, never your notes or what the rubric asks for. Optional voice uses StepFun speech models.</p><p>Teach Stu does not train or fine-tune a model. Stu does not permanently learn from users.</p></div><button className="primary" onClick={() => setModal(null)}>Let’s give it a try<ArrowRight size={16} /></button></Modal>}
    {modal === 'delete' && <Modal title="Clear this topic?" onClose={() => setModal(null)}><p>This removes the saved session, uploaded PDFs, extracted text, and document cache from this browser. It does not delete your original files.</p><div className="modal-footer"><button className="outline" onClick={() => setModal(null)}>Keep my session</button><button className="danger-button" onClick={() => void erase()}>Delete session & files</button></div></Modal>}
  </div>;
}
function FlaskIcon() { return <svg width="27" height="30" viewBox="0 0 24 28" fill="none" aria-hidden="true"><path d="M8 2h8M9 2v9L3 23c-.6 1.3.2 3 2 3h14c1.8 0 2.6-1.7 2-3l-6-12V2M6 18h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>; }

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, ArrowRight, Ban, Check, CloudUpload, EyeOff, FileUp, Github, Hand, HardDrive, LayoutList, LogOut, Menu, MessageCircle, Quote, SearchCheck, Settings2, Tag, Trash2, X, type LucideIcon } from 'lucide-react';
import type { AppConfig } from '../../../shared/types';
import type { Account } from '../lib/auth';
import { AccountMenu, Avatar } from './Account';
import { Miso } from './Miso';

/** The product landing page shown on the welcome screen. App owns all state; this file is the page around the start card. */
const repo = 'https://github.com/samerrahman/AI-Hackathon-2026';
const evalLink = `${repo}/tree/main/tests/evals/stu-on-topic`;
const team = ['ruxinsheng', 'jamlol123', 'zenoro0', 'samerrahman'];
/** `lead` is hidden on narrow laptops so the nav keeps room for Try a sample. */
const sections = [{ id: 'how', label: 'How it works' }, { id: 'feynman', label: 'Feynman method', lead: 'The ' }, { id: 'honest', label: 'Honest by design' }, { id: 'faq', label: 'FAQ' }];
const desktopNav = '(min-width: 961px)';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const steps = [
  { icon: FileUp, title: 'Bring your notes', text: 'Upload text-based PDFs or paste the section you keep rereading, then pick how deep to go: big picture, exam ready or expert.' },
  { icon: MessageCircle, title: 'Teach Stu in plain words', text: 'Explain one idea at a time, as if he’s never heard of it. Type it out, or talk it through.' },
  { icon: SearchCheck, title: 'Catch his mix-ups', text: 'Stu asks about what you left out, and sometimes gets an idea wrong on purpose. Spot it and set him straight.' },
  { icon: ArrowLeftRight, title: 'He teaches it back', text: 'Once you’ve taught the whole topic, you swap seats: Stu explains it back and quizzes you, with citations to your notes.' },
];
/** Same four steps, in the same words, as the Feynman loop beside the lesson board. */
const loop = [
  { title: 'Pick one idea', you: 'Start with the one idea everything else hangs on.', stu: 'Opens with “What should I know first?” and keeps the lesson on your topic.' },
  { title: 'Explain it simply', you: 'Teach it in plain words, like he’s never heard of it.', stu: 'Has only your words to go on. He never sees your notes, so jargon won’t carry you.' },
  { title: 'Spot the gap', you: 'Notice where your explanation thins out.', stu: 'Asks one question at a time about what you left out, and plants the odd mistake for you to catch.' },
  { title: 'Say it simpler', you: 'Fill the gap in plainer words. “Rewrite my last idea” brings your last one back to rework.', stu: 'Keeps asking until it’s plain. Once the whole topic lands, he teaches it back to you.' },
];
const stats = [
  { value: '89%', label: 'of Stu’s replies stayed on the notes', was: 'was 68%' },
  { value: '0%', label: 'of his replies went off the lesson', was: 'was 14%' },
  { value: '19 of 23', label: 'tangents steered back to the lesson', was: 'was 3 of 34' },
  { value: '~6 s', label: 'median reply time', was: '6.1 s, was 6.4 s' },
];
/**
 * accounts: Google sign-in is on (config.auth), so topics are saved to the account instead of only this browser;
 * undefined while /api/config hasn't answered, when the storage card stays hidden rather than claim either.
 */
type HonestItem = { icon: LucideIcon; title: string; text: string; link?: { href: string; label: string }; pending?: boolean };
const honest = (hostingPreview: boolean, accounts: boolean | undefined): HonestItem[] => [
  { icon: EyeOff, title: 'Stu never sees your notes', text: 'While you teach, he sees your conversation, the names of the lesson’s ideas and a one-line nudge from the hidden Judge. He never sees your notes or what the rubric asks for.' },
  { icon: Quote, title: 'Credit needs your own words', text: 'The hidden Judge can only credit an idea by quoting your message word for word, and the server checks every quote.' },
  accounts === undefined
    ? { icon: HardDrive, title: 'Upfront about storage', text: 'Where your notes are kept shows here once the page has loaded.', pending: true }
    : accounts
    ? { icon: CloudUpload, title: 'Saved to your account', text: 'Notes, drafts and sessions are saved to your account, in a private database and file store that other accounts can’t read; the people who run Teach Stu can access it to operate the site. They’re cached in this browser until you sign out, and Delete my data erases them. To grade, the Judge is sent the relevant notes.' }
    : { icon: HardDrive, title: 'Saved in your browser', text: 'Notes, drafts and sessions live in this browser, with no account. The server keeps no database of your documents or chats; to grade, the Judge is sent the relevant notes.' },
  { icon: Ban, title: 'Stu doesn’t train on you', text: 'Teach Stu only uses the models. It doesn’t train or fine-tune them on what you write, though StepFun’s own retention policy still applies.' },
  { icon: Tag, title: 'Samples are labeled', text: hostingPreview ? 'Sample notes are always labeled as samples.' : 'Sample lessons use scripted replies and always say Sample demo, so you never mistake them for live grading.' },
  { icon: Github, title: 'Check it yourself', text: 'The code, the prompts and the eval scripts are on GitHub, with a write-up of how the numbers above were graded.', link: { href: repo, label: 'See the code' } },
];
const callouts = [
  { title: 'Your explanations, on the right', text: 'Each explanation you add becomes a numbered card on your side of the board.' },
  { title: 'Stu’s questions, as sticky notes', text: 'One question at a time, stuck on his side, about what your explanation left out.' },
  { title: 'One progress bar', text: 'No per-idea scores and no peeking at the checklist: just how much of the topic you’ve taught.' },
];

type NavProps = { hostingPreview: boolean; onStart: () => void; onSample: () => void; onSettings: () => void;
  /** The signed-in account, with its menu actions; null when signed out or when accounts are off. */
  account?: { user: Account; onTopics: () => void; onSignOut: () => void; onDeleteData: () => void } | null };
/** Sticky site header. Below 961px the section links fold into a menu; Start teaching always stays visible. The account menu sits in that menu on phones. */
export function LandingNav({ hostingPreview, onStart, onSample, onSettings, account }: NavProps) {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);
  const close = (returnFocus = false) => { setOpen(false); if (returnFocus) menuButton.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    firstLink.current?.focus();
    const outside = (event: PointerEvent) => { if (!header.current?.contains(event.target as Node)) setOpen(false); };
    const wide = window.matchMedia(desktopNav);
    const resized = () => { if (wide.matches) setOpen(false); };
    document.addEventListener('pointerdown', outside); wide.addEventListener('change', resized);
    return () => { document.removeEventListener('pointerdown', outside); wide.removeEventListener('change', resized); };
  }, [open]);
  const sampleLabel = hostingPreview ? 'Sample notes' : 'Try a sample';
  const startLabel = hostingPreview ? 'Get started' : 'Start teaching';
  return <><a className="lp-skip" href="#top">Skip to main content</a><header ref={header} className="lp-nav" data-open={open || undefined} data-account={account ? '' : undefined}
    onKeyDown={event => { if (open && event.key === 'Escape') { event.stopPropagation(); close(true); } }}
    onBlur={event => { if (open && !event.currentTarget.contains(event.relatedTarget as Node | null) && event.relatedTarget) setOpen(false); }}>
    <div className="lp-nav-inner">
      <button type="button" className="lp-brand" aria-label="Teach Stu home" onClick={() => { close(); window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); }}><span className="brand-dot" aria-hidden="true" />teach stu</button>
      <nav id="lp-menu" className="lp-links" aria-label="Main">
        <ul>{sections.map((section, index) => <li key={section.id}><a ref={index === 0 ? firstLink : undefined} href={`#${section.id}`} onClick={() => close()}><span>{section.lead && <span className="lp-long">{section.lead}</span>}{section.label}</span></a></li>)}</ul>
        <div className="lp-menu-extras">
          <button type="button" onClick={() => { close(true); onSample(); }}>{sampleLabel}<ArrowRight size={15} aria-hidden="true" /></button>
          <button type="button" onClick={() => { close(true); onSettings(); }}><Settings2 size={16} aria-hidden="true" />Study settings</button>
          {account && <div className="lp-menu-account" role="group" aria-label="Account">
            <p className="lp-menu-who"><Avatar account={account.user} size={30} /><span><small>Signed in as</small><strong>{account.user.email}</strong></span></p>
            <button type="button" onClick={() => { close(); account.onTopics(); }}><LayoutList size={16} aria-hidden="true" />My topics</button>
            <button type="button" onClick={() => { close(true); account.onSignOut(); }}><LogOut size={16} aria-hidden="true" />Sign out</button>
            <button type="button" className="is-danger" onClick={() => { close(true); account.onDeleteData(); }}><Trash2 size={16} aria-hidden="true" />Delete my data</button>
          </div>}
        </div>
      </nav>
      <div className="lp-nav-actions">
        <button type="button" className="lp-nav-sample" onClick={onSample}>{sampleLabel}</button>
        <a className="lp-button is-primary is-small" href="#start" onClick={event => { event.preventDefault(); close(); onStart(); }}>{startLabel}</a>
        <button type="button" className="icon-button lp-nav-settings" aria-label="Study settings" onClick={onSettings}><Settings2 size={19} aria-hidden="true" /></button>
        {account && <AccountMenu account={account.user} onTopics={account.onTopics} onSignOut={account.onSignOut} onDeleteData={account.onDeleteData} />}
        <button ref={menuButton} type="button" className="icon-button lp-menu-button" aria-label="Menu" aria-expanded={open} aria-controls="lp-menu" onClick={() => setOpen(!open)}>{open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}</button>
      </div>
    </div>
  </header></>;
}

type PageProps = { hostingPreview: boolean; limits: AppConfig['limits']; resume: ReactNode; startCard: ReactNode; onStart: () => void; onSample: () => void;
  /** Whether Google sign-in is on; undefined until /api/config answers, so no claim about accounts shows before then. */
  accounts?: boolean;
  /** My topics, shown right under the hero while signed in. */
  topics?: ReactNode };
export function LandingPage({ hostingPreview, limits, resume, startCard, onStart, onSample, accounts, topics }: PageProps) {
  useEffect(() => { const target = window.location.hash.slice(1); if (target) document.getElementById(target)?.scrollIntoView(); }, []);
  const startLabel = hostingPreview ? 'Get started' : 'Start teaching';
  const start = (className: string) => <a className={className} href="#start" onClick={event => { event.preventDefault(); onStart(); }}>{startLabel}<ArrowRight size={17} aria-hidden="true" /></a>;
  const megabytes = Math.round(limits.maxFileBytes / 1024 / 1024);
  return <main className="landing" id="top">
    <section className="lp-hero" aria-labelledby="lp-title">
      <div className="lp-container">
        {resume}
        <div className="lp-hero-grid">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">The Feynman technique, with a student who needs you</p>
            <h1 id="lp-title">Meet Stu.<br /><em>Your new AI student.</em></h1>
            <p className="lp-lede">Explain your notes to Stu in plain words. His questions show you what you haven’t explained yet.</p>
            <div className="lp-cta-row">{start('lp-button is-primary')}<button type="button" className="lp-button is-secondary" onClick={onSample}>{hostingPreview ? 'Browse the sample notes' : 'Try a sample lesson'}</button></div>
            {hostingPreview && <p className="lp-preview-note">Preview: browse the sample notes now. Teaching Stu arrives with the study server.</p>}
            <ul className="lp-trust" aria-label="At a glance" data-pending={accounts === undefined || undefined}>{(accounts ? ['Free, with Google sign-in', 'Saved to your account', 'Built on StepFun Step 5'] : ['No account', 'Notes saved in your browser', 'Built on StepFun Step 5']).map(item => <li key={item}><Check size={15} strokeWidth={2.5} aria-hidden="true" />{item}</li>)}</ul>
          </div>
          <div className="lp-start" id="start">
            <div className="lp-peek">
              <span className="lp-boing" aria-hidden="true">Click Stu. Boing!<svg viewBox="0 0 44 26" fill="none"><path d="M3 5c12-4 26 0 35 14" /><path d="M31 19l7 1 1-7" /></svg></span>
              <Miso size={132} state="neutral" />
              <span className="lp-paw is-left" aria-hidden="true" /><span className="lp-paw is-right" aria-hidden="true" />
            </div>
            {startCard}
          </div>
        </div>
      </div>
    </section>
    {topics}

    <section className="lp-section lp-preview" id="preview" aria-labelledby="lp-preview-title">
      <div className="lp-container">
        <div className="lp-section-head is-center">
          <p className="lp-eyebrow">A look inside</p>
          <h2 id="lp-preview-title">This is what a lesson looks like</h2>
          <p>A screenshot of a sample lesson: you write on the board, Stu asks back, and one bar fills as you teach.</p>
        </div>
        <figure className="lp-browser">
          <div className="lp-browser-bar" aria-hidden="true"><span className="lp-dots"><i /><i /><i /></span><span className="lp-address">teach stu · Experiments &amp; causal claims</span></div>
          <div className="lp-shot">
            {/* Phones get the board as it looks on a phone: the desktop shot shrunk to 350px is unreadable. */}
            <picture>
              <source media="(max-width: 760px)" srcSet="/assets/lesson-board-phone-780.webp 780w, /assets/lesson-board-phone-1170.webp 1170w" sizes="min(420px, calc(100vw - 42px))" width={390} height={700} />
              <img src="/assets/lesson-board-2000.webp" srcSet="/assets/lesson-board-1000.webp 1000w, /assets/lesson-board-2000.webp 2000w" sizes="(min-width: 1180px) 1100px, calc(100vw - 40px)" width={2000} height={1250} loading="lazy" decoding="async"
                alt="The Teach Stu lesson board in a sample lesson on experiments and causal claims. Numbered explanations sit on the right as cards, Stu’s questions sit on the left as yellow sticky notes, and one progress bar along the bottom reads 78% taught." />
            </picture>
            {callouts.map((callout, index) => <span key={callout.title} className={`lp-hotspot is-${index + 1}`} aria-hidden="true">{index + 1}</span>)}
          </div>
          <figcaption className="visually-hidden">The lesson board, with three numbered callouts explained below.</figcaption>
        </figure>
        <ol className="lp-callouts">{callouts.map((callout, index) => <li key={callout.title}><span className="lp-hotspot-key" aria-hidden="true">{index + 1}</span><div><h3>{callout.title}</h3><p>{callout.text}</p></div></li>)}</ol>
      </div>
    </section>

    <section className="lp-section lp-how" id="how" aria-labelledby="lp-how-title">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">How it works</p>
          <h2 id="lp-how-title">You do the teaching. Stu does the asking.</h2>
          <p>Reading your notes again feels like learning. Explaining them to someone shows you whether it is.</p>
        </div>
        <ol className="lp-steps">{steps.map(({ icon: Icon, title, text }, index) => <li key={title} className={`lp-step is-${index + 1}`}>
          <span className="lp-step-top"><span className="lp-step-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.8} /></span><span className="lp-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span></span>
          <h3>{title}</h3><p>{text}</p>
        </li>)}</ol>
      </div>
    </section>

    <section className="lp-section lp-feynman" id="feynman" aria-labelledby="lp-feynman-title">
      <div className="lp-container lp-feynman-grid">
        <div className="lp-section-head lp-feynman-intro">
          <p className="lp-eyebrow">The method</p>
          <h2 id="lp-feynman-title">The Feynman method, with someone to teach</h2>
          <p>The technique is named after Richard Feynman, the Nobel Prize–winning physicist known for explaining hard ideas in plain language. Its premise: explaining something simply is the quickest way to find out whether you really understand it.</p>
          <p>Usually you explain to an empty room. With Stu, the room asks back.</p>
        </div>
        <ol className="lp-timeline">{loop.map((item, index) => <li key={item.title}>
          <span className="lp-timeline-dot" aria-hidden="true">{index + 1}</span>
          <div className="lp-timeline-body">
            <h3>{item.title}</h3>
            <dl><div><dt>You</dt><dd>{item.you}</dd></div><div><dt>Stu</dt><dd>{item.stu}</dd></div></dl>
          </div>
        </li>)}</ol>
      </div>
    </section>

    <section className="lp-section lp-measured" id="measured" aria-labelledby="lp-measured-title">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Measured, not guessed</p>
          <h2 id="lp-measured-title">Stu stays on your lesson</h2>
          <p>We replayed lessons against the real models with simulated teachers, including ones who wander off, before and after our on-topic update.</p>
        </div>
        <ul className="lp-stats">{stats.map(stat => <li key={stat.value}><strong>{stat.value}</strong><span>{stat.label}</span><small>{stat.was}</small></li>)}</ul>
        <p className="lp-stats-caption">Measured on 12 simulated lessons, graded blind. <a href={evalLink} target="_blank" rel="noreferrer">Read the eval on GitHub<ArrowRight size={14} aria-hidden="true" /></a></p>
      </div>
    </section>

    <section className="lp-section lp-honest" id="honest" aria-labelledby="lp-honest-title">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Honest by design</p>
          <h2 id="lp-honest-title">Built so it can’t flatter you</h2>
          <p>Progress only moves when your own words earn it, and the app is upfront about what it keeps and what it sends.</p>
        </div>
        <ul className="lp-honest-grid">{honest(hostingPreview, accounts).map(({ icon: Icon, title, text, link, pending }) => <li key={title} data-pending={pending || undefined}><span className="lp-honest-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.8} /></span><h3>{title}</h3><p>{text}</p>{link && <a className="lp-more" href={link.href} target="_blank" rel="noreferrer">{link.label}<ArrowRight size={14} aria-hidden="true" /></a>}</li>)}</ul>
      </div>
    </section>

    <section className="lp-section lp-faq" id="faq" aria-labelledby="lp-faq-title">
      <div className="lp-container lp-faq-grid">
        <div className="lp-section-head">
          <p className="lp-eyebrow">FAQ</p>
          <h2 id="lp-faq-title">Questions, answered</h2>
          <p>Anything else? The code and docs are <a href={repo} target="_blank" rel="noreferrer">on GitHub</a>.</p>
        </div>
        <div className="lp-faq-list">
          <details><summary>Is it free?</summary><p>{accounts === undefined ? 'Yes. There’s no plan or payment.' : accounts ? 'Yes. There’s no plan or payment: you sign in with Google and start teaching.' : 'Yes. There’s no plan, payment or sign-up.'} Teach Stu is a hackathon project, and its code is on GitHub. Running your own copy needs your own StepFun API key.</p></details>
          <details><summary>Do I need an account?</summary><p>{accounts === undefined ? 'That depends on how this copy of Teach Stu is set up; the start card says so once the page has loaded.' : accounts ? 'Yes, a free one: sign in with Google. Your topics, notes and progress are saved to your account, so you can pick up where you left off on any device. Delete my data, in the account menu, erases them.' : 'No. Your session is saved in this browser, so you can close the tab and pick up where you left off on the same device.'}</p></details>
          <details><summary>What notes work?</summary><p>Text-based PDFs, or text you paste in. Scanned pages without a text layer can’t be read yet. You can add up to {limits.maxFiles} files of up to {megabytes} MB and {limits.maxPages} pages each, and pasted notes can run to {limits.maxTextCharacters.toLocaleString('en-US')} characters.</p></details>
          <details><summary>What does depth mean?</summary><p>It sets how much the hidden Judge needs to hear before an idea counts as taught. <strong>Big picture</strong> is the gist in plain language, <strong>Exam ready</strong> asks for precise mechanisms, and <strong>Expert</strong> adds limitations and formal details. Depth stays fixed once teaching starts.</p></details>
          <details><summary>Can I just talk without notes?</summary><p>{hostingPreview ? 'Not in this preview: it needs the study server. Once that’s live, you give your topic a title and start talking, and the hidden Judge checks your explanations against its own knowledge of the topic.' : 'Yes: give your topic a title and choose “or just start talking”. With no notes, the hidden Judge checks your explanations against its own knowledge of the topic.'}</p></details>
          <details><summary>Does Stu learn from me?</summary><p>Not permanently. He remembers your lesson while you teach it, but Teach Stu doesn’t train or fine-tune any model on what you write.</p></details>
          <details><summary>Which AI models?</summary><p>StepFun’s Step 5 Preview builds the hidden rubric and grades every explanation. Stu replies on the faster Step 3.7 Flash. Voice uses StepFun’s speech models.</p></details>
          <details><summary>Can I use my voice?</summary><p>{hostingPreview ? 'Not in this preview: voice arrives with the study server. Then you can talk for up to three minutes, review the transcript before it goes on the board, and have Stu read his replies aloud in an AI-generated voice.' : 'Yes, where voice is switched on. Choose “Start explaining” to talk for up to three minutes; you review the transcript before it goes on the board, and Stu can read his replies aloud in an AI-generated voice. Typing always works.'}</p></details>
        </div>
      </div>
    </section>

    <section className="lp-closing" aria-labelledby="lp-closing-title">
      <div className="lp-container">
        <div className="lp-closing-frame">
          <div className="lp-closing-board">
            <div className="lp-closing-copy">
              <h2 id="lp-closing-title">Ready to find out what you really know?</h2>
              <p>{hostingPreview ? 'Browse the sample notes now. Teaching Stu arrives with the study server.' : 'Pick a topic, explain one idea, and see what Stu asks.'}</p>
              <div className="lp-cta-row">{start('lp-button is-primary')}<button type="button" className="lp-button is-ghost" onClick={onSample}>{hostingPreview ? 'or browse the samples' : 'or try a sample'}</button></div>
            </div>
            <div className="lp-closing-art" aria-hidden="true">
              <span className="lp-closing-note"><span className="lp-note-tag"><Hand size={12} />Stu asks</span>What should I know first?</span>
              <Miso size={150} state="pleased" interactive={false} />
            </div>
          </div>
          <div className="lp-closing-ledge" aria-hidden="true"><span className="lp-markers"><i /><i /></span></div>
        </div>
      </div>
    </section>
  </main>;
}

type FooterProps = { hostingPreview: boolean; onHow: () => void; onSample: () => void; onExpressions: () => void };
export function LandingFooter({ hostingPreview, onHow, onSample, onExpressions }: FooterProps) {
  return <footer className="lp-footer">
    <div className="lp-container">
      <div className="lp-footer-top">
        <div className="lp-footer-brand"><span className="lp-footer-logo"><span className="brand-dot" aria-hidden="true" />teach stu</span><p>If you can teach it, you know it.</p></div>
        <nav className="lp-footer-cols" aria-label="Footer">
          <div><h2>Product</h2><ul>
            <li><button type="button" onClick={onHow}>How it works</button></li>
            <li><button type="button" onClick={onSample}>{hostingPreview ? 'Sample notes' : 'Sample lessons'}</button></li>
            <li><button type="button" onClick={onExpressions}>Stu’s expressions</button></li>
          </ul></div>
          <div><h2>Project</h2><ul>
            <li><a href={repo} target="_blank" rel="noreferrer"><Github size={15} aria-hidden="true" />GitHub</a></li>
            <li><a href={evalLink} target="_blank" rel="noreferrer">On-topic eval</a></li>
            <li><a href="https://platform.stepfun.ai" target="_blank" rel="noreferrer">Built on StepFun</a></li>
          </ul></div>
        </nav>
      </div>
      <div className="lp-footer-bottom">
        <span>Made at the AI LA Hackathon 2026</span>
        <ul className="lp-team" aria-label="Team">{team.map(handle => <li key={handle}><a href={`https://github.com/${handle}`} target="_blank" rel="noreferrer">@{handle}</a></li>)}</ul>
      </div>
    </div>
  </footer>;
}

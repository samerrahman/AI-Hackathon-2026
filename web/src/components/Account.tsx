import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { ArrowRight, ChevronDown, LayoutList, LoaderCircle, LogOut, RotateCw, Trash2 } from 'lucide-react';
import type { Account } from '../lib/auth';
import type { TopicSummary } from '../lib/cloud';
import { Miso } from './Miso';

/** Account UI for Teach Stu: the Google button, the start card's sign-in panel, the nav's account menu, and My topics. */

/** Google's "G" mark, inline so no third-party request is made before sign-in. */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>;
}

export function GoogleButton({ onClick, buttonRef, busy = false }: { onClick: () => void; buttonRef?: Ref<HTMLButtonElement>; busy?: boolean }) {
  return <button ref={buttonRef} type="button" className="google-button" disabled={busy} onClick={onClick}>
    <span className="google-mark">{busy ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <GoogleMark />}</span>Continue with Google
  </button>;
}

/**
 * Replaces the start card's form while signed out. Nobody has picked files yet on a first sign-in, so the redirect
 * loses nothing (signing in again keeps the start card in this browser; see App's startSignIn).
 * notice: what just happened ("You’re signed out."), shown here; App announces it in its own live region.
 */
export function SignInPanel({ onSignIn, buttonRef, busy, error, notice, children }: { onSignIn: () => void; buttonRef?: Ref<HTMLButtonElement>; busy?: boolean; error?: string; notice?: string; children?: ReactNode }) {
  return <div className="signin-panel">
    {notice && <p className="signin-notice">{notice}</p>}
    <span className="signin-stu"><Miso size={76} state="pleased" interactive={false} /></span>
    <p className="signin-line">Sign in to start teaching Stu. Your topics are saved to your account.</p>
    <GoogleButton onClick={onSignIn} buttonRef={buttonRef} busy={busy} />
    {error && <p className="signin-error" role="alert">{error}</p>}
    {children}
  </div>;
}

/** In place of the start card when /api/config didn't answer: whether this site needs an account isn't known yet. */
export function StartUnavailable({ onRetry }: { onRetry: () => void }) {
  return <div className="start-unavailable">
    <p>The study server isn’t answering, so teaching can’t start yet.</p>
    <button type="button" className="outline" onClick={onRetry}><RotateCw size={15} aria-hidden="true" />Try again</button>
  </div>;
}

/** A quiet placeholder for the start card while the config and the stored sign-in are checked. */
export function StartSkeleton() {
  return <div className="start-skeleton" role="status"><span className="visually-hidden">Loading…</span><i /><i /><i className="is-box" /></div>;
}

export function Avatar({ account, size = 28 }: { account: Account; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initial = (account.name || account.email || '?').trim().charAt(0).toUpperCase();
  return <span className="account-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }} aria-hidden="true">
    {account.avatarUrl && !broken ? <img src={account.avatarUrl} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : initial}
  </span>;
}

type MenuProps = { account: Account; onTopics: () => void; onSignOut: () => void; onDeleteData: () => void };
/** The signed-in account in the desktop nav: a menu button (Enter, Space or ↓ opens; ↑ ↓ Home End move; Escape closes). */
export function AccountMenu({ account, onTopics, onSignOut, onDeleteData }: MenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  const [start, setStart] = useState<'first' | 'last'>('first');
  useEffect(() => {
    if (!open) return;
    const list = items(); (start === 'last' ? list.at(-1) : list[0])?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, start]);
  const close = () => { setOpen(false); button.current?.focus(); };
  // Focus goes back to the account button first, so a dialog opened from the menu hands focus back to it.
  const choose = (action: () => void) => { close(); action(); };
  return <div ref={root} className="account" onBlur={event => { if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button ref={button} type="button" className="account-button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'account-menu' : undefined} aria-label={`Account: ${account.email}`}
      onClick={() => { setStart('first'); setOpen(!open); }}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setStart(event.key === 'ArrowUp' ? 'last' : 'first'); setOpen(true); } }}>
      <Avatar account={account} /><span className="account-email">{account.email}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div className="account-popover">
      <p className="account-who"><span>Signed in as</span><strong>{account.email}</strong></p>
      <div ref={menu} id="account-menu" role="menu" aria-label="Account" onKeyDown={event => {
        const list = items(); const index = list.indexOf(document.activeElement as HTMLButtonElement);
        const move = (next: number) => { event.preventDefault(); list[(next + list.length) % list.length]?.focus(); };
        if (event.key === 'ArrowDown') move(index + 1);
        else if (event.key === 'ArrowUp') move(index - 1);
        else if (event.key === 'Home') move(0);
        else if (event.key === 'End') move(list.length - 1);
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === 'Tab') setOpen(false);
      }}>
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(onTopics)}><LayoutList size={16} aria-hidden="true" />My topics</button>
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(onSignOut)}><LogOut size={16} aria-hidden="true" />Sign out</button>
        <button type="button" role="menuitem" tabIndex={-1} className="is-danger" onClick={() => choose(onDeleteData)}><Trash2 size={16} aria-hidden="true" />Delete my data</button>
      </div>
    </div>}
  </div>;
}

const depthNames: Record<string, string> = { 'big-picture': 'Big picture', 'exam-ready': 'Exam ready', expert: 'Expert' };
const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];
export function relativeTime(iso: string, now = Date.now()) {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (Math.abs(seconds) < 45) return 'just now';
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of units) if (Math.abs(seconds) >= size || unit === 'minute') return format.format(Math.round(seconds / size), unit);
  return '';
}

type TopicsProps = { topics: TopicSummary[] | null; error: string; opening: string | null; disabled: boolean; headingRef?: Ref<HTMLHeadingElement>;
  onResume: (topic: TopicSummary) => void; onDelete: (topic: TopicSummary) => void; onRetry: () => void };
/** My topics: the signed-in account's saved topics, newest first. */
export function MyTopics({ topics, error, opening, disabled, headingRef, onResume, onDelete, onRetry }: TopicsProps) {
  return <section className="lp-topics" id="topics" aria-labelledby="lp-topics-title">
    <div className="lp-container">
      <div className="lp-topics-head">
        <h2 id="lp-topics-title" ref={headingRef} tabIndex={-1}>My topics</h2>
        <p>Saved to your account, so they follow you to any device.</p>
      </div>
      {error ? <p className="lp-topics-note" role="alert">{error} <button type="button" className="text-button" onClick={onRetry}><RotateCw size={14} aria-hidden="true" />Try again</button></p>
        : !topics ? <p className="lp-topics-note" role="status"><LoaderCircle className="spin" size={15} aria-hidden="true" />Loading your topics…</p>
        : !topics.length ? <p className="lp-topics-note lp-topics-empty">No topics yet. Start one above.</p>
        : <ul className="lp-topic-grid">{topics.map(topic => <li key={topic.id} className="lp-topic">
            <div className="lp-topic-top"><h3>{topic.name}</h3><button type="button" className="icon-button lp-topic-delete" disabled={disabled} aria-label={`Delete ${topic.name}`} title="Delete topic" onClick={() => onDelete(topic)}><Trash2 size={16} aria-hidden="true" /></button></div>
            <p className="lp-topic-meta">{depthNames[topic.depth] ?? topic.depth}{topic.mode === 'demo' ? ' · Sample demo' : ''}</p>
            <span className="lp-topic-bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, topic.percent))}%` }} /></span>
            <p className="lp-topic-progress"><strong>{topic.percent}% taught</strong><span>{topic.unsaved ? 'Not saved to your account yet' : `Updated ${relativeTime(topic.updated_at)}`}</span></p>
            <button type="button" className="outline lp-topic-resume" disabled={disabled} aria-label={`Resume ${topic.name}`} onClick={() => onResume(topic)}>
              {opening === topic.id ? <><LoaderCircle className="spin" size={15} aria-hidden="true" />Opening…</> : <>Resume<ArrowRight size={15} aria-hidden="true" /></>}
            </button>
          </li>)}</ul>}
    </div>
  </section>;
}

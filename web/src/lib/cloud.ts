import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudyDocument } from '../../../shared/types';
import { expiredMessage, supabaseClient } from './auth';
import { readDocumentCache, writeDocumentCache } from './storage';

/**
 * Topics saved to the signed-in account: a row in public.study_sessions (the session without document blobs)
 * plus the original notes in the private `notes` bucket at <user id>/<session id>/<document id>.<pdf|txt>.
 * Row-level security (server/supabase/schema.sql) limits every read and write to the caller's own rows and folder.
 *
 * Every row has a version, bumped by each save, and a browser only saves over the version it last saw. So a tab or
 * device left open on an older state can never overwrite newer teaching, and a deleted topic never comes back.
 */
const TABLE = 'study_sessions';
const BUCKET = 'notes';
export const goneMessage = 'This topic is no longer in your account.';
export interface TopicSummary {
  id: string; name: string; depth: string; mode: string; status: string; percent: number; updated_at: string;
  /** The row's version; absent for a topic only this browser has. */
  version?: number;
  /** Only in this browser: its first save to the account hasn't happened yet. */
  unsaved?: boolean;
}
/** What this browser knows about a topic's row. Kept with the browser's copy, never in the row itself. */
export interface CloudMeta {
  /** The row version this copy is based on. */
  version: number;
  /** The copy's updatedAt when it last reached the account: a newer updatedAt means changes the account hasn't got. */
  syncedAt: number;
  /** Documents whose originals are in storage, so they are never uploaded twice. */
  uploaded: string[];
}
/** The parts of App's SavedSession that this module reads. Everything else travels untouched in `data`. */
export interface CloudSession {
  id: string; name: string; depth: string; mode: string; status: string; progress: { percent: number }; updatedAt: number;
  documents: StudyDocument[]; ownerId?: string; cloud?: CloudMeta;
}
/** Saving refused: the row changed since this browser last saw it, or it was deleted. Nothing was overwritten. */
export class TopicConflict extends Error {
  constructor(readonly id: string, readonly kind: 'changed' | 'gone') { super(kind === 'gone' ? goneMessage : 'This topic changed in another tab or on another device.'); }
}
/** The topic's rows are deleted, but some of its notes are still in storage. */
export class NotesLeftBehind extends Error {}

async function signedIn(): Promise<{ supabase: SupabaseClient; uid: string }> {
  const supabase = supabaseClient();
  if (!supabase) throw new Error('Accounts aren’t set up on this server.');
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error(expiredMessage);
  return { supabase, uid: data.session.user.id };
}
const safe = (part: string) => part.replace(/[^\w.-]/g, '_');
const mime = (doc: Pick<StudyDocument, 'kind'>) => doc.kind === 'pdf' ? 'application/pdf' : 'text/plain';
export const notePath = (uid: string, sessionId: string, doc: Pick<StudyDocument, 'id' | 'kind'>) => `${uid}/${safe(sessionId)}/${safe(doc.id)}.${doc.kind === 'pdf' ? 'pdf' : 'txt'}`;
const cacheKey = (doc: StudyDocument) => doc.processingVersion ? `${doc.processingVersion}:${doc.hash}` : '';
const percentOf = (session: CloudSession) => Math.max(0, Math.min(100, Math.round(session.progress.percent) || 0));
/** True when this copy has changes the account hasn't got yet (or was never saved to it). */
export const unsynced = (session: Pick<CloudSession, 'cloud' | 'updatedAt'>) => !session.cloud || session.cloud.syncedAt !== session.updatedAt;

/** The account's topics, newest first. */
export async function listTopics(): Promise<TopicSummary[]> {
  const { supabase } = await signedIn();
  const { data, error } = await supabase.from(TABLE).select('id,name,depth,mode,status,percent,updated_at,version').order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TopicSummary[];
}

/** The topic's row version, or null when the account has no such topic. */
export async function topicVersion(id: string): Promise<number | null> {
  const { supabase, uid } = await signedIn();
  const { data, error } = await supabase.from(TABLE).select('version').eq('user_id', uid).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? (data as { version: number }).version : null;
}

export interface SaveResult { summary: TopicSummary; meta: CloudMeta; uploadFailed?: unknown }
/**
 * Saves a settled session (no unconfirmed messages) over the version this browser knows, then uploads any notes not
 * in storage yet. The row goes first, so progress never waits on megabytes of PDF; a note that fails to upload is
 * reported in `uploadFailed` and retried by the next save.
 * known: what this browser knows about the row (none: the topic has never been saved). ownWrites: updatedAt values of
 * this browser's earlier saves whose answers never arrived, so a save that did land isn't mistaken for someone else's.
 */
export async function saveTopic(session: CloudSession, known?: CloudMeta, ownWrites: readonly number[] = []): Promise<SaveResult> {
  const { supabase, uid } = await signedIn();
  const present = new Set(session.documents.map(doc => doc.id));
  const uploaded = (known?.uploaded ?? []).filter(id => present.has(id));
  const summary: TopicSummary = { id: session.id, name: session.name, depth: session.depth, mode: session.mode, status: session.status, percent: percentOf(session), updated_at: new Date(session.updatedAt).toISOString() };
  // The browser's own bookkeeping (cloud) never goes into the row, and neither do document blobs.
  const { cloud: _meta, ...plain } = session;
  const columns = (version: number) => ({ name: summary.name, depth: summary.depth, mode: summary.mode, status: summary.status, percent: summary.percent, updated_at: summary.updated_at, version,
    data: { ...plain, ownerId: uid, documents: session.documents.map(({ blob, ...doc }) => doc), uploaded } });
  const current = async () => {
    const { data, error } = await supabase.from(TABLE).select('version,saved:data->updatedAt').eq('user_id', uid).eq('id', session.id).maybeSingle();
    if (error) throw error;
    return data as { version: number; saved: unknown } | null;
  };
  /** Saves over `from`; null when the row is no longer at that version. */
  const overwrite = async (from: number): Promise<number | null> => {
    const { data, error } = await supabase.from(TABLE).update(columns(from + 1)).eq('user_id', uid).eq('id', session.id).eq('version', from).select('version');
    if (error) throw error;
    return data?.length ? from + 1 : null;
  };
  let version: number | null;
  if (known && known.syncedAt === session.updatedAt) version = known.version; // the row already holds this; only notes are left
  else if (!known) {
    const { error } = await supabase.from(TABLE).insert({ user_id: uid, id: session.id, ...columns(1) });
    if (!error) version = 1;
    else if (error.code !== '23505') throw error;
    else {
      // Already there. Only a browser that started this topic knows its id before its first save, so this is this
      // browser's own earlier save (its answer lost) or another tab's: take it over unless it holds newer changes.
      const row = await current();
      if (!row) throw new TopicConflict(session.id, 'gone');
      version = typeof row.saved === 'number' && row.saved <= session.updatedAt ? await overwrite(row.version) : null;
      if (version === null) throw new TopicConflict(session.id, 'changed');
    }
  } else {
    version = await overwrite(known.version);
    if (version === null) {
      const row = await current();
      if (!row) throw new TopicConflict(session.id, 'gone');
      if (typeof row.saved === 'number' && ownWrites.includes(row.saved)) version = await overwrite(row.version);
      if (version === null) throw new TopicConflict(session.id, 'changed');
    }
  }
  let uploadFailed: unknown;
  for (const doc of session.documents) {
    if (!doc.blob || uploaded.includes(doc.id)) continue;
    try {
      // An ArrayBuffer, not the Blob, so the stored type is exactly what the bucket allows (a File can say '').
      const { error } = await supabase.storage.from(BUCKET).upload(notePath(uid, session.id, doc), await doc.blob.arrayBuffer(), { upsert: true, contentType: mime(doc) });
      if (error) throw error;
      uploaded.push(doc.id);
    } catch (cause) { uploadFailed ??= cause; }
  }
  return { summary: { ...summary, version }, meta: { version, syncedAt: session.updatedAt, uploaded }, uploadFailed };
}

/** Fills in missing originals: from this browser's document cache when it has them, otherwise from storage. */
async function withNotes<T extends CloudSession>(supabase: SupabaseClient, uid: string, session: T): Promise<T> {
  const fetched: string[] = [];
  const documents = await Promise.all(session.documents.map(async doc => {
    if (doc.blob) return doc;
    const key = cacheKey(doc);
    const cached = key ? await readDocumentCache<StudyDocument>(key) : undefined;
    if (cached?.blob) return { ...doc, blob: cached.blob };
    const { data: blob, error: missing } = await supabase.storage.from(BUCKET).download(notePath(uid, session.id, doc));
    // Without the original the topic still opens; the notes viewer offers to try the download again.
    if (missing || !blob) return doc;
    fetched.push(doc.id);
    const typed = new Blob([blob], { type: mime(doc) });
    if (key) await writeDocumentCache(key, { ...doc, blob: typed });
    return { ...doc, blob: typed };
  }));
  const cloud = session.cloud && { ...session.cloud, uploaded: [...new Set([...session.cloud.uploaded, ...fetched])] };
  return { ...session, documents, ...(cloud && { cloud }) };
}

/** The saved session with its notes and its row version. */
export async function openTopic<T extends CloudSession>(id: string): Promise<T> {
  const { supabase, uid } = await signedIn();
  const { data, error } = await supabase.from(TABLE).select('data,version').eq('user_id', uid).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(goneMessage);
  const row = data as { data: T & { uploaded?: string[] }; version: number };
  const { uploaded = [], cloud: _stale, ...saved } = row.data;
  return withNotes(supabase, uid, { ...saved, ownerId: uid, cloud: { version: row.version, syncedAt: saved.updatedAt, uploaded } } as T);
}

/** Downloads any of a topic's originals this copy is missing (a download that failed before is tried again). */
export async function restoreNotes<T extends CloudSession>(session: T): Promise<T> {
  if (session.documents.every(doc => doc.blob)) return session;
  const { supabase, uid } = await signedIn();
  return withNotes(supabase, uid, session);
}

async function folder(supabase: SupabaseClient, prefix: string): Promise<{ files: string[]; folders: string[] }> {
  const files: string[] = []; const folders: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    // Folders come back as entries without an id.
    for (const entry of data ?? []) (entry.id ? files : folders).push(`${prefix}/${entry.name}`);
    if ((data ?? []).length < 1000) return { files, folders };
  }
}
async function remove(supabase: SupabaseClient, paths: string[]) {
  for (let index = 0; index < paths.length; index += 500) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths.slice(index, index + 500));
    if (error) throw error;
  }
}

/**
 * Deletes the topic's row, then its notes. The row goes first: once it is gone the topic is gone on every device and
 * can't be saved back. If its notes then can't be removed, NotesLeftBehind says so; a later delete clears them.
 */
export async function deleteTopic(id: string): Promise<void> {
  const { supabase, uid } = await signedIn();
  const { error } = await supabase.from(TABLE).delete().eq('user_id', uid).eq('id', id);
  if (error) throw error;
  try { await remove(supabase, (await folder(supabase, `${uid}/${safe(id)}`)).files); }
  catch { throw new NotesLeftBehind('The topic is deleted, but some of its notes are still in storage.'); }
}

/** Deletes every row of this account, then every object under <user id>/. The caller signs out afterwards. */
export async function deleteAllMyData(): Promise<void> {
  const { supabase, uid } = await signedIn();
  const { error } = await supabase.from(TABLE).delete().eq('user_id', uid);
  if (error) throw error;
  try {
    const top = await folder(supabase, uid);
    const files = [...top.files];
    for (const session of top.folders) files.push(...(await folder(supabase, session)).files);
    await remove(supabase, files);
  } catch { throw new NotesLeftBehind('Every topic is deleted, but some notes are still in storage.'); }
}

export type SaveState = 'saving' | 'saved' | 'failed';
/**
 * Saving to the account. A change waits `delay` ms (a quiet change, like typing a draft or turning a page, up to
 * `quietDelay`) and never longer than that, the latest version of every changed topic is saved, and a failure retries
 * with backoff (and again on the next change). A topic that changed elsewhere, or was deleted, stops being saved here.
 */
export function createCloudSaver(options: { onState: (state: SaveState) => void; onSaved?: (summary: TopicSummary, meta: CloudMeta) => void;
  onConflict?: (conflict: TopicConflict) => void; delay?: number; quietDelay?: number }) {
  const delay = options.delay ?? 1500;
  const quietDelay = options.quietDelay ?? 10_000;
  const pending = new Map<string, CloudSession>();
  const meta = new Map<string, CloudMeta>();
  const ownWrites = new Map<string, number[]>();
  /** Deleted topics: never saved again from this page. Topic ids are issued by the server and never reused. */
  const deleted = new Set<string>();
  /** Changed elsewhere since this page last saw them: not saved again until a newer version is opened here. */
  const stale = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let due = 0;
  let saving = 0;
  let chain: Promise<void> = Promise.resolve();
  let failures = 0;
  const report = () => options.onState(failures && pending.size ? 'failed' : pending.size || saving ? 'saving' : 'saved');
  const remember = (id: string, next: CloudMeta) => {
    const known = meta.get(id);
    if (!known || next.version > known.version) meta.set(id, next);
    else if (next.version === known.version) meta.set(id, { ...next, syncedAt: Math.max(next.syncedAt, known.syncedAt), uploaded: [...new Set([...known.uploaded, ...next.uploaded])] });
  };
  /** Runs the saves no later than `wait` ms from now (an earlier deadline already set stands). */
  const arm = (wait: number) => {
    const at = Date.now() + wait;
    if (timer && due <= at) return;
    clearTimeout(timer); due = at;
    timer = setTimeout(() => void run(), wait);
  };
  const run = (): Promise<void> => {
    clearTimeout(timer); timer = undefined;
    chain = chain.then(async () => {
      const batch = [...pending.values()]; pending.clear();
      if (!batch.length) return;
      saving++;
      let failed = false;
      try {
        for (const session of batch) {
          if (deleted.has(session.id) || stale.has(session.id)) continue;
          try {
            const result = await saveTopic(session, meta.get(session.id), ownWrites.get(session.id));
            ownWrites.delete(session.id);
            remember(session.id, result.meta);
            if (deleted.has(session.id)) continue;
            options.onSaved?.(result.summary, meta.get(session.id) ?? result.meta);
            if (result.uploadFailed) { failed = true; if (!pending.has(session.id)) pending.set(session.id, session); }
          } catch (cause) {
            if (cause instanceof TopicConflict) {
              (cause.kind === 'gone' ? deleted : stale).add(session.id); pending.delete(session.id);
              options.onConflict?.(cause);
              continue;
            }
            failed = true;
            ownWrites.set(session.id, [...(ownWrites.get(session.id) ?? []), session.updatedAt].slice(-20));
            // Kept for the retry unless a newer version is already waiting or the topic was deleted meanwhile.
            if (!pending.has(session.id) && !deleted.has(session.id)) pending.set(session.id, session);
          }
        }
      } finally { saving--; }
      if (failed) { failures++; if (pending.size) arm(Math.min(30_000, 2_000 * 2 ** (failures - 1))); }
      else failures = 0;
      report();
    });
    return chain;
  };
  return {
    /** quiet: a change only to the draft, the open page or similar, which can wait a little longer. */
    schedule(session: CloudSession, { quiet = false }: { quiet?: boolean } = {}) {
      if (deleted.has(session.id) || stale.has(session.id)) { report(); return; }
      const known = meta.get(session.id);
      // The account already has exactly this (resuming a saved topic, say): nothing to send.
      if (known && !unsynced({ cloud: known, updatedAt: session.updatedAt }) && !pending.has(session.id) && !session.documents.some(doc => doc.blob && !known.uploaded.includes(doc.id))) { report(); return; }
      pending.set(session.id, session);
      // While saves are failing, say so until one gets through.
      options.onState(failures ? 'failed' : 'saving');
      arm(quiet ? quietDelay : delay);
    },
    /** What this page knows about the topic's row: the browser's copy is saved with it. */
    meta: (id: string) => meta.get(id),
    /** Records what a copy loaded from this browser or the account knows. fresh: the account's latest, opened just now. */
    seed(id: string, known: CloudMeta | undefined, fresh = false) {
      if (fresh) stale.delete(id);
      if (known) remember(id, known);
    },
    /** Saves whatever is waiting now. Resolves to whether everything reached the account. */
    flush: async () => { await run(); return pending.size === 0; },
    hasUnsaved: () => pending.size > 0 || saving > 0,
    /** Saves are failing and something is still waiting. */
    failing: () => failures > 0 && pending.size > 0,
    isStale: (id: string) => stale.has(id),
    /** Forgets a topic about to be deleted, for good, and waits for any save of it already in flight. */
    async drop(id: string) { deleted.add(id); pending.delete(id); await chain; },
    /** The delete failed: the topic is still there, so it may be saved again. */
    undrop(id: string) { deleted.delete(id); },
    /** Forgets everything waiting and known (signing out, deleting all data). */
    cancel() { clearTimeout(timer); timer = undefined; pending.clear(); meta.clear(); ownWrites.clear(); stale.clear(); failures = 0; },
  };
}
export type CloudSaver = ReturnType<typeof createCloudSaver>;

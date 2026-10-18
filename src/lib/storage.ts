import { clear, createStore, del, get, set } from 'idb-keyval';

// Originals and derived spans stay together. No lecture data is put in localStorage.
const sessionStore = createStore('miso-local-v1', 'session');
const documentStore = createStore('miso-documents-v1', 'documents');
const sessionKey = 'current-session';

export async function saveSession<T>(session: T): Promise<void> {
  await set(sessionKey, session, sessionStore);
}

export async function loadSession<T>(): Promise<T | undefined> {
  return get<T>(sessionKey, sessionStore);
}

/** Deleting the local study session also deletes cached originals and extraction. */
export async function deleteSession(): Promise<void> {
  await del(sessionKey, sessionStore);
  await clear(documentStore);
}

export async function readDocumentCache<T>(key: string): Promise<T | undefined> {
  try { return await get<T>(key, documentStore); } catch { return undefined; }
}

export async function writeDocumentCache<T>(key: string, value: T): Promise<void> {
  // Lack of browser storage must not prevent someone from opening their notes.
  try { await set(key, value, documentStore); } catch { /* session save reports storage failures separately */ }
}

export async function removeDocumentCache(key: string): Promise<void> {
  await del(key, documentStore);
}

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AppConfig } from '../../../shared/types';

/**
 * Accounts: Google sign-in through Supabase Auth (OAuth with PKCE). The client is built at runtime from
 * /api/config, so there are no VITE_ variables. supabase-js is loaded only then: with accounts off (no config.auth)
 * the browser never downloads it and there is no client at all.
 */
export type AuthSettings = NonNullable<AppConfig['auth']>;
export interface Account { id: string; email: string; name?: string; avatarUrl?: string }
export const expiredMessage = 'Your sign-in expired. Sign in again.';

let keepalive = false;
/**
 * While the page is closing, small saves ask the browser to finish them anyway. fetch's keepalive allows only 64 KB
 * in flight, so a bigger body goes as a normal request (and the next visit sends whatever didn't arrive).
 */
export function keepSavesAlive(on: boolean) { keepalive = on; }
const send: typeof fetch = (input, init) => fetch(input, keepalive && init && typeof init.body === 'string' && init.body.length < 20_000 ? { ...init, keepalive: true } : init);

let client: SupabaseClient | null = null;
let starting: Promise<SupabaseClient> | null = null;
let clientFor = '';
export function supabaseFor(settings: AuthSettings): Promise<SupabaseClient> {
  const key = `${settings.url} ${settings.anonKey}`;
  if (!starting || clientFor !== key) {
    clientFor = key;
    starting = import('@supabase/supabase-js').then(({ createClient }) => client = createClient(settings.url, settings.anonKey,
      { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true, autoRefreshToken: true }, global: { fetch: send } }));
    starting.catch(() => { starting = null; });
  }
  return starting;
}
/** The Supabase client once accounts are known to be on, otherwise null. */
export const supabaseClient = () => client;

/** `Authorization: Bearer <access token>` for /api calls while signed in; nothing when accounts are off. */
export async function authHeaders(): Promise<Record<string, string>> {
  if (!client) return {};
  try {
    const { data } = await client.auth.getSession();
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  } catch { return {}; }
}

// What Supabase adds to the redirect back from Google: ?code=… (PKCE) and, on failure, error parameters.
const callbackParams = ['code', 'sb_flow_id', 'error', 'error_code', 'error_description'];
const callbackHash = /(^#|&)(access_token|refresh_token|error|error_code|error_description)=/;
function isCallback() {
  const url = new URL(window.location.href);
  return callbackParams.some(name => url.searchParams.has(name)) || callbackHash.test(url.hash);
}
function cleanCallbackUrl() {
  const url = new URL(window.location.href);
  let changed = false;
  for (const name of callbackParams) if (url.searchParams.has(name)) { url.searchParams.delete(name); changed = true; }
  if (callbackHash.test(url.hash)) { url.hash = ''; changed = true; }
  if (changed) window.history.replaceState(window.history.state, '', url.toString());
}
function toAccount(user: User | null | undefined): Account | null {
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
  const avatar = text(meta.avatar_url) ?? text(meta.picture);
  return { id: user.id, email: user.email ?? text(meta.email) ?? '', name: text(meta.full_name) ?? text(meta.name), avatarUrl: avatar?.startsWith('https://') ? avatar : undefined };
}
const same = (a: Account | null, b: Account | null) => a === b || (!!a && !!b && a.id === b.id && a.email === b.email && a.name === b.name && a.avatarUrl === b.avatarUrl);

/**
 * settings: config.auth (null when accounts are off). ready: /api/config has answered, so "off" is known to be
 * off rather than not loaded yet. `loading` stays true until both the config and the stored session are known.
 */
export function useAuth(settings: AuthSettings | null | undefined, ready: boolean) {
  const url = settings?.url; const anonKey = settings?.anonKey;
  const enabled = Boolean(url && anonKey);
  const [account, setAccount] = useState<Account | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ready || !url || !anonKey) return;
    // Read before the client starts: it removes ?code= from the address bar once it has exchanged it.
    const callback = isCallback();
    let live = true;
    let unsubscribe = () => {};
    // Never echo text from the URL: a crafted link could put anything there.
    const unfinished = 'Google sign-in didn’t finish. Please try again.';
    supabaseFor({ url, anonKey }).then(async supabase => {
      if (!live) return;
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        // Only set state here: the callback must not call back into Supabase.
        if (live) { const next = toAccount(session?.user); setAccount(current => same(current, next) ? current : next); }
      });
      unsubscribe = () => data.subscription.unsubscribe();
      // getSession waits for the client to finish starting, including exchanging a ?code= from Google.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!live) return;
        const next = toAccount(session?.user);
        setAccount(current => same(current, next) ? current : next);
        if (callback && !session) setError(unfinished);
      } catch { if (live && callback) setError(unfinished); }
    }, () => { if (live) setError('Sign-in couldn’t load. Check your connection and reload the page.'); }).finally(() => {
      if (!live) return;
      setChecked(true);
      cleanCallbackUrl();
    });
    return () => { live = false; unsubscribe(); };
  }, [ready, url, anonKey]);
  const signIn = useCallback(async () => {
    if (!client) { setError('Sign-in couldn’t load. Check your connection and reload the page.'); return; }
    setError('');
    // Leaves the page for Google; Supabase sends the browser back to this origin with ?code=…. The trailing slash
    // matters: Supabase's allowed redirect patterns (https://host/**) only match a URL with a path.
    const { error: failed } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/` } });
    if (failed) setError('Google sign-in couldn’t start. Please try again.');
  }, []);
  /** Signs this browser out (other devices stay signed in). Works offline: the local session is always removed. */
  const signOut = useCallback(async () => {
    if (!client) return;
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    setAccount(null);
  }, []);
  return { enabled, user: enabled ? account : null, loading: !ready || (enabled && !checked), error, signIn, signOut };
}
export type AuthState = ReturnType<typeof useAuth>;

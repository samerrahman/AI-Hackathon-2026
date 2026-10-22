import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { ApiError } from './schema.js';

/**
 * Teach Stu accounts: Supabase Auth (Google sign-in) checked on every study request.
 * Accounts are enforced only when both SUPABASE_URL and SUPABASE_ANON_KEY are set; without them the API
 * behaves exactly as before (local dev, the e2e suite, and any deployment that has not set the keys yet).
 * Only the public anon key is used. Never put a service-role key here or anywhere in this app.
 */
export interface AuthUser { id: string; email: string | null }
export interface AuthSettings { url: string; anonKey: string }

declare global {
  namespace Express { interface Request { user?: AuthUser } }
}

export function authSettings(): AuthSettings | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

const CACHE_MS = 60_000;
const CACHE_ENTRIES = 5_000;
// Keyed by a SHA-256 of the token, so the cache never holds a usable bearer token. Failures are never cached.
const verified = new Map<string, { user: AuthUser; expires: number }>();
export function clearAuthCache() { verified.clear(); failures.clear(); }

export const signInRequired = () => new ApiError(401, 'Sign in to keep teaching.', 'AUTH_REQUIRED');
/** The token's own expiry (JWT `exp`), read only to keep the cache from outliving it; never trusted for access. */
function expiresAt(token: string): number {
  try {
    const exp: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')).exp;
    return typeof exp === 'number' ? exp * 1000 : Infinity;
  } catch { return Infinity; }
}
const unavailable = () => new ApiError(503, 'Sign-in can’t be checked right now. Your work is safe; please try again in a moment.', 'AUTH_UNAVAILABLE');

/** Longer than any real Supabase access token; refused before anything is parsed. */
const MAX_TOKEN_LENGTH = 8192;
/**
 * Cheap local checks, before any network call: a token that is not three base64url segments, carries no subject or
 * has already expired can't be a live Supabase access token. Refusing it is always safe; accepting it here proves
 * nothing (Supabase still checks the signature).
 */
export function plausibleToken(token: string, now = Date.now()): boolean {
  if (token.length > MAX_TOKEN_LENGTH) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return false;
    const { sub, exp } = payload as { sub?: unknown; exp?: unknown };
    if (typeof sub !== 'string' || !sub) return false;
    return exp === undefined || (typeof exp === 'number' && exp * 1000 > now);
  } catch { return false; }
}
/** Google sign-in only: an anonymous user, or one made with email and password or a phone number, is not let in. */
function signedInWithGoogle(body: Record<string, unknown>): boolean {
  if (body.is_anonymous === true) return false;
  const meta = body.app_metadata && typeof body.app_metadata === 'object' ? body.app_metadata as Record<string, unknown> : {};
  const identities = Array.isArray(body.identities) ? body.identities as unknown[] : [];
  return meta.provider === 'google' || (Array.isArray(meta.providers) && meta.providers.includes('google'))
    || identities.some(identity => Boolean(identity) && typeof identity === 'object' && (identity as Record<string, unknown>).provider === 'google');
}
/** A cached answer for this token, if one is still fresh. */
function cachedUser(token: string): AuthUser | null {
  const key = createHash('sha256').update(token).digest('hex');
  const hit = verified.get(key);
  if (hit && hit.expires > Date.now()) return hit.user;
  if (hit) verified.delete(key);
  return null;
}

/** The account behind an access token, or null when the token is not a valid Google sign-in for this project. */
export async function verifyAccessToken(token: string, settings: AuthSettings): Promise<AuthUser | null> {
  const now = Date.now();
  if (!plausibleToken(token, now)) return null;
  const hit = cachedUser(token);
  if (hit) return hit;
  let response: Response;
  try {
    response = await fetch(`${settings.url}/auth/v1/user`, { headers: { apikey: settings.anonKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
  } catch { throw unavailable(); }
  // 4xx: a bad, expired or revoked token, or a deleted user. 429 and 5xx: Supabase itself is struggling.
  if (response.status >= 400 && response.status < 500 && response.status !== 429) return null;
  if (!response.ok) throw unavailable();
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string' || !body.id) throw unavailable();
  if (!signedInWithGoogle(body as Record<string, unknown>)) return null;
  const user: AuthUser = { id: body.id, email: 'email' in body && typeof body.email === 'string' ? body.email : null };
  if (verified.size >= CACHE_ENTRIES) {
    for (const [entry, value] of verified) if (value.expires <= now) verified.delete(entry);
    // Still full: drop the oldest entries (a Map iterates in insertion order).
    for (const entry of verified.keys()) { if (verified.size < CACHE_ENTRIES) break; verified.delete(entry); }
  }
  verified.set(createHash('sha256').update(token).digest('hex'), { user, expires: Math.min(now + CACHE_MS, expiresAt(token)) });
  return user;
}

// Failed sign-in checks per IP: each one may cost a call to Supabase, so a flood of bad tokens is cut off early.
const FAILURE_WINDOW_MS = 60_000;
const FAILURE_LIMIT = 30;
const failures = new Map<string, { starts: number; count: number }>();
const recentFailures = (ip: string, now: number) => { const entry = failures.get(ip); return entry && now - entry.starts < FAILURE_WINDOW_MS ? entry.count : 0; };
function recordFailure(ip: string, now: number) {
  if (failures.size > 10_000) for (const [key, value] of failures) if (now - value.starts >= FAILURE_WINDOW_MS) failures.delete(key);
  const entry = failures.get(ip);
  if (!entry || now - entry.starts >= FAILURE_WINDOW_MS) failures.set(ip, { starts: now, count: 1 });
  else entry.count++;
}
const tooManyFailures = () => new ApiError(429, 'Too many sign-in checks failed from this network. Please wait a minute and sign in again.', 'AUTH_RATE_LIMIT');

/** Everything under /api except these needs an account when accounts are on. */
const publicPaths = new Set(['/config', '/health']);
/** Mount on '/api'. Attaches `req.user` ({ id, email }) when accounts are on; does nothing when they are off. */
export const requireAccount: RequestHandler = async (req, res, next) => {
  const settings = authSettings();
  // Express matches routes case-insensitively and ignores a trailing slash, so this does too.
  if (!settings || publicPaths.has(req.path.toLowerCase().replace(/\/+$/, ''))) return next();
  const token = /^Bearer\s+(\S+)\s*$/i.exec(req.get('authorization') ?? '')?.[1];
  if (!token) throw signInRequired();
  // A token checked in the last minute needs no new lookup, so a busy network's real users are never held up here.
  const cached = cachedUser(token);
  if (cached) { req.user = cached; return next(); }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  if (recentFailures(ip, now) >= FAILURE_LIMIT) {
    res.setHeader('Retry-After', String(Math.ceil((failures.get(ip)!.starts + FAILURE_WINDOW_MS - now) / 1000)));
    throw tooManyFailures();
  }
  const user = await verifyAccessToken(token, settings);
  if (!user) { recordFailure(ip, now); throw signInRequired(); }
  req.user = user;
  next();
};

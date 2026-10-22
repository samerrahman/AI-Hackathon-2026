import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { StudyDocument } from '../shared/types.js';
import { app, clearRateLimits } from './index.js';
import { authSettings, clearAuthCache, plausibleToken, verifyAccessToken } from './auth.js';
import { ApiError } from './schema.js';
import { createTeachTopic, openTeachState, runTeachTurn } from './teach-engine.js';
import { DemoTeachProvider } from './teach-demo.js';

process.env.SESSION_SECRET = 'teach-stu-test-only-secret';
const supabase = 'https://stub.supabase.co';
const settings = { url: supabase, anonKey: 'stub-anon' };
/** A JWT-shaped token (Supabase checks the signature; the server only reads `sub` and `exp` to refuse junk early). */
const jwt = (sub: string, exp = Math.floor(Date.now() / 1000) + 3600) => `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub, exp })).toString('base64url')}.c2lnbmF0dXJl`;
const tokenA = jwt('user-a');
const tokenB = jwt('user-b');
/** Signed up by another route than the app's Google button: refused even though Supabase says the token is valid. */
const emailToken = jwt('user-email');
const anonymousToken = jwt('user-anonymous');
const forged = jwt('user-forged');
const google = { app_metadata: { provider: 'google', providers: ['google'] }, identities: [{ provider: 'google' }], is_anonymous: false };
const accounts: Record<string, { id: string; email: string } & Record<string, unknown>> = {
  [tokenA]: { id: 'user-a', email: 'a@example.com', ...google }, [tokenB]: { id: 'user-b', email: 'b@example.com', ...google },
  [emailToken]: { id: 'user-email', email: 'e@example.com', app_metadata: { provider: 'email', providers: ['email'] }, identities: [{ provider: 'email' }], is_anonymous: false },
  [anonymousToken]: { id: 'user-anonymous', email: '', app_metadata: { provider: 'google', providers: ['google'] }, identities: [], is_anonymous: true },
};

// Supabase Auth is mocked: GET /auth/v1/user answers for the two tokens above. Every other request (the tests'
// own calls to the API) goes through the real fetch.
const realFetch = globalThis.fetch;
const lookups: string[] = [];
let supabaseDown = false;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(supabase)) return realFetch(input, init);
  assert.equal(url, `${supabase}/auth/v1/user`);
  const headers = new Headers(init?.headers);
  assert.equal(headers.get('apikey'), 'stub-anon');
  const token = headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  lookups.push(token);
  if (supabaseDown) throw new TypeError('fetch failed');
  const account = accounts[token];
  return account ? Response.json({ ...account, aud: 'authenticated', role: 'authenticated' }) : Response.json({ code: 403, error_code: 'bad_jwt', msg: 'invalid JWT' }, { status: 403 });
}) as typeof fetch;

function accountsOn() { process.env.SUPABASE_URL = `${supabase}/`; process.env.SUPABASE_ANON_KEY = 'stub-anon'; clearAuthCache(); clearRateLimits(); lookups.length = 0; supabaseDown = false; }
function accountsOff() { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY; clearAuthCache(); clearRateLimits(); lookups.length = 0; supabaseDown = false; }
test.afterEach(accountsOff);

const document: StudyDocument = { id: 'doc-1', name: 'Sequences.pdf', size: 200, hash: 'test', pageCount: 1, kind: 'pdf', warnings: [], spans: [{ id: 'source-1', documentId: 'doc-1', pageIndex: 0, quality: 'native',
  text: 'A bounded sequence stays within a finite range. A convergent sequence approaches a limit. Completeness of the real numbers supports those limits.' }] };
const topicRequest = { title: 'Sequences', depth: 'big-picture' as const, documents: [document], mode: 'demo' as const, sampleId: 'analysis' as const };

async function withApi(run: (call: (path: string, init?: { method?: string; token?: string; body?: unknown }) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const response = await realFetch(`${base}${path}`, { method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    return { status: response.status, body: response.status === 204 ? null : await response.json().catch(() => null) };
  };
  try { await run(call); } finally { server.close(); }
}

test('accounts are off unless both SUPABASE_URL and SUPABASE_ANON_KEY are set', () => {
  accountsOff();
  assert.equal(authSettings(), null);
  process.env.SUPABASE_URL = supabase;
  assert.equal(authSettings(), null);
  process.env.SUPABASE_ANON_KEY = '  ';
  assert.equal(authSettings(), null);
  process.env.SUPABASE_ANON_KEY = 'stub-anon';
  assert.deepEqual(authSettings(), settings);
});

test('a valid token returns its account; an invalid one returns null and is never cached', async () => {
  accountsOn();
  assert.deepEqual(await verifyAccessToken(tokenA, settings), { id: 'user-a', email: 'a@example.com' });
  assert.equal(await verifyAccessToken(forged, settings), null);
  assert.equal(await verifyAccessToken(forged, settings), null);
  assert.deepEqual(lookups, [tokenA, forged, forged]);
});

test('a token that can’t be a live access token is refused without asking Supabase', async () => {
  accountsOn();
  const now = Date.now();
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  for (const junk of ['forged-token', 'a.b', 'a.b.c.d', `${segment({})}.${segment({ exp: now / 1000 + 60 })}.sig`, `${segment({})}.${segment({ sub: 'x', exp: now / 1000 - 1 })}.sig`,
    `${segment({})}.${segment({ sub: 'x', exp: 'later' })}.sig`, `${segment({})}.not+base64url.sig`, `${segment({})}.${segment({ sub: 'x' })}.${'s'.repeat(9000)}`]) {
    assert.equal(plausibleToken(junk, now), false, junk.slice(0, 40));
    assert.equal(await verifyAccessToken(junk, settings), null);
  }
  assert.equal(plausibleToken(tokenA, now), true);
  assert.equal(lookups.length, 0);
});

test('only Google sign-ins are let in: an email/password or anonymous user is refused', async () => {
  accountsOn();
  assert.equal(await verifyAccessToken(emailToken, settings), null);
  assert.equal(await verifyAccessToken(anonymousToken, settings), null);
  assert.deepEqual(await verifyAccessToken(tokenB, settings), { id: 'user-b', email: 'b@example.com' });
});

test('a verified token is reused for 60 seconds, then checked again', async t => {
  accountsOn();
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const token = jwt('user-a', 1_000_000 / 1000 + 3600);
  accounts[token] = accounts[tokenA];
  await verifyAccessToken(token, settings);
  t.mock.timers.tick(59_000);
  assert.deepEqual(await verifyAccessToken(token, settings), { id: 'user-a', email: 'a@example.com' });
  assert.equal(lookups.length, 1);
  t.mock.timers.tick(2_000);
  await verifyAccessToken(token, settings);
  assert.equal(lookups.length, 2);
  delete accounts[token];
});

test('a token about to expire is not reused past its own expiry', async t => {
  accountsOn();
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const exp = Math.floor(1_000_000 / 1000) + 10;
  const expiring = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'user-a', exp })).toString('base64url')}.signature`;
  accounts[expiring] = accounts[tokenA];
  await verifyAccessToken(expiring, settings);
  t.mock.timers.tick(5_000);
  await verifyAccessToken(expiring, settings);
  assert.equal(lookups.length, 1);
  // Past its own expiry: refused outright, with no new lookup.
  t.mock.timers.tick(6_000);
  assert.equal(await verifyAccessToken(expiring, settings), null);
  assert.equal(lookups.length, 1);
  delete accounts[expiring];
});

test('Supabase being unreachable is a 503, not a sign-out', async () => {
  accountsOn();
  supabaseDown = true;
  await assert.rejects(verifyAccessToken(tokenA, settings), (e: unknown) => e instanceof ApiError && e.status === 503 && e.code === 'AUTH_UNAVAILABLE');
});

test('with accounts off, the API needs no token and /api/config reports auth: null', async () => {
  accountsOff();
  await withApi(async call => {
    assert.equal((await call('/api/config')).body.auth, null);
    const topic = await call('/api/topic', { body: topicRequest });
    assert.equal(topic.status, 200);
    assert.ok(topic.body.stateToken);
  });
  assert.equal(lookups.length, 0);
});

test('with accounts on, every study route needs a valid token; config and health stay public', async () => {
  accountsOn();
  await withApi(async call => {
    const config = await call('/api/config');
    assert.equal(config.status, 200);
    assert.deepEqual(config.body.auth, settings);
    assert.equal((await call('/api/health')).status, 200);
    const routes: [string, string][] = [['POST', '/api/topic'], ['POST', '/api/teach'], ['POST', '/api/judge'], ['POST', '/api/concepts'], ['POST', '/api/turn'],
      ['DELETE', '/api/session/some-topic'], ['POST', '/api/transcribe'], ['POST', '/api/speech']];
    for (const [method, path] of routes) {
      for (const token of [undefined, 'forged-token', forged]) {
        const response = await call(path, { method, token, body: method === 'POST' ? {} : undefined });
        assert.equal(response.status, 401, `${method} ${path} ${token ?? 'without a token'}`);
        assert.deepEqual(response.body, { error: 'Sign in to keep teaching.', code: 'AUTH_REQUIRED' });
      }
    }
    // A valid token reaches the route (here: request validation).
    assert.equal((await call('/api/topic', { token: tokenA, body: {} })).status, 400);
    assert.equal((await call('/api/session/some-topic', { method: 'DELETE', token: tokenA })).status, 204);
    // The public paths match the way Express routes them (any case, trailing slash).
    assert.equal((await call('/api/Health/')).status, 200);
    supabaseDown = true; clearAuthCache();
    const down = await call('/api/topic', { token: tokenA, body: topicRequest });
    assert.equal(down.status, 503);
    assert.equal(down.body.code, 'AUTH_UNAVAILABLE');
  });
});

test('a topic is bound to the account that started it', async () => {
  accountsOn();
  await withApi(async call => {
    const topic = await call('/api/topic', { token: tokenA, body: topicRequest });
    assert.equal(topic.status, 200);
    const turn = { topicId: topic.body.topicId, stateToken: topic.body.stateToken, documents: [document], turnId: 'turn-1', revision: 1, messageId: 'message-1', text: 'A bounded sequence stays within a finite range.' };
    for (const path of ['/api/teach', '/api/judge']) {
      const stolen = await call(path, { token: tokenB, body: turn });
      assert.equal(stolen.status, 403, path);
      assert.equal(stolen.body.code, 'WRONG_ACCOUNT');
    }
    assert.equal((await call('/api/teach', { token: tokenA, body: turn })).status, 200);
  });
});

test('failed sign-in checks are limited per IP, without holding up tokens already checked', async () => {
  accountsOn();
  await withApi(async call => {
    assert.equal((await call('/api/topic', { token: tokenA, body: {} })).status, 400);
    const statuses: number[] = [];
    for (let index = 0; index < 35; index++) statuses.push((await call('/api/topic', { token: jwt(`junk-${index}`), body: {} })).status);
    assert.deepEqual(statuses.slice(0, 30), Array(30).fill(401));
    assert.deepEqual(statuses.slice(30), Array(5).fill(429));
    // Only the first 30 junk tokens (plus token A) reached Supabase.
    assert.equal(lookups.length, 31);
    const limited = await call('/api/topic', { token: tokenB, body: {} });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'AUTH_RATE_LIMIT');
    // Token A was checked a moment ago, so it still gets through.
    assert.equal((await call('/api/topic', { token: tokenA, body: {} })).status, 400);
  });
});

test('signed-in requests have a budget per account and a looser one per IP', async () => {
  accountsOn();
  const tokens = ['user-1', 'user-2', 'user-3', 'user-4'].map(id => { const token = jwt(id); accounts[token] = { id, email: `${id}@example.com`, ...google }; return token; });
  await withApi(async call => {
    const counts = { passed: 0, limited: 0 };
    // Account 1 alone: cut off after 60.
    for (let index = 0; index < 61; index++) { const { status } = await call('/api/speech', { token: tokens[0], body: {} }); if (status === 429) counts.limited++; else counts.passed++; }
    assert.deepEqual(counts, { passed: 60, limited: 1 });
    // Three more accounts from the same IP: the IP's 180 runs out before their own 60 each do.
    counts.passed = 0; counts.limited = 0;
    for (const token of tokens.slice(1)) for (let index = 0; index < 45; index++) { const { status } = await call('/api/speech', { token, body: {} }); if (status === 429) counts.limited++; else counts.passed++; }
    assert.deepEqual(counts, { passed: 119, limited: 16 });
  });
  for (const token of tokens) delete accounts[token];
});

test('openTeachState refuses another account, ignores accounts when they are off, and keeps pre-account tokens valid', async () => {
  const provider = new DemoTeachProvider('analysis');
  const owned = await createTeachTopic(topicRequest, provider, 'user-a');
  assert.throws(() => openTeachState(owned.stateToken, owned.topicId, [document], 'user-b'), (e: unknown) => e instanceof ApiError && e.status === 403 && e.code === 'WRONG_ACCOUNT');
  assert.equal(openTeachState(owned.stateToken, owned.topicId, [document], 'user-a').userId, 'user-a');
  assert.equal(openTeachState(owned.stateToken, owned.topicId, [document]).userId, 'user-a');
  // A token sealed before accounts has no owner: still valid for anyone, and bound to the first account that uses it.
  const legacy = await createTeachTopic(topicRequest, provider);
  assert.equal(openTeachState(legacy.stateToken, legacy.topicId, [document]).userId, undefined);
  const next = await runTeachTurn({ topicId: legacy.topicId, stateToken: legacy.stateToken, documents: [document], turnId: 'turn-1', revision: 1, messageId: 'message-1', text: 'A bounded sequence stays within a finite range.' }, provider, false, 'user-b');
  assert.equal(openTeachState(next.stateToken, legacy.topicId, [document], 'user-b').userId, 'user-b');
  assert.throws(() => openTeachState(next.stateToken, legacy.topicId, [document], 'user-a'), (e: unknown) => e instanceof ApiError && e.code === 'WRONG_ACCOUNT');
});

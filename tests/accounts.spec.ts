import { readFileSync } from 'node:fs';
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';

// Accounts on: /api/config is mocked to name a stub Supabase project, and everything at that project is answered
// here (Auth, the study_sessions table and the notes bucket). No real Supabase project is ever called.
const stub = 'https://stub.supabase.co';
const storageKey = 'sb-stub-auth-token';
const user = { id: '0b7c6a3e-2f4d-4c1b-9e8a-5d6f7a8b9c01', aud: 'authenticated', role: 'authenticated', email: 'ada@example.com',
  app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { full_name: 'Ada Lovelace', email: 'ada@example.com' }, created_at: '2026-10-01T00:00:00Z' };
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.stub-signature`;

type Row = { user_id: string; id: string; name: string; depth: string; mode: string; status: string; percent: number; updated_at: string; version: number; data: Record<string, unknown> };
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const circuitNotes = 'A complete circuit has a battery and closed conducting path. An open switch breaks the path, so no current flows through the lamp.';
function seedRows(): Row[] {
  const row = (id: string, name: string, depth: string, percent: number, updated: string, extra: Record<string, unknown> = {}): Row => ({ user_id: user.id, id, name, depth, mode: 'live', status: 'paused', percent, updated_at: updated, version: 1,
    data: { id, name, depth, mode: 'live', documents: [], stateToken: `opaque-${id}`, history: [{ id: `welcome-${id}`, role: 'assistant', text: 'Hi! I’m Stu. What should I know first?' }],
      progress: { total: 6, credited: Math.round(percent * 6 / 100), percent, mode: 'teach' }, liveStep5: false, documentId: '', pageIndex: 0, draft: '', audioOutput: false, status: 'paused', updatedAt: Date.parse(updated), ...extra } });
  const doc = { id: 'doc-circuits', name: 'Circuit notes', size: circuitNotes.length, hash: 'circuit-hash', pageCount: 1, warnings: [], kind: 'text', processingVersion: 'stub-version',
    spans: [{ id: 'doc-circuits-p0-s0', documentId: 'doc-circuits', pageIndex: 0, text: circuitNotes, quality: 'user-supplied text; section-level location', kind: 'paragraph' }] };
  return [
    row('topic-circuits', 'Lamp circuits', 'exam-ready', 50, hoursAgo(2), { documents: [doc], documentId: doc.id, uploaded: [doc.id] }),
    row('topic-sequences', 'Sequences and convergence', 'big-picture', 17, hoursAgo(50)),
  ];
}

type Store = ReturnType<typeof createStore>;
function createStore(rows = seedRows()) {
  return { rows, objects: new Map<string, { body: Buffer; type: string }>([[`notes/${user.id}/topic-circuits/doc-circuits.txt`, { body: Buffer.from(circuitNotes), type: 'text/plain' }],
      [`notes/${user.id}/topic-sequences/doc-sequences.pdf`, { body: Buffer.from('%PDF-1.4 stub'), type: 'application/pdf' }]]),
    requests: [] as { method: string; path: string; search: URLSearchParams; headers: Record<string, string>; body?: unknown }[], authorize: [] as URL[],
    /** Supabase unreachable for saves (POST and PATCH on study_sessions answer 503). */
    failSaves: false,
    /** Supabase unreachable for everything at rest/v1. */
    restDown: false };
}
/**
 * A tiny in-memory Supabase: Auth, PostgREST for study_sessions (with the row versions saves check), and Storage for
 * the notes bucket. Pass the same store to two contexts to play two devices of one account.
 * comeBack: the authorize endpoint sends the browser straight back with ?code=, as Supabase does after Google.
 * configDelay: /api/config answers this many ms late.
 */
async function mockSupabase(target: Page | BrowserContext, { signedIn, rows, store = createStore(rows), comeBack = false, configDelay = 0 }: { signedIn: boolean; rows?: Row[]; store?: Store; comeBack?: boolean; configDelay?: number }) {
  await target.route('**/api/config', async route => {
    const response = await route.fetch();
    if (configDelay) await new Promise(resolve => setTimeout(resolve, configDelay));
    await route.fulfill({ json: { ...await response.json(), auth: { url: stub, anonKey: 'stub-anon' } } });
  });
  if (signedIn) {
    const session = { access_token: accessToken, refresh_token: 'stub-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
    await target.addInitScript(([key, value]) => { if (location.origin.startsWith('http://127.0.0.1')) localStorage.setItem(key, value); }, [storageKey, JSON.stringify(session)]);
  }
  await target.route(`${stub}/**`, async (route: Route) => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method(); const headers = request.headers();
    const cors = { 'Access-Control-Allow-Origin': headers.origin ?? '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': headers['access-control-request-headers'] ?? 'authorization, apikey, content-type, x-client-info, prefer, x-upsert', 'Access-Control-Expose-Headers': 'content-range' };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const raw = request.postDataBuffer();
    const body = raw && (headers['content-type'] ?? '').includes('json') ? JSON.parse(raw.toString('utf8')) : undefined;
    store.requests.push({ method, path: url.pathname, search: url.searchParams, headers, body });
    const json = (value: unknown, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(value) });
    const path = url.pathname;
    if (path === '/auth/v1/authorize') {
      store.authorize.push(url);
      if (comeBack) {
        const back = new URL(url.searchParams.get('redirect_to')!);
        back.searchParams.set('code', 'stub-auth-code');
        return route.fulfill({ status: 302, headers: { location: back.href } });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Stub Google sign-in</title><h1>Stub Google sign-in</h1>' });
    }
    if (path === '/auth/v1/user') return signedIn ? json(user) : json({ code: 401, msg: 'invalid JWT' }, 401);
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      if (body?.auth_code !== 'stub-auth-code' || !body?.code_verifier) return json({ code: 400, error_code: 'bad_code_verifier', msg: 'invalid flow state' }, 400);
      return json({ access_token: accessToken, refresh_token: 'stub-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (path.startsWith('/rest/v1/') && store.restDown) return route.abort('connectionrefused');
    if (path === '/rest/v1/study_sessions') {
      const eq = (name: string) => url.searchParams.get(name)?.replace(/^eq\./, '');
      const matches = (row: Row) => (['user_id', 'id', 'version'] as const).every(name => eq(name) === undefined || String(row[name]) === eq(name));
      // select=a,b,alias:data->key, as PostgREST reads it.
      const pick = (row: Row) => { const select = url.searchParams.get('select') ?? '*'; return select === '*' ? row : Object.fromEntries(select.split(',').map(column => {
        const [alias, expression] = column.includes(':') ? column.split(':') : [column, column]; const [name, key] = expression.split('->');
        const value = row[name as keyof Row]; return [alias, key ? (value as Record<string, unknown>)[key] : value];
      })); };
      if (method === 'GET') return json(store.rows.filter(matches).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).map(pick));
      if ((method === 'POST' || method === 'PATCH') && store.failSaves) return json({ message: 'upstream connect error' }, 503);
      if (method === 'POST') {
        for (const incoming of [body].flat() as Row[]) {
          if (store.rows.some(row => row.user_id === incoming.user_id && row.id === incoming.id)) return json({ code: '23505', message: 'duplicate key value violates unique constraint "study_sessions_pkey"' }, 409);
          store.rows = [incoming, ...store.rows];
        }
        return route.fulfill({ status: 201, headers: cors });
      }
      if (method === 'PATCH') {
        const changed: Row[] = [];
        store.rows = store.rows.map(row => { if (!matches(row)) return row; const next = { ...row, ...body as Partial<Row> }; changed.push(next); return next; });
        return json(changed.map(pick));
      }
      if (method === 'DELETE') {
        store.rows = store.rows.filter(row => !matches(row));
        return route.fulfill({ status: 204, headers: cors });
      }
    }
    if (path.startsWith('/storage/v1/object/list/notes')) {
      const prefix = `notes/${body.prefix}/`; const names = new Map<string, boolean>();
      for (const key of store.objects.keys()) if (key.startsWith(prefix)) { const rest = key.slice(prefix.length); const [first, ...more] = rest.split('/'); names.set(first, more.length > 0); }
      return json([...names].map(([name, folder]) => folder ? { name, id: null } : { name, id: `id-${name}`, metadata: {} }));
    }
    if (path === '/storage/v1/object/notes' && method === 'DELETE') {
      for (const prefix of body.prefixes as string[]) store.objects.delete(`notes/${prefix}`);
      return json([]);
    }
    if (path.startsWith('/storage/v1/object/notes/')) {
      const key = decodeURIComponent(path.slice('/storage/v1/object/'.length));
      if (method === 'POST' || method === 'PUT') { store.objects.set(key, { body: raw ?? Buffer.alloc(0), type: headers['content-type'] ?? '' }); return json({ Key: key, Id: 'object-id' }); }
      const object = store.objects.get(key);
      return object ? route.fulfill({ status: 200, headers: cors, contentType: object.type, body: object.body }) : json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 400);
    }
    return json({ message: `Unmocked stub request: ${method} ${path}` }, 501);
  });
  return store;
}
const topicResponse = { topicId: 'account-topic', stateToken: 'opaque-encrypted-state-token', progress: { total: 6, credited: 0, percent: 0, mode: 'teach' },
  message: { id: 'welcome', role: 'assistant', text: 'Hi! Teach me this topic. What should I know first?' }, liveStep5: false };

test('signed out: the start card asks for Google sign-in, and every way past the front page opens the sign-in dialog', async ({ page }) => {
  const store = await mockSupabase(page, { signedIn: false });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: 'Start a topic' });
  await expect(card.getByText('Sign in to start teaching Stu. Your topics are saved to your account.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Topic title' })).toHaveCount(0);
  await expect(page.getByText('No account needed')).toHaveCount(0);
  // Nobody is signed in, so the card doesn't claim anything is saved to an account yet.
  await expect(card.locator('.local-note')).toHaveText('Free with Google sign-in');
  await expect(page.getByRole('region', { name: 'Saved session' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'My topics' })).toHaveCount(0);
  await expect(page.locator('.lp-trust')).toContainText('Free, with Google sign-in');

  const dialog = page.getByRole('dialog');
  for (const opener of [card.getByRole('button', { name: 'Try a sample session' }), card.getByRole('button', { name: 'or just start talking' }),
    card.getByRole('button', { name: 'Test Stu’s expressions' }), page.getByRole('banner').getByRole('button', { name: 'Study settings' }), page.getByRole('banner').getByRole('button', { name: 'Try a sample' })]) {
    await opener.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Sign in to teach Stu.' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  // Start teaching goes to the sign-in panel.
  await page.getByRole('banner').getByRole('link', { name: 'Start teaching' }).click();
  await expect(card.getByRole('button', { name: 'Continue with Google' })).toBeFocused();

  const origin = new URL(page.url()).origin;
  await card.getByRole('button', { name: 'Continue with Google' }).click();
  await page.waitForURL(`${stub}/auth/v1/authorize**`);
  const authorize = store.authorize.at(-1)!;
  expect(authorize.searchParams.get('provider')).toBe('google');
  // With the trailing slash: Supabase's allowed redirect patterns (https://host/**) only match a URL with a path.
  expect(authorize.searchParams.get('redirect_to')).toBe(`${origin}/`);
  expect(authorize.searchParams.get('code_challenge')).toBeTruthy();
  expect(authorize.searchParams.get('code_challenge_method')?.toLowerCase()).toBe('s256');
});

test('Continue with Google comes back signed in, with ?code= removed from the address bar', async ({ page }) => {
  const store = await mockSupabase(page, { signedIn: false, comeBack: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const origin = new URL(page.url()).origin;
  await page.getByRole('region', { name: 'Start a topic' }).getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('button', { name: 'Account: ada@example.com' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Topic title' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'My topics' }).getByRole('listitem')).toHaveCount(2);
  expect(page.url()).toBe(`${origin}/`);
  const exchange = store.requests.find(request => request.path === '/auth/v1/token');
  expect(exchange?.body).toMatchObject({ auth_code: 'stub-auth-code' });
});

test('a failed Google sign-in says so without echoing the URL, and cleans the URL', async ({ page }) => {
  await mockSupabase(page, { signedIn: false });
  await page.goto('/?error=access_denied&error_code=bad_oauth_state&error_description=Call+this+number+now', { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: 'Start a topic' });
  await expect(card.getByRole('alert')).toHaveText('Google sign-in didn’t finish. Please try again.');
  await expect(page.locator('body')).not.toContainText('Call this number');
  await expect.poll(() => new URL(page.url()).search).toBe('');
});

test('signed in: My topics lists the account’s topics, study requests carry the token, an expired sign-in keeps the words, and signing out clears it all', async ({ page }) => {
  const store = await mockSupabase(page, { signedIn: true });
  let topicAuthorization: string | undefined;
  await page.route('**/api/topic', async route => { topicAuthorization = route.request().headers().authorization; await route.fulfill({ json: topicResponse }); });
  await page.route('**/api/teach', route => route.fulfill({ status: 401, json: { error: 'Sign in to keep teaching.', code: 'AUTH_REQUIRED' } }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const topics = page.getByRole('region', { name: 'My topics' });
  await expect(topics.getByRole('heading', { name: 'My topics' })).toBeVisible();
  const cards = topics.getByRole('listitem');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Lamp circuits');
  await expect(cards.first()).toContainText('Exam ready');
  await expect(cards.first()).toContainText('50% taught');
  await expect(cards.first()).toContainText('Updated 2 hours ago');
  await expect(cards.nth(1)).toContainText('Sequences and convergence');
  await expect(topics.getByRole('button', { name: 'Resume Lamp circuits' })).toBeVisible();
  await expect(topics.getByRole('button', { name: 'Delete Lamp circuits' })).toBeVisible();
  // The resume strip still offers the newest topic.
  await expect(page.getByRole('region', { name: 'Saved session' })).toContainText('Lamp circuits');
  await expect(page.getByRole('button', { name: 'Resume session' })).toBeVisible();

  // The account menu: keyboard operable, three items.
  const account = page.getByRole('button', { name: 'Account: ada@example.com' });
  await account.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Account' });
  await expect(menu.getByRole('menuitem')).toHaveText(['My topics', 'Sign out', 'Delete my data']);
  await expect(menu.getByRole('menuitem', { name: 'My topics' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(account).toBeFocused();

  // Start a topic: /api/topic gets the access token, and the topic and its notes are saved to the account.
  await page.getByRole('textbox', { name: 'Topic title' }).fill('Lamp safety');
  await page.getByRole('button', { name: 'Paste notes' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Safety notes');
  await page.getByLabel('Lecture text').fill('A fuse melts when too much current flows, which opens the circuit and protects the wiring from overheating.');
  await page.getByRole('button', { name: 'Add these notes' }).click();
  await page.getByRole('button', { name: 'Start teaching' }).click();
  const box = page.getByRole('textbox', { name: 'Your explanation' });
  await expect(box).toBeVisible();
  expect(topicAuthorization).toBe(`Bearer ${accessToken}`);
  await expect(page.locator('.save-indicator')).toHaveText('Saved to your account');
  const upsert = store.requests.find(request => request.method === 'POST' && request.path === '/rest/v1/study_sessions');
  expect(upsert?.headers.authorization).toBe(`Bearer ${accessToken}`);
  expect(upsert?.headers.apikey).toBe('stub-anon');
  expect(upsert?.body).toMatchObject({ user_id: user.id, id: 'account-topic', name: 'Lamp safety', depth: 'big-picture', mode: 'live', status: 'active', percent: 0,
    data: { stateToken: 'opaque-encrypted-state-token', ownerId: user.id } });
  const saved = upsert?.body as Row;
  expect(JSON.stringify(saved.data)).not.toContain('"blob"');
  const docId = (saved.data.documents as { id: string }[])[0].id;
  const upload = store.requests.find(request => request.method === 'POST' && request.path.startsWith('/storage/v1/object/notes/'));
  expect(upload?.path).toBe(`/storage/v1/object/notes/${user.id}/account-topic/${docId}.txt`);
  expect(upload?.headers['content-type']).toBe('text/plain');

  // A 401 from the API: the expired-sign-in message, and the explanation goes back into the box.
  await box.fill('A fuse is a deliberately weak link in the circuit.');
  await page.getByRole('button', { name: 'Add to board' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Your sign-in expired. Sign in again.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible();
  await expect(box).toHaveValue('A fuse is a deliberately weak link in the circuit.');
  await expect(page.locator('.student-message')).toHaveCount(0);

  // Back on the front page the new topic is listed first.
  await page.getByRole('button', { name: 'Pause session' }).click();
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText('Lamp safety');

  // Sign out: the cards and this browser's copy go, and the sign-in panel is back.
  await page.getByRole('button', { name: 'Account: ada@example.com' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('region', { name: 'Start a topic' }).getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My topics' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Saved session' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Account:/ })).toHaveCount(0);
  // The menu that had focus is gone: focus lands on Continue with Google, and the change is announced.
  await expect(page.getByRole('region', { name: 'Start a topic' }).getByRole('button', { name: 'Continue with Google' })).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'You’re signed out.' })).toHaveCount(1);
  expect(store.requests.some(request => request.path === '/auth/v1/logout')).toBe(true);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  const local = await page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open('miso-local-v1');
    open.onsuccess = () => { const get = open.result.transaction('session').objectStore('session').get('current-session'); get.onsuccess = () => resolve(get.result ?? null); get.onerror = () => resolve('error'); };
    open.onerror = () => resolve('error');
  }));
  expect(local).toBeNull();
});

test('a topic from the account opens on a new device with its notes, and deleting a topic removes its row and files', async ({ page }) => {
  const store = await mockSupabase(page, { signedIn: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const topics = page.getByRole('region', { name: 'My topics' });
  await topics.getByRole('button', { name: 'Resume Lamp circuits' }).click();
  await expect(page.getByRole('heading', { name: 'Lamp circuits' })).toBeVisible();
  expect(store.requests.some(request => request.method === 'GET' && request.path === `/storage/v1/object/notes/${user.id}/topic-circuits/doc-circuits.txt`)).toBe(true);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(page.locator('.document-paper')).toContainText('An open switch breaks the path');
  await page.getByRole('button', { name: 'Pause session' }).click();

  await topics.getByRole('button', { name: 'Delete Sequences and convergence' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Delete this topic?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep it' }).click();
  await expect(topics.getByRole('listitem')).toHaveCount(2);
  await topics.getByRole('button', { name: 'Delete Lamp circuits' }).click();
  await dialog.getByRole('button', { name: 'Delete topic' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(topics.getByRole('listitem')).toHaveCount(1);
  await expect(topics).not.toContainText('Lamp circuits');
  const removed = store.requests.find(request => request.method === 'DELETE' && request.path === '/rest/v1/study_sessions');
  expect(removed?.search.get('id')).toBe('eq.topic-circuits');
  expect(removed?.search.get('user_id')).toBe(`eq.${user.id}`);
  expect(store.objects.has(`notes/${user.id}/topic-circuits/doc-circuits.txt`)).toBe(false);
  expect(store.rows.map(row => row.id)).toEqual(['topic-sequences']);

  // Delete my data: every row and file goes, and the browser is signed out.
  await page.getByRole('button', { name: 'Account: ada@example.com' }).click();
  await page.getByRole('menuitem', { name: 'Delete my data' }).click();
  await expect(dialog.getByRole('link', { name: 'open an issue on GitHub' })).toHaveAttribute('href', /github\.com\/.+\/issues$/);
  await dialog.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByRole('region', { name: 'Start a topic' }).getByRole('button', { name: 'Continue with Google' })).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Your topics and notes were deleted, and you’re signed out.' })).toHaveCount(1);
  expect(store.rows).toEqual([]);
  expect(store.objects.size).toBe(0);
});

test('the empty state invites a first topic', async ({ page }) => {
  await mockSupabase(page, { signedIn: true, rows: [] });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('No topics yet. Start one above.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved session' })).toHaveCount(0);
});

/** Stu's side of the study API: a topic, and a reply to every explanation (each with a new sealed state). */
async function mockStudyApi(target: Page | BrowserContext) {
  let turn = 0;
  await target.route('**/api/topic', route => route.fulfill({ json: topicResponse }));
  await target.route('**/api/teach', async route => {
    const request = JSON.parse(route.request().postData() ?? '{}') as { topicId: string; stateToken: string };
    turn++;
    await route.fulfill({ json: { topicId: request.topicId, stateToken: `${request.stateToken}+${turn}`, progress: { total: 6, credited: 0, percent: 0, mode: 'teach' },
      message: { id: `stu-${turn}-${Date.now()}`, role: 'assistant', text: `Stu reply ${turn}: why?` }, liveStep5: false } });
  });
  await target.route('**/api/session/**', route => route.fulfill({ status: 204 }));
}
async function teachTurn(page: Page, text: string) {
  const replies = page.locator('.stu-message', { hasText: 'Stu reply' });
  const before = await replies.count();
  await page.getByRole('textbox', { name: 'Your explanation' }).fill(text);
  await page.getByRole('button', { name: 'Add to board' }).click();
  await expect(replies).toHaveCount(before + 1);
}
async function startPastedTopic(page: Page, title: string) {
  await page.getByRole('textbox', { name: 'Topic title' }).fill(title);
  await page.getByRole('button', { name: 'Paste notes' }).click();
  await page.getByLabel('Title', { exact: true }).fill(`${title} notes`);
  await page.getByLabel('Lecture text').fill('A fuse melts when too much current flows, which opens the circuit and protects the wiring from overheating.');
  await page.getByRole('button', { name: 'Add these notes' }).click();
  await page.getByRole('button', { name: 'Start teaching' }).click();
  await expect(page.getByRole('textbox', { name: 'Your explanation' })).toBeVisible();
}
const localCopy = (page: Page) => page.evaluate(() => new Promise<{ id: string; ownerId?: string; draft: string } | null | 'error'>(resolve => {
  const open = indexedDB.open('miso-local-v1');
  open.onsuccess = () => { const get = open.result.transaction('session').objectStore('session').get('current-session'); get.onsuccess = () => resolve(get.result ?? null); get.onerror = () => resolve('error'); };
  open.onerror = () => resolve('error');
}));
const rowOf = (store: Store, id: string) => store.rows.find(row => row.id === id);
const historyOf = (row?: Row) => ((row?.data.history ?? []) as { text: string }[]).map(message => message.text);

test('a PDF topic follows you to a new device, pages and all', async ({ browser }) => {
  const store = createStore([]);
  const laptop = await browser.newContext(); const phone = await browser.newContext();
  for (const context of [laptop, phone]) await mockSupabase(context, { signedIn: true, store });
  const first = await laptop.newPage();
  await first.goto('/', { waitUntil: 'domcontentloaded' });
  await first.getByRole('region', { name: 'Start a topic' }).getByRole('button', { name: 'Try a sample session' }).click();
  await first.getByRole('dialog').getByRole('button', { name: /Sequences & convergence/ }).click();
  await expect(first.getByRole('textbox', { name: 'Your explanation' })).toBeVisible({ timeout: 30_000 });
  await expect(first.locator('.save-indicator')).toHaveText('Saved to your account');
  await expect.poll(() => [...store.objects.keys()].filter(key => key.endsWith('.pdf') && !key.includes('topic-sequences')).length).toBe(1);
  await laptop.close();

  const second = await phone.newPage();
  await second.goto('/', { waitUntil: 'domcontentloaded' });
  await second.getByRole('region', { name: 'My topics' }).getByRole('button', { name: 'Resume Sequences & convergence' }).click();
  await second.getByRole('button', { name: 'Notes', exact: true }).click();
  // The page is drawn from the PDF downloaded from the account, not from text kept in the row.
  await expect(second.locator('.document-viewer canvas')).toBeVisible();
  await expect(second.locator('.document-error')).toHaveCount(0);
  expect(store.requests.some(request => request.method === 'GET' && request.path.startsWith(`/storage/v1/object/notes/${user.id}/`) && request.path.endsWith('.pdf'))).toBe(true);
  await phone.close();
});

test('while /api/config loads, the start card waits instead of flashing the topic form', async ({ page }) => {
  await mockSupabase(page, { signedIn: false, configDelay: 1500 });
  // Notes whether the topic form is ever in the page, however briefly.
  await page.addInitScript(() => {
    new MutationObserver(() => { if (document.querySelector('input[aria-label="Topic title"]')) (window as unknown as { formSeen?: boolean }).formSeen = true; }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: 'Start a topic' });
  await expect(card.locator('.start-skeleton')).toBeVisible();
  await expect(page.locator('.lp-honest-grid li[data-pending]')).toHaveCount(1);
  await expect(page.locator('.lp-faq-list')).not.toContainText('saved in this browser');
  await expect(card.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  // Never once did the form show before the sign-in panel.
  expect(await page.evaluate(() => (window as unknown as { formSeen?: boolean }).formSeen ?? false)).toBe(false);
});

test('a site last seen without accounts shows its start form at once on the next visit', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('textbox', { name: 'Topic title' })).toBeVisible();
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/config', async route => { const response = await route.fetch(); await held; await route.fulfill({ response }); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('textbox', { name: 'Topic title' })).toBeVisible();
  await expect(page.locator('.start-skeleton')).toHaveCount(0);
  await expect(page.getByText('No account needed')).toBeVisible();
  release();
});

test('when /api/config fails, the start card says the server isn’t answering instead of offering the form', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ status: 500, json: { error: 'down' } }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: 'Start a topic' });
  await expect(card).toContainText('The study server isn’t answering, so teaching can’t start yet.');
  await expect(page.getByRole('textbox', { name: 'Topic title' })).toHaveCount(0);
  await expect(page.getByText('No account needed')).toHaveCount(0);
  await expect(page.locator('.lp-trust')).toHaveAttribute('data-pending');
  await page.unroute('**/api/config');
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('textbox', { name: 'Topic title' })).toBeVisible();
});

test('with accounts on, every privacy claim names the account, and none says notes stay only in this browser', async ({ page }) => {
  await mockSupabase(page, { signedIn: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'My topics' })).toBeVisible();
  await expect(page.locator('.lp-honest-grid')).toContainText('Saved to your account');
  await expect(page.locator('.lp-honest-grid')).toContainText('the people who run Teach Stu can access it');
  await expect(page.locator('.lp-faq-list')).toContainText('Yes, a free one: sign in with Google.');
  await expect(page.getByRole('region', { name: 'Start a topic' }).locator('.local-note')).toHaveText('Saved to your account');
  await page.getByRole('banner').getByRole('button', { name: 'Study settings' }).click();
  const settings = page.getByRole('dialog');
  await expect(settings.locator('.privacy-note')).toContainText('saved to your account, in a private database and file store other accounts can’t read (the people who run Teach Stu can access it to operate the site)');
  for (const claim of [/with no account/i, /saved in this browser/i, /saved in your browser/i, /No account needed/]) await expect(page.locator('body')).not.toContainText(claim);
});

test('on a phone, the account sits in the menu, and signing out from there lands on Continue with Google', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSupabase(page, { signedIn: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'My topics' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  const account = page.getByRole('group', { name: 'Account' });
  await expect(account).toContainText('ada@example.com');
  await account.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('region', { name: 'Start a topic' }).getByRole('button', { name: 'Continue with Google' })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Start a topic' })).toContainText('You’re signed out.');
  expect(await localCopy(page)).toBeNull();
});

test('when Supabase can’t be reached, My topics and the save indicator say so, and saving resumes once it can', async ({ page }) => {
  const store = createStore();
  store.restDown = true;
  await mockSupabase(page, { signedIn: true, store });
  await mockStudyApi(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const topics = page.getByRole('region', { name: 'My topics' });
  // supabase-js tries a failed read three more times (1 s, 2 s, 4 s) before giving up.
  await expect(topics.getByRole('alert')).toContainText('Couldn’t load your topics.', { timeout: 15_000 });
  await startPastedTopic(page, 'Offline topic');
  await expect(page.locator('.save-indicator[role="alert"]')).toHaveText('Couldn’t save to your account. Keep this tab open.');
  store.restDown = false;
  // The retry runs on its own, a couple of seconds later.
  await expect(page.locator('.save-indicator')).toHaveText('Saved to your account', { timeout: 10_000 });
  expect(rowOf(store, 'account-topic')?.name).toBe('Offline topic');
  await page.getByRole('button', { name: 'Pause session' }).click();
  await expect(topics.getByRole('listitem').first()).toContainText('Offline topic');
});

test('signing out in one tab closes the topic in another, and nothing more is saved for it', async ({ context }) => {
  const store = await mockSupabase(context, { signedIn: true });
  await mockStudyApi(context);
  const studying = await context.newPage();
  await studying.goto('/', { waitUntil: 'domcontentloaded' });
  await startPastedTopic(studying, 'Private topic');
  await expect(studying.locator('.save-indicator')).toHaveText('Saved to your account');
  const other = await context.newPage();
  await other.goto('/', { waitUntil: 'domcontentloaded' });
  await other.getByRole('button', { name: 'Account: ada@example.com' }).click();
  await other.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(other.getByRole('region', { name: 'Start a topic' }).getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await studying.bringToFront();
  await expect(studying.getByRole('textbox', { name: 'Your explanation' })).toHaveCount(0);
  await expect(studying.getByRole('heading', { name: 'Private topic' })).toHaveCount(0);
  await expect(studying.getByRole('region', { name: 'Start a topic' }).getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  const saves = store.requests.filter(request => request.path === '/rest/v1/study_sessions' && request.method !== 'GET').length;
  await studying.waitForTimeout(2000);
  expect(await localCopy(studying)).toBeNull();
  expect(store.requests.filter(request => request.path === '/rest/v1/study_sessions' && request.method !== 'GET').length).toBe(saves);
});

test('a tab left open on an older version can’t overwrite newer teaching, and opens the latest without losing typed words', async ({ browser }) => {
  const store = createStore();
  const laptop = await browser.newContext(); const phone = await browser.newContext();
  for (const context of [laptop, phone]) { await mockSupabase(context, { signedIn: true, store }); await mockStudyApi(context); }
  const old = await laptop.newPage(); const fresh = await phone.newPage();
  for (const page of [old, fresh]) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('region', { name: 'My topics' }).getByRole('button', { name: 'Resume Lamp circuits' }).click();
    await expect(page.getByRole('textbox', { name: 'Your explanation' })).toBeVisible();
  }
  await teachTurn(fresh, 'PHONE: an open switch breaks the path.');
  await expect.poll(() => rowOf(store, 'topic-circuits')?.version).toBe(2);
  await teachTurn(old, 'LAPTOP: the lamp needs a closed loop.');
  await expect(old.getByRole('alert').filter({ hasText: 'This topic changed in another tab or on another device' })).toBeVisible();
  await expect(old.locator('.save-indicator')).toHaveText('Not saving: changed elsewhere');
  expect(historyOf(rowOf(store, 'topic-circuits'))).toContain('PHONE: an open switch breaks the path.');
  expect(historyOf(rowOf(store, 'topic-circuits'))).not.toContain('LAPTOP: the lamp needs a closed loop.');
  await old.getByRole('textbox', { name: 'Your explanation' }).fill('Words I was still typing.');
  await old.getByRole('button', { name: 'Open the latest version' }).click();
  await expect(old.getByRole('log', { name: 'Lesson board' })).toContainText('PHONE: an open switch breaks the path.');
  await expect(old.getByRole('textbox', { name: 'Your explanation' })).toHaveValue('Words I was still typing.');
  await expect(old.locator('.save-indicator')).toHaveText('Saved to your account');
  expect(rowOf(store, 'topic-circuits')?.data.draft).toBe('Words I was still typing.');
  expect(historyOf(rowOf(store, 'topic-circuits'))).toContain('PHONE: an open switch breaks the path.');
  await laptop.close(); await phone.close();
});

test('a topic deleted on another device is closed here, not saved back', async ({ browser }) => {
  const store = createStore();
  const laptop = await browser.newContext(); const phone = await browser.newContext();
  for (const context of [laptop, phone]) { await mockSupabase(context, { signedIn: true, store }); await mockStudyApi(context); }
  const open = await laptop.newPage();
  await open.goto('/', { waitUntil: 'domcontentloaded' });
  await open.getByRole('region', { name: 'My topics' }).getByRole('button', { name: 'Resume Lamp circuits' }).click();
  await expect(open.getByRole('textbox', { name: 'Your explanation' })).toBeVisible();
  const other = await phone.newPage();
  await other.goto('/', { waitUntil: 'domcontentloaded' });
  await other.getByRole('region', { name: 'My topics' }).getByRole('button', { name: 'Delete Lamp circuits' }).click();
  await other.getByRole('dialog').getByRole('button', { name: 'Delete topic' }).click();
  await expect.poll(() => rowOf(store, 'topic-circuits')).toBeUndefined();
  await teachTurn(open, 'A switch is a gap you can close.');
  await expect(open.getByRole('alert').filter({ hasText: 'This topic was deleted from your account on another device, so it was closed here.' })).toBeVisible();
  await expect(open.getByRole('textbox', { name: 'Your explanation' })).toHaveCount(0);
  await open.waitForTimeout(2000);
  expect(rowOf(store, 'topic-circuits')).toBeUndefined();
  expect([...store.objects.keys()].some(key => key.includes('topic-circuits'))).toBe(false);
  expect(await localCopy(open)).toBeNull();
  await laptop.close(); await phone.close();
});

test('signing out before the latest teaching reaches the account asks first', async ({ page }) => {
  const store = createStore();
  store.failSaves = true;
  await mockSupabase(page, { signedIn: true, store });
  await mockStudyApi(page);
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await startPastedTopic(page, 'Unsaved topic');
  await teachTurn(page, 'A fuse is a deliberately weak link.');
  await expect(page.locator('.save-indicator')).toHaveText('Couldn’t save to your account. Keep this tab open.');
  await page.getByRole('button', { name: 'Pause session' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Your latest teaching hasn’t reached your account yet.' })).toBeVisible();
  await page.getByRole('button', { name: 'Account: ada@example.com' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Sign out before it’s saved?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(page.getByRole('button', { name: 'Account: ada@example.com' })).toBeVisible();
  expect(await localCopy(page)).toMatchObject({ id: 'account-topic' });
  store.failSaves = false;
  await page.getByRole('button', { name: 'Account: ada@example.com' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('region', { name: 'Start a topic' }).getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  expect(historyOf(rowOf(store, 'account-topic'))).toContain('A fuse is a deliberately weak link.');
});

test('a topic whose first save failed stays listed after a reload, and is saved once Supabase answers', async ({ page }) => {
  const store = createStore();
  store.failSaves = true;
  await mockSupabase(page, { signedIn: true, store });
  await mockStudyApi(page);
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await startPastedTopic(page, 'Brand new topic');
  await expect(page.locator('.save-indicator')).toHaveText('Couldn’t save to your account. Keep this tab open.');
  await page.reload({ waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: 'My topics' }).getByRole('listitem').filter({ hasText: 'Brand new topic' });
  await expect(card).toContainText('Not saved to your account yet');
  await expect(page.getByRole('region', { name: 'Saved session' })).toContainText('Brand new topic');
  store.failSaves = false;
  await expect.poll(() => rowOf(store, 'account-topic')?.name, { timeout: 15_000 }).toBe('Brand new topic');
  await expect(card).toContainText('Updated just now');
});

test('Sign in again keeps the start card’s title and pasted notes', async ({ page }) => {
  const store = await mockSupabase(page, { signedIn: true, comeBack: true });
  await page.route('**/api/topic', route => route.fulfill({ status: 401, json: { error: 'Sign in to keep teaching.', code: 'AUTH_REQUIRED' } }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Topic title' }).fill('Exam topic');
  await page.getByRole('button', { name: 'Paste notes' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Two hours of notes');
  await page.getByLabel('Lecture text').fill('A fuse melts when too much current flows, which opens the circuit and protects the wiring from overheating.');
  await page.getByRole('button', { name: 'Add these notes' }).click();
  await page.getByRole('button', { name: 'Start teaching' }).click();
  await page.getByRole('button', { name: 'Sign in again' }).click();
  await expect.poll(() => store.authorize.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Account: ada@example.com' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Topic title' })).toHaveValue('Exam topic');
  await expect(page.locator('.file-row')).toContainText('Two hours of notes');
});

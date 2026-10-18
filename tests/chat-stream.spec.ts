import { test, expect, type Page } from '@playwright/test';

const explanation = 'Bounded terms stay inside a finite interval, but can oscillate without converging.';
const reply = 'Oh, staying inside the interval doesn’t make the sequence settle down.';

async function streamingSample(page: Page) {
  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), voiceAvailable: false, voiceProvider: 'Off', voiceKey: null } });
  });
  // A controllable response body, rather than route.fulfill's completed body,
  // lets the browser render a reply while the server completion is still absent.
  await page.addInitScript(() => {
    type Entry = { request: Record<string, any>; controller: ReadableStreamDefaultController<Uint8Array>; aborted: boolean; cancelled: boolean; completed: boolean };
    const original = window.fetch.bind(window);
    const entries: Entry[] = [];
    const encoder = new TextEncoder();
    const send = (index: number, event: Record<string, unknown>) => {
      const entry = entries[index];
      const request = entry.request;
      const ids = { sessionId: request.sessionId, turnId: request.turnId, revision: request.revision, conceptId: request.concept.id };
      try { entry.controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...ids, ...event })}\n\n`)); }
      catch { /* A cancelled reader may already have discarded this late event. */ }
    };
    Object.defineProperty(window, '__stuStreamTest', { value: {
      entries,
      send,
      complete(index: number, visibleText: string, overrides: Record<string, unknown> = {}) {
        const entry = entries[index], request = entry.request;
        entry.completed = true;
        send(index, { type: 'complete', result: {
          sessionId: request.sessionId, turnId: request.turnId, revision: request.revision, conceptId: request.concept.id,
          visibleText, sourceIds: request.concept.sourceIds.slice(0, 1), nextAction: 'advance', evidence: [],
          engineState: request.engineState, pendingChallenge: false, status: 'explaining', character: 'neutral',
        }, ...overrides });
        try { entry.controller.close(); } catch { /* Expected if interrupted. */ }
      },
      fail(index: number) {
        send(index, { type: 'error', code: 'PROVIDER_NETWORK', error: 'The connection was interrupted. Your draft is safe; retry.' });
        try { entries[index].controller.close(); } catch { /* Expected if interrupted. */ }
      },
    } });
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname !== '/api/turn' || !init?.body) return original(input, init);
      const request = JSON.parse(String(init.body));
      if (request.action !== 'answer') return original(input, init);
      const headers = new Headers(init.headers);
      if (!headers.get('Accept')?.includes('text/event-stream')) throw new Error('The typed path must request an event stream.');
      let entry: Entry;
      const body = new ReadableStream<Uint8Array>({
        start(controller) { entry = { request, controller, aborted: false, cancelled: false, completed: false }; entries.push(entry); },
        cancel() { entry.cancelled = true; },
      });
      init.signal?.addEventListener('abort', () => { entry.aborted = true; }, { once: true });
      send(entries.length - 1, { type: 'ready', receivedAt: Date.now() });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample session' }).click();
  await page.getByRole('button', { name: 'Sequences & convergence Real analysis' }).click();
  await page.getByRole('button', { name: 'Start teaching' }).click();
  await expect(page.locator('.conversation-current h2')).not.toBeEmpty();
  await expect(page.getByRole('button', { name: 'Give me a hint' })).toBeEnabled();
}

async function submit(page: Page) {
  await page.getByRole('textbox', { name: 'Your explanation' }).fill(explanation);
  await page.getByRole('button', { name: 'Send explanation' }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__stuStreamTest').entries.length)).toBe(1);
}
async function send(page: Page, event: Record<string, unknown>) {
  await page.evaluate(event => Reflect.get(window, '__stuStreamTest').send(0, event), event);
}

test('submitted explanation and reply chunks appear before completion; private and stale events stay hidden', async ({ page }) => {
  await streamingSample(page);
  await submit(page);
  await expect(page.locator('.pending-explanation')).toContainText(explanation);
  await expect(page.getByRole('button', { name: 'Cancel response' })).toBeVisible();
  await send(page, { type: 'reasoning', text: 'PRIVATE_REASONING_NOT_FOR_DISPLAY' });
  await send(page, { type: 'text', text: 'STALE_TEXT_NOT_FOR_DISPLAY', turnId: 'a-different-turn' });
  await send(page, { type: 'text', text: 'Oh, staying inside the interval', interpretation: 'PRIVATE_MODEL_FIELDS_NOT_FOR_DISPLAY' });
  await expect(page.locator('.streaming-reply')).toContainText('Oh, staying inside the interval');
  expect(await page.evaluate(() => Reflect.get(window, '__stuStreamTest').entries[0].completed)).toBe(false);
  await expect(page.locator('body')).not.toContainText('PRIVATE_REASONING_NOT_FOR_DISPLAY');
  await expect(page.locator('body')).not.toContainText('PRIVATE_MODEL_FIELDS_NOT_FOR_DISPLAY');
  await expect(page.locator('body')).not.toContainText('STALE_TEXT_NOT_FOR_DISPLAY');
  await send(page, { type: 'text', text: reply });
  await expect(page.locator('.streaming-reply')).toContainText(reply);
  await page.evaluate(reply => Reflect.get(window, '__stuStreamTest').complete(0, reply), reply);
  await expect(page.locator('.conversation-current h2')).toHaveText(reply);
  await expect(page.locator('.streaming-reply')).toHaveCount(0);
  await expect(page.locator('.pending-explanation')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Your explanation' })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Cancel response' })).toHaveCount(0);
  await page.locator('.last-explanation summary').click();
  await expect(page.locator('.last-explanation')).toContainText(explanation);
});

test('a stream error preserves the draft and discards provisional text', async ({ page }) => {
  await streamingSample(page);
  const originalPrompt = await page.locator('.conversation-current h2').textContent();
  await submit(page);
  await send(page, { type: 'text', text: 'This unfinished reply must not enter the recap.' });
  await expect(page.locator('.streaming-reply')).toBeVisible();
  await page.evaluate(() => Reflect.get(window, '__stuStreamTest').fail(0));
  await expect(page.getByRole('alert')).toContainText('Your draft is safe');
  await expect(page.getByRole('textbox', { name: 'Your explanation' })).toHaveValue(explanation);
  await expect(page.locator('.streaming-reply')).toHaveCount(0);
  await expect(page.locator('.conversation-current h2')).toHaveText(originalPrompt!);
  await expect(page.getByRole('button', { name: 'Send explanation' })).toBeEnabled();
});

for (const interruption of ['edit', 'cancel', 'navigate'] as const) {
  test(`${interruption} interrupts streaming and a late completion cannot overwrite the current view`, async ({ page }) => {
    await streamingSample(page);
    const originalPrompt = await page.locator('.conversation-current h2').textContent();
    await submit(page);
    await send(page, { type: 'text', text: 'A reply that is still being written.' });
    await expect(page.locator('.streaming-reply')).toBeVisible();
    const preservedDraft = interruption === 'edit' ? 'My newer correction is still in progress.' : explanation;
    if (interruption === 'edit') await page.getByRole('textbox', { name: 'Your explanation' }).fill(preservedDraft);
    if (interruption === 'cancel') await page.getByRole('button', { name: 'Cancel response' }).click();
    if (interruption === 'navigate') await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__stuStreamTest').entries[0].aborted)).toBe(true);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__stuStreamTest').entries[0].cancelled)).toBe(true);
    await page.evaluate(() => Reflect.get(window, '__stuStreamTest').complete(0, 'LATE_COMPLETION_MUST_NOT_REPLACE_CURRENT_VIEW'));
    await expect(page.getByRole('textbox', { name: 'Your explanation' })).toHaveValue(preservedDraft);
    await expect(page.locator('.streaming-reply')).toHaveCount(0);
    await expect(page.locator('.conversation-current h2')).toHaveText(originalPrompt!);
    await expect(page.locator('body')).not.toContainText('LATE_COMPLETION_MUST_NOT_REPLACE_CURRENT_VIEW');
    await expect(page.getByRole('button', { name: 'Send explanation' })).toBeEnabled();
    if (interruption === 'navigate') await expect(page.getByRole('spinbutton', { name: 'Page number' })).toHaveValue('2');
  });
}

import { test, expect, type Response } from '@playwright/test';
import { resolve } from 'node:path';
import type { AssessmentResult, Concept, SourceSpan, StudyDocument } from '../shared/types';

async function completedTurn(response: Response): Promise<AssessmentResult> {
  expect(response.ok()).toBe(true);
  if (!response.headers()['content-type']?.includes('text/event-stream')) return response.json();
  const frames = (await response.text()).split(/\r?\n\r?\n/);
  for (const frame of frames) {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    const event = JSON.parse(data);
    if (event.type === 'error') throw new Error(event.error);
    if (event.type === 'complete') return event.result;
  }
  throw new Error('The study stream ended without a validated completion.');
}

test('failed concept generation keeps the uploaded PDF available for retry', async ({ page }) => {
  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), liveAvailable: true } });
  });
  let attempts = 0;
  let originalDocumentId = '';
  await page.route('**/api/concepts', async route => {
    const request = route.request().postDataJSON();
    const document = request.documents[0];
    if (++attempts === 1) {
      originalDocumentId = document.id;
      await route.fulfill({ status: 504, json: { code: 'PROVIDER_TIMEOUT', error: 'The study provider took too long to respond. Your notes are still here; retry preparing your study plan.' } });
    } else {
      expect(document.id).toBe(originalDocumentId);
      expect(document.spans.some((span: { text: string }) => /random/i.test(span.text))).toBe(true);
      await route.fulfill({ json: { concepts: [{ id: 'retry-concept', title: 'Recovered study plan', description: 'The same extracted notes were used on retry.', question: 'What does random assignment establish?', sourceIds: [document.spans[0].id], status: 'not-discussed' }] } });
    }
  });
  await page.goto('/');
  await page.getByLabel('Choose PDF files').setInputFiles(resolve('public/examples/Experiments_and_Causal_Claims.pdf'));
  await page.getByRole('button', { name: 'Prepare my session' }).click();
  await expect(page.getByRole('alert')).toContainText('Your notes are still here');
  await expect(page.getByRole('button', { name: 'Remove Experiments_and_Causal_Claims.pdf' })).toBeVisible();
  await page.getByRole('button', { name: 'Prepare my session' }).click();
  await expect(page.getByRole('heading', { name: 'Recovered study plan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start teaching' })).toBeEnabled();
});

test('live provider: PDF upload produces grounded concepts and a study prompt', async ({ page }) => {
  test.skip(process.env.STU_LIVE_SMOKE !== '1' && process.env.MISO_LIVE_SMOKE !== '1', 'Opt in explicitly; this sends synthetic lecture text to the configured provider.');
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByLabel('Choose PDF files').setInputFiles(resolve('public/examples/Experiments_and_Causal_Claims.pdf'));
  const outlineResponse = page.waitForResponse(response => response.url().endsWith('/api/concepts'), { timeout: 85_000 });
  await page.getByRole('button', { name: 'Prepare my session' }).click();
  const outline = await outlineResponse;
  expect(outline.ok(), JSON.stringify(await outline.json())).toBe(true);
  await expect(page.locator('.concept-card').first()).toBeVisible();
  await expect(page.getByText('Sample demo', { exact: true })).toHaveCount(0);
  const turnResponse = page.waitForResponse(response => response.url().endsWith('/api/turn'), { timeout: 65_000 });
  await page.getByRole('button', { name: 'Start teaching' }).click();
  const turn = await turnResponse;
  const result = await completedTurn(turn);
  expect(result.sourceIds.length).toBeGreaterThan(0);
  await expect(page.locator('.conversation-current h2')).not.toBeEmpty();
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  await page.screenshot({ path: 'artifacts/miso-live-upload.png', fullPage: true });
});

test('live provider: unfamiliar pasted notes support a grounded typed explanation, source help and recap', async ({ page }) => {
  test.skip(process.env.STU_LIVE_SMOKE !== '1' && process.env.MISO_LIVE_SMOKE !== '1', 'Opt in explicitly; this sends synthetic lecture text to the configured provider.');
  test.setTimeout(300_000);
  const title = 'Lumenmoss field notes — synthetic ecology';
  const explanation = 'In mature lumenmoss, veil channels hold water between the leaves, so a larger channel reserve can delay drying. This reserve definition applies to mature mats, not newly sprouted filaments. At dusk the release gate opens only when both shade and cool air are present; either condition alone leaves it closed. Opening the gate redistributes existing water and does not create new water. The measured survival window is the time until the mat falls below the stated water threshold, not the lifespan of the organism. A longer measured window therefore supports delayed drying under those conditions, not a claim of longer lifetime survival.';
  const notes = `These are original synthetic ecology notes for a study-system test.\n\nVeil-channel reserve\nIn mature lumenmoss, veil channels hold water between the leaves. A larger channel reserve can delay drying. This reserve definition applies to mature mats, not newly sprouted filaments.\n\nDusk release gate\nAt dusk the release gate opens only when both shade and cool air are present. Either condition alone leaves it closed. Opening the gate redistributes existing water and does not create new water.\n\nMeasured survival window\nThe measured survival window is the time until the mat falls below the stated water threshold, not the lifespan of the organism. A longer measured window supports delayed drying under those conditions, not a claim of longer lifetime survival.`;
  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), voiceAvailable: false, voiceProvider: 'Off', voiceKey: null } });
  });
  await page.addInitScript(() => {
    const state = { microphoneRequests: 0 };
    Object.defineProperty(window, '__misoVoiceTest', { value: state });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: () => {
      state.microphoneRequests++;
      return Promise.reject(new DOMException('Text-only test must not request a microphone.', 'NotAllowedError'));
    } });
  });
  const audioRequests: string[] = [];
  page.on('request', request => { if (/\/api\/(transcribe|speech)$/.test(request.url())) audioRequests.push(request.url()); });
  const configResponse = page.waitForResponse('**/api/config');
  await page.goto('/');
  const config = await (await configResponse).json();
  expect(config.voiceProvider).toBe('Off');
  expect(config.voiceAvailable).toBe(false);
  await page.getByRole('button', { name: 'Paste notes', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Lecture text').fill(notes);
  await page.getByRole('button', { name: 'Add these notes' }).click();
  const outlineResponse = page.waitForResponse(response => response.url().endsWith('/api/concepts'), { timeout: 85_000 });
  await page.getByRole('button', { name: 'Prepare my session' }).click();
  const outline = await outlineResponse;
  expect(outline.ok(), JSON.stringify(await outline.json())).toBe(true);
  const concepts = (await outline.json()).concepts as Concept[];
  const input = outline.request().postDataJSON() as { mode: string; documents: StudyDocument[] };
  expect(input.mode).toBe('live');
  expect(input.documents[0].name).toBe(title);
  const spans = new Map<string, SourceSpan>(input.documents.flatMap(document => document.spans).map(span => [span.id, span]));
  expect(concepts.length).toBeGreaterThan(0);
  for (const concept of concepts) {
    expect(concept.title.trim()).not.toBe('');
    expect(concept.question.trim()).not.toBe('');
    expect(concept.sourceIds.length).toBeGreaterThan(0);
    for (const id of concept.sourceIds) expect(spans.has(id)).toBe(true);
  }
  // Keep one editable, document-derived concept rather than relying on a model's ordering or wording.
  const choices = page.locator('.concept-check input');
  for (let i = 0; i < concepts.length; i++) await choices.nth(i).setChecked(i === 0);
  await page.getByRole('button', { name: 'Start teaching' }).click();
  await expect(page.locator('.pasted-document-heading')).toContainText(title);
  await expect(page.getByRole('button', { name: 'Start explaining' })).toBeEnabled();
  await page.getByRole('button', { name: 'Start explaining' }).click();
  const editor = page.getByRole('textbox', { name: 'Your explanation' });
  await expect(editor).toBeFocused();
  expect(await page.evaluate(() => Reflect.get(window, '__misoVoiceTest').microphoneRequests)).toBe(0);
  await editor.fill(explanation);
  const answerResponse = page.waitForResponse(response => response.url().endsWith('/api/turn') && response.request().postDataJSON().action === 'answer', { timeout: 85_000 });
  await page.getByRole('button', { name: 'Send explanation' }).click();
  const answer = await answerResponse;
  const assessed = await completedTurn(answer);
  expect(assessed.status).toBe('explained-independently');
  expect(assessed.evidence.some(record => record.kind === 'explained' && record.studentText === explanation)).toBe(true);
  for (const id of assessed.sourceIds) expect(spans.has(id)).toBe(true);
  await expect(editor).toHaveValue('');
  const helpResponse = page.waitForResponse(response => response.url().endsWith('/api/turn') && response.request().postDataJSON().action === 'source', { timeout: 85_000 });
  await page.getByRole('button', { name: 'Show me in the notes' }).click();
  const help = await helpResponse;
  const supported = await completedTurn(help);
  expect(supported.sourceIds.length).toBeGreaterThan(0);
  for (const id of supported.sourceIds) expect(spans.has(id)).toBe(true);
  await expect(page.getByRole('note', { name: 'Referenced source passages' })).toBeVisible();
  for (const quote of await page.locator('.source-quote-card blockquote').allTextContents()) {
    expect([...spans.values()].some(span => span.text === quote)).toBe(true);
  }
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByRole('heading', { name: 'Ideas you explained' })).toBeVisible();
  for (const evidence of [...assessed.evidence, ...supported.evidence]) {
    expect(evidence.sourceIds.length).toBeGreaterThan(0);
    for (const id of evidence.sourceIds) expect(spans.has(id)).toBe(true);
    await expect(page.locator('.recap-item').filter({ hasText: evidence.summary }).first()).toBeVisible();
  }
  await page.locator('.recap-item .citations button').first().click();
  await expect(page.locator('.pasted-document-heading')).toContainText(title);
  await expect(page.getByRole('note', { name: 'Referenced source passages' })).toBeVisible();
  expect(audioRequests).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(window, '__misoVoiceTest').microphoneRequests)).toBe(0);
});

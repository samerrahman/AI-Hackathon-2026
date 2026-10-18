import { test, expect, type Page } from '@playwright/test';

interface VoiceFixture {
  stoppedTracks: number;
  recordingStops: number;
  transcriptionRequests: number;
  transcriptionSignal: AbortSignal | null;
  deferPermission: boolean;
  releasePermission: () => void;
  releaseTranscript: () => void;
}

declare global {
  interface Window { __stuVoiceTest: VoiceFixture }
}

// These tests exercise cancellation and draft ownership, not provider accuracy or
// real audio capture. The delayed fetch deliberately ignores AbortSignal so the
// hook must also reject the obsolete result using its generation guard.
async function mockVoice(page: Page) {
  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), voiceAvailable: true } });
  });
  await page.addInitScript(() => {
    const fixture: VoiceFixture = {
      stoppedTracks: 0, recordingStops: 0, transcriptionRequests: 0,
      transcriptionSignal: null, deferPermission: false,
      releasePermission() {}, releaseTranscript() {},
    };
    window.__stuVoiceTest = fixture;
    const makeStream = () => ({ getTracks: () => [{ stop() { fixture.stoppedTracks += 1; } }] }) as unknown as MediaStream;
    navigator.mediaDevices.getUserMedia = async () => fixture.deferPermission
      ? new Promise(resolve => { fixture.releasePermission = () => resolve(makeStream()); })
      : makeStream();
    class RecordedAudio {
      static isTypeSupported() { return true; }
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        fixture.recordingStops += 1;
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob(['mock recorded audio'], { type: this.mimeType }) });
          this.onstop?.();
        });
      }
    }
    window.MediaRecorder = RecordedAudio as unknown as typeof MediaRecorder;
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (input === '/api/transcribe') {
        fixture.transcriptionRequests += 1;
        fixture.transcriptionSignal = init?.signal ?? null;
        return new Promise(resolve => {
          fixture.releaseTranscript = () => resolve(new Response(JSON.stringify({ text: 'A delayed voice transcript.' }), {
            headers: { 'Content-Type': 'application/json' },
          }));
        });
      }
      return realFetch(input, init);
    };
  });
}

async function openSample(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Try a sample session' }).click();
  await page.getByRole('button', { name: 'Sequences & convergence Real analysis' }).click();
  await expect(page.getByRole('textbox', { name: 'Your explanation' })).toBeVisible();
}

async function recordForTranscription(page: Page) {
  await page.getByRole('button', { name: 'Start explaining' }).click();
  await page.getByRole('button', { name: 'I’m done' }).click();
  await expect(page.locator('.character-state')).toContainText('Transcribing');
}

test('transcripts remain editable; a late transcript cannot overwrite a newer typed draft', async ({ page }) => {
  await mockVoice(page);
  await openSample(page);
  const editor = page.getByRole('textbox', { name: 'Your explanation' });
  const prompt = await page.locator('.stu-message .message-bubble').last().innerText();

  await recordForTranscription(page);
  await page.evaluate(() => window.__stuVoiceTest.releaseTranscript());
  await expect(editor).toHaveValue('A delayed voice transcript.');
  await expect(page.locator('.stu-message .message-bubble').last()).toHaveText(prompt);

  await recordForTranscription(page);
  await editor.fill('My newer explanation is still being written.');
  expect(await page.evaluate(() => window.__stuVoiceTest.transcriptionSignal?.aborted)).toBe(true);
  await page.evaluate(() => window.__stuVoiceTest.releaseTranscript());
  await expect(editor).toHaveValue('My newer explanation is still being written.');
  await expect(page.locator('.character-state')).not.toContainText('Transcribing');
});

test('submitting a typed draft cancels active recording and rejects a pending transcript', async ({ page }) => {
  await mockVoice(page);
  await openSample(page);
  const editor = page.getByRole('textbox', { name: 'Your explanation' });
  const explanation = 'Boundedness keeps the terms in a finite interval, but a bounded sequence can alternate and does not have to converge.';
  await editor.fill(explanation);
  await page.getByRole('button', { name: 'Start explaining' }).click();
  await expect(page.getByRole('button', { name: 'I’m done' })).toBeVisible();
  await page.getByRole('button', { name: 'Send explanation' }).click();
  await expect(editor).toHaveValue('');
  expect(await page.evaluate(() => window.__stuVoiceTest.stoppedTracks)).toBe(1);
  expect(await page.evaluate(() => window.__stuVoiceTest.transcriptionRequests)).toBe(0);

  await editor.fill(explanation);
  await recordForTranscription(page);
  await page.getByRole('button', { name: 'Send explanation' }).click();
  await expect(editor).toHaveValue('');
  expect(await page.evaluate(() => window.__stuVoiceTest.transcriptionSignal?.aborted)).toBe(true);
  await page.evaluate(() => window.__stuVoiceTest.releaseTranscript());
  await expect(editor).toHaveValue('');
  await expect(page.locator('.character-state')).not.toContainText('Transcribing');
});

test('canceling a pending microphone permission request closes a late-granted stream', async ({ page }) => {
  await mockVoice(page);
  await openSample(page);
  const editor = page.getByRole('textbox', { name: 'Your explanation' });
  await editor.fill('My draft stays here.');
  await page.evaluate(() => { window.__stuVoiceTest.deferPermission = true; });
  await page.getByRole('button', { name: 'Start explaining' }).click();
  await expect(page.locator('.character-state')).toContainText('Earnest. A little confused.');
  await page.getByRole('button', { name: /Cancel.*(permission|microphone)/i }).click();
  await page.evaluate(() => window.__stuVoiceTest.releasePermission());
  await expect.poll(() => page.evaluate(() => window.__stuVoiceTest.stoppedTracks)).toBe(1);
  await expect(page.getByRole('button', { name: 'I’m done' })).toHaveCount(0);
  await expect(editor).toHaveValue('My draft stays here.');
});

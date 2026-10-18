import { test, expect, type Page } from '@playwright/test';

interface VoiceFixture {
  stoppedTracks: number;
  recordingStops: number;
  transcriptionRequests: number;
  transcriptionSignal: AbortSignal | null;
  deferPermission: boolean;
  releasePermission: () => void;
  releaseTranscript: () => void;
  uploadedFormat: { name: string; mime: string; marker: string; rate: number; channels: number; bits: number } | null;
  closedContexts: number;
  deferDecode: boolean;
  decoding: boolean;
  releaseDecode: () => void;
  speechRequests: string[];
  speechSignals: AbortSignal[];
  playbackStarts: number;
  activePlayback: number;
  maxActivePlayback: number;
  finishPlayback: () => void;
}

declare global {
  interface Window { __misoVoiceTest: VoiceFixture }
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
      uploadedFormat: null, closedContexts: 0, deferDecode: false, decoding: false, releaseDecode() {},
      speechRequests: [], speechSignals: [], playbackStarts: 0, activePlayback: 0, maxActivePlayback: 0, finishPlayback() {},
    };
    window.__misoVoiceTest = fixture;
    const makeStream = () => ({ getTracks: () => [{ stop() { fixture.stoppedTracks += 1; } }] }) as unknown as MediaStream;
    navigator.mediaDevices.getUserMedia = async () => fixture.deferPermission
      ? new Promise(resolve => { fixture.releasePermission = () => resolve(makeStream()); })
      : makeStream();
    // A real 48kHz stereo PCM fixture is decoded by the browser's AudioContext.
    // The production hook must produce 16kHz mono, rather than merely rename it.
    const recorded = new ArrayBuffer(44 + 12000 * 4);
    const header = new DataView(recorded);
    for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) {
      for (let index = 0; index < text.length; index++) header.setUint8(offset + index, text.charCodeAt(index));
    }
    header.setUint32(4, recorded.byteLength - 8, true); header.setUint32(16, 16, true);
    header.setUint16(20, 1, true); header.setUint16(22, 2, true); header.setUint32(24, 48000, true);
    header.setUint32(28, 192000, true); header.setUint16(32, 4, true); header.setUint16(34, 16, true);
    header.setUint32(40, recorded.byteLength - 44, true);
    for (let sample = 0; sample < 12000; sample++) {
      const value = Math.round(Math.sin(2 * Math.PI * 440 * sample / 48000) * 4000);
      header.setInt16(44 + sample * 4, value, true); header.setInt16(46 + sample * 4, value, true);
    }
    const close = AudioContext.prototype.close;
    AudioContext.prototype.close = function () { fixture.closedContexts++; return close.call(this); };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (buffer: ArrayBuffer) {
      const decoded = await decode.call(this, buffer);
      if (!fixture.deferDecode) return decoded;
      fixture.decoding = true;
      return new Promise(resolve => { fixture.releaseDecode = () => resolve(decoded); });
    };
    class RecordedAudio {
      static isTypeSupported() { return true; }
      state = 'inactive';
      mimeType = 'audio/wav';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        fixture.recordingStops += 1;
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob([recorded], { type: this.mimeType }) });
          this.onstop?.();
        });
      }
    }
    window.MediaRecorder = RecordedAudio as unknown as typeof MediaRecorder;
    class ControlledPlayback {
      onplaying: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      active = false;
      async play() {
        this.active = true;
        fixture.playbackStarts++;
        fixture.activePlayback++;
        fixture.maxActivePlayback = Math.max(fixture.maxActivePlayback, fixture.activePlayback);
        fixture.finishPlayback = () => { this.pause(); this.onended?.(); };
        this.onplaying?.();
      }
      pause() { if (this.active) { this.active = false; fixture.activePlayback--; } }
      removeAttribute() {}
      load() {}
    }
    window.Audio = ControlledPlayback as unknown as typeof Audio;
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (input === '/api/speech') {
        fixture.speechRequests.push(JSON.parse(String(init?.body)).text);
        if (init?.signal) fixture.speechSignals.push(init.signal);
        return Promise.resolve(new Response(recorded, { headers: { 'Content-Type': 'audio/wav' } }));
      }
      if (input === '/api/transcribe') {
        fixture.transcriptionSignal = init?.signal ?? null;
        return (async () => {
          const audio = (init?.body as FormData).get('audio') as File;
          const bytes = await audio.arrayBuffer();
          const view = new DataView(bytes);
          fixture.uploadedFormat = { name: audio.name, mime: audio.type, marker: new TextDecoder().decode(bytes.slice(0, 4)), rate: view.getUint32(24, true), channels: view.getUint16(22, true), bits: view.getUint16(34, true) };
          fixture.transcriptionRequests += 1;
          return new Promise<Response>(resolve => {
            fixture.releaseTranscript = () => resolve(new Response(JSON.stringify({ text: 'A delayed voice transcript.' }), {
              headers: { 'Content-Type': 'application/json' },
            }));
          });
        })();
      }
      return realFetch(input, init);
    };
  });
}

async function openSample(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Try a sample session' }).click();
  await page.getByRole('button', { name: 'Sequences & convergence Real analysis' }).click();
  await page.getByRole('button', { name: 'Start teaching' }).click();
  await expect(page.getByRole('button', { name: 'Give me a hint' })).toBeEnabled();
}

async function recordForTranscription(page: Page) {
  const requests = await page.evaluate(() => window.__misoVoiceTest.transcriptionRequests);
  await page.getByRole('button', { name: 'Start explaining' }).click();
  await page.getByRole('button', { name: 'I’m done' }).click();
  await expect(page.locator('.character-state')).toContainText('Transcribing');
  await expect.poll(() => page.evaluate(() => window.__misoVoiceTest.transcriptionRequests)).toBe(requests + 1);
}

test('transcripts remain editable; a late transcript cannot overwrite a newer typed draft', async ({ page }) => {
  await mockVoice(page);
  await openSample(page);
  const editor = page.getByRole('textbox', { name: 'Your explanation' });
  const prompt = await page.locator('.conversation-current h2').innerText();

  await recordForTranscription(page);
  expect(await page.evaluate(() => window.__misoVoiceTest.uploadedFormat)).toEqual({ name: 'explanation.wav', mime: 'audio/wav', marker: 'RIFF', rate: 16000, channels: 1, bits: 16 });
  expect(await page.evaluate(() => window.__misoVoiceTest.closedContexts)).toBe(1);
  await page.evaluate(() => window.__misoVoiceTest.releaseTranscript());
  await expect(editor).toHaveValue('A delayed voice transcript.');
  await expect(page.locator('.conversation-current h2')).toHaveText(prompt);

  await recordForTranscription(page);
  await editor.fill('My newer explanation is still being written.');
  expect(await page.evaluate(() => window.__misoVoiceTest.transcriptionSignal?.aborted)).toBe(true);
  await page.evaluate(() => window.__misoVoiceTest.releaseTranscript());
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
  expect(await page.evaluate(() => window.__misoVoiceTest.stoppedTracks)).toBe(1);
  expect(await page.evaluate(() => window.__misoVoiceTest.transcriptionRequests)).toBe(0);

  await editor.fill(explanation);
  await recordForTranscription(page);
  await page.getByRole('button', { name: 'Send explanation' }).click();
  await expect(editor).toHaveValue('');
  expect(await page.evaluate(() => window.__misoVoiceTest.transcriptionSignal?.aborted)).toBe(true);
  await page.evaluate(() => window.__misoVoiceTest.releaseTranscript());
  await expect(editor).toHaveValue('');
  await expect(page.locator('.character-state')).not.toContainText('Transcribing');
});

test('canceling a pending microphone permission request closes a late-granted stream', async ({ page }) => {
  await mockVoice(page);
  await openSample(page);
  const editor = page.getByRole('textbox', { name: 'Your explanation' });
  await editor.fill('My draft stays here.');
  await page.evaluate(() => { window.__misoVoiceTest.deferPermission = true; });
  await page.getByRole('button', { name: 'Start explaining' }).click();
  await expect(page.locator('.character-state')).toContainText('Waiting for microphone permission');
  await page.getByRole('button', { name: /Cancel.*(permission|microphone)/i }).click();
  await page.evaluate(() => window.__misoVoiceTest.releasePermission());
  await expect.poll(() => page.evaluate(() => window.__misoVoiceTest.stoppedTracks)).toBe(1);
  await expect(page.getByRole('button', { name: 'I’m done' })).toHaveCount(0);
  await expect(editor).toHaveValue('My draft stays here.');
});

test('canceling audio conversion closes its context and never uploads the late result', async ({ page }) => {
  await mockVoice(page);
  await openSample(page);
  await page.evaluate(() => { window.__misoVoiceTest.deferDecode = true; });
  await page.getByRole('button', { name: 'Start explaining' }).click();
  await page.getByRole('button', { name: 'I’m done' }).click();
  await expect.poll(() => page.evaluate(() => window.__misoVoiceTest.decoding)).toBe(true);
  await page.getByRole('textbox', { name: 'Your explanation' }).fill('I will explain this in writing.');
  await expect.poll(() => page.evaluate(() => window.__misoVoiceTest.closedContexts)).toBe(1);
  await page.evaluate(() => window.__misoVoiceTest.releaseDecode());
  await expect(page.locator('.character-state')).not.toContainText('Transcribing');
  expect(await page.evaluate(() => window.__misoVoiceTest.transcriptionRequests)).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Your explanation' })).toHaveValue('I will explain this in writing.');
});

test('long speech plays phrases in order with one prefetch and stops the remaining queue', async ({ page }) => {
  await mockVoice(page);
  const longReply = 'The size of a sequence and its direction are separate properties. A bound keeps terms in a fixed interval, while convergence describes the whole tail approaching a limit. '.repeat(7).trim();
  await page.route('**/api/turn', async route => {
    const response = await route.fetch({ headers: { ...route.request().headers(), accept: 'application/json' } });
    await route.fulfill({ json: { ...await response.json(), visibleText: longReply, spokenText: longReply } });
  });
  await openSample(page);
  await page.getByRole('button', { name: 'Replay reply' }).click();
  await expect.poll(() => page.evaluate(() => window.__misoVoiceTest.playbackStarts)).toBe(1);
  expect(await page.evaluate(() => window.__misoVoiceTest.speechRequests.length)).toBe(2);
  expect(await page.evaluate(() => window.__misoVoiceTest.speechRequests.every(text => text.length <= 350))).toBe(true);
  expect(longReply.startsWith(await page.evaluate(() => window.__misoVoiceTest.speechRequests.join('')))).toBe(true);
  await page.evaluate(() => window.__misoVoiceTest.finishPlayback());
  await expect.poll(() => page.evaluate(() => window.__misoVoiceTest.playbackStarts)).toBe(2);
  expect(await page.evaluate(() => window.__misoVoiceTest.speechRequests.length)).toBe(3);
  expect(await page.evaluate(() => window.__misoVoiceTest.maxActivePlayback)).toBe(1);
  await page.getByRole('button', { name: 'Stop speaking', exact: true }).click();
  await expect(page.locator('.character-state')).not.toContainText('Speaking');
  expect(await page.evaluate(() => window.__misoVoiceTest.activePlayback)).toBe(0);
  expect(await page.evaluate(() => window.__misoVoiceTest.speechSignals.every(signal => signal.aborted))).toBe(true);
  await page.evaluate(() => window.__misoVoiceTest.finishPlayback());
  expect(await page.evaluate(() => window.__misoVoiceTest.speechRequests.length)).toBe(3);
  expect(await page.evaluate(() => window.__misoVoiceTest.playbackStarts)).toBe(2);
});

test('native Chrome WebM recording converts to PCM WAV before the editable transcript', async ({ page }) => {
  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), voiceAvailable: true } });
  });
  await page.addInitScript(() => {
    const fixture = {
      recordingMime: '', chunks: 0,
      converted: null as null | { name: string; mime: string; marker: string; rate: number; channels: number; bits: number; dataBytes: number; hasSignal: boolean },
      cleanup: async () => {},
    };
    Object.assign(window, { __stuNativeRecorder: fixture });
    navigator.mediaDevices.getUserMedia = async () => {
      const source = new AudioContext({ sampleRate: 48000 });
      await source.resume();
      const oscillator = source.createOscillator();
      const gain = source.createGain();
      const destination = source.createMediaStreamDestination();
      oscillator.frequency.value = 440;
      gain.gain.value = 0.1;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      fixture.cleanup = async () => {
        destination.stream.getTracks().forEach(track => track.stop());
        oscillator.stop();
        await source.close();
      };
      return destination.stream;
    };
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (timeslice?: number) {
      fixture.recordingMime = this.mimeType;
      this.addEventListener('dataavailable', event => { if (event.data.size) fixture.chunks++; });
      start.call(this, timeslice);
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (input !== '/api/transcribe') return realFetch(input, init);
      const file = (init?.body as FormData).get('audio') as File;
      const bytes = await file.arrayBuffer();
      const view = new DataView(bytes);
      let hasSignal = false;
      for (let offset = 44; offset + 1 < bytes.byteLength; offset += 2) {
        if (Math.abs(view.getInt16(offset, true)) > 100) { hasSignal = true; break; }
      }
      fixture.converted = {
        name: file.name, mime: file.type, marker: new TextDecoder().decode(bytes.slice(0, 4)),
        rate: view.getUint32(24, true), channels: view.getUint16(22, true), bits: view.getUint16(34, true),
        dataBytes: view.getUint32(40, true), hasSignal,
      };
      return new Response(JSON.stringify({ text: 'The native recording reached the transcript editor.' }), { headers: { 'Content-Type': 'application/json' } });
    };
  });
  await openSample(page);
  await page.getByRole('button', { name: 'Start explaining' }).click();
  // Wait for actual encoded microphone data rather than sleeping for a guessed duration.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __stuNativeRecorder: { chunks: number } }).__stuNativeRecorder.chunks)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'I’m done' }).click();
  const editor = page.getByRole('textbox', { name: 'Your explanation' });
  await expect(editor).toHaveValue('The native recording reached the transcript editor.');
  const result = await page.evaluate(() => {
    const fixture = (window as unknown as { __stuNativeRecorder: { recordingMime: string; converted: Record<string, unknown> } }).__stuNativeRecorder;
    return { recordingMime: fixture.recordingMime, converted: fixture.converted };
  });
  expect(result.recordingMime).toMatch(/^audio\/webm/);
  expect(result.converted).toMatchObject({ name: 'explanation.wav', mime: 'audio/wav', marker: 'RIFF', rate: 16000, channels: 1, bits: 16, hasSignal: true });
  expect(result.converted.dataBytes).toBeGreaterThan(1600);
  await editor.fill('I can correct this transcript before sending.');
  await expect(editor).toHaveValue('I can correct this transcript before sending.');
  await page.evaluate(() => (window as unknown as { __stuNativeRecorder: { cleanup: () => Promise<void> } }).__stuNativeRecorder.cleanup());
});

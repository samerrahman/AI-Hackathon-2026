import { test, expect } from '@playwright/test';
import type { AssessmentResult } from '../shared/types';

interface LiveVoiceFixture {
  microphoneRequests: number;
  stoppedTracks: number;
  transcriptionRequests: number;
  playbackStarts: number;
  players: HTMLAudioElement[];
  speechRequests: string[];
  speechSignals: AbortSignal[];
  uploadedFormat: { mime: string; marker: string; rate: number; channels: number; bits: number } | null;
}

declare global {
  interface Window { __stuLiveVoice: LiveVoiceFixture }
}

// Opt-in paid-provider smoke test. The recording fixture is synthetic speech from
// real StepFun TTS. AudioContext decoding, WAV conversion, ASR requests, chat,
// response synthesis and native browser playback are all real. No physical
// microphone capture or human speech recognition quality is claimed by this test.
test('live StepFun audio: synthetic recording → editable transcript → shared chat → native playback', async ({ page, request }) => {
  test.skip(process.env.STU_LIVE_AUDIO !== '1', 'Set STU_LIVE_AUDIO=1 to use the configured StepFun audio account.');
  test.setTimeout(240_000);
  const config = await (await request.get('/api/config')).json();
  expect(config.voiceProvider, 'Select VOICE_PROVIDER=stepfun before the live audio test.').toBe('StepFun');
  expect(config.voiceAvailable, 'The server must have STEPFUN_API_KEY configured.').toBe(true);

  const seed = await request.post('/api/speech', {
    data: { text: 'A bounded sequence stays in a fixed interval. It can alternate forever and does not have to converge.' },
    timeout: 120_000,
  });
  expect(seed.status(), 'StepFun must accept the configured speech model and voice.').toBe(200);
  expect(seed.headers()['content-type']).toContain('audio/wav');
  const recording = await seed.body();
  expect(recording.toString('ascii', 0, 4)).toBe('RIFF');

  await page.addInitScript(({ base64 }) => {
    const fixture: LiveVoiceFixture = {
      microphoneRequests: 0, stoppedTracks: 0, transcriptionRequests: 0,
      playbackStarts: 0, players: [], speechRequests: [], speechSignals: [], uploadedFormat: null,
    };
    window.__stuLiveVoice = fixture;
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    navigator.mediaDevices.getUserMedia = async () => {
      fixture.microphoneRequests++;
      return { getTracks: () => [{ stop() { fixture.stoppedTracks++; } }] } as unknown as MediaStream;
    };
    class SyntheticRecorder {
      static isTypeSupported() { return true; }
      state = 'inactive';
      mimeType = 'audio/wav';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob([bytes], { type: this.mimeType }) });
          this.onstop?.();
        });
      }
    }
    window.MediaRecorder = SyntheticRecorder as unknown as typeof MediaRecorder;
    // Observe native browser audio; do not replace playback with a fake event.
    const NativeAudio = window.Audio;
    window.Audio = new Proxy(NativeAudio, {
      construct(target, args) {
        const audio = Reflect.construct(target, args) as HTMLAudioElement;
        fixture.players.push(audio);
        audio.addEventListener('playing', () => { fixture.playbackStarts++; });
        return audio;
      },
    });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (input === '/api/transcribe') {
        fixture.transcriptionRequests++;
        const file = (init?.body as FormData).get('audio') as File;
        const buffer = await file.arrayBuffer();
        const header = new DataView(buffer);
        fixture.uploadedFormat = {
          mime: file.type, marker: new TextDecoder().decode(buffer.slice(0, 4)),
          rate: header.getUint32(24, true), channels: header.getUint16(22, true), bits: header.getUint16(34, true),
        };
      }
      if (input === '/api/speech') {
        fixture.speechRequests.push(JSON.parse(String(init?.body)).text);
        if (init?.signal) fixture.speechSignals.push(init.signal);
      }
      return realFetch(input, init);
    };
  }, { base64: recording.toString('base64') });

  const turns: Record<string, unknown>[] = [];
  page.on('request', incoming => {
    if (incoming.url().endsWith('/api/turn')) turns.push(incoming.postDataJSON());
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Try a sample session' }).click();
  await page.getByRole('button', { name: 'Sequences & convergence Real analysis' }).click();
  await page.getByRole('button', { name: 'Start teaching' }).click();
  await expect(page.getByRole('button', { name: 'Give me a hint' })).toBeEnabled();
  await expect(page.locator('.demo-explainer')).toContainText('Sample demo');
  expect(await page.evaluate(() => window.__stuLiveVoice.microphoneRequests)).toBe(0);

  const editor = page.getByRole('textbox', { name: 'Your explanation' });
  const opening = await page.locator('.conversation-current h2').innerText();
  const turnsBeforeRecording = turns.length;
  await page.getByRole('button', { name: 'Record explanation', exact: true }).click();
  await expect(page.locator('.recording-label')).toContainText('Recording');
  await expect(page.locator('.companion-character [role="img"]')).toHaveAttribute('data-state', 'listening');
  const transcriptResponse = page.waitForResponse(response => response.url().endsWith('/api/transcribe'), { timeout: 75_000 });
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  const transcribed = await transcriptResponse;
  expect(transcribed.status()).toBe(200);
  await expect(editor).toHaveValue(/bounded/i, { timeout: 75_000 });
  const transcript = await editor.inputValue();
  expect(transcript).toMatch(/interval/i);
  expect(transcript).toMatch(/(?:not|doesn't).*converg/i);
  expect(await page.evaluate(() => window.__stuLiveVoice.uploadedFormat)).toEqual({ mime: 'audio/wav', marker: 'RIFF', rate: 16000, channels: 1, bits: 16 });
  expect(turns.length, 'Transcription must stay editable rather than auto-submit.').toBe(turnsBeforeRecording);
  await expect(page.locator('.conversation-current h2')).toHaveText(opening);

  await page.getByRole('button', { name: 'Study settings' }).click();
  const spoken = page.getByRole('button', { name: 'Spoken replies', exact: true });
  await expect(spoken).toHaveAttribute('aria-pressed', 'false');
  await spoken.click();
  await expect(spoken).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Close dialog' }).click();

  const edited = `${transcript.trim()} For example, alternating between minus one and one stays bounded but does not converge.`;
  await editor.fill(edited);
  const answerResponse = page.waitForResponse(response => response.url().endsWith('/api/turn') && response.request().postDataJSON().action === 'answer');
  const speechResponse = page.waitForResponse(response => response.url().endsWith('/api/speech'), { timeout: 125_000 });
  await page.getByRole('button', { name: 'Send explanation' }).click();
  const answer = await answerResponse;
  expect(answer.status()).toBe(200);
  const events = (await answer.text()).split(/\r?\n\r?\n/)
    .filter(frame => frame.startsWith('data: ')).map(frame => JSON.parse(frame.slice(6)));
  const result = events.find(event => event.type === 'complete')?.result as AssessmentResult | undefined;
  expect(result).toBeTruthy();
  expect(result!.evidence.some(evidence => evidence.kind === 'explained' && evidence.studentText === edited)).toBe(true);
  const submitted = turns.at(-1)!;
  expect(submitted.text).toBe(edited);
  expect(submitted.sessionId).toBe(turns[0].sessionId);
  expect(submitted.mode).toBe('demo'); // Only voice uses the paid provider in this test.
  expect((submitted.history as unknown[]).length).toBeGreaterThan(0);
  await expect(editor).toHaveValue('');
  await expect(page.locator('.conversation-current h2')).not.toHaveText(opening);
  expect((await speechResponse).status()).toBe(200);
  await expect.poll(() => page.evaluate(() => window.__stuLiveVoice.playbackStarts), { timeout: 125_000 }).toBeGreaterThan(0);
  await expect(page.locator('.companion-character [role="img"]')).toHaveAttribute('data-state', 'speaking');
  await expect(page.locator('.character-state')).toContainText('AI-generated voice');
  await page.screenshot({ path: 'artifacts/stu-voice.png', fullPage: true });

  await page.getByRole('button', { name: 'Stop speaking', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__stuLiveVoice.players.every(player => player.paused))).toBe(true);
  await expect(page.locator('.character-state')).not.toContainText('Speaking');
  const playbackStarts = await page.evaluate(() => window.__stuLiveVoice.playbackStarts);
  const replayResponse = page.waitForResponse(response => response.url().endsWith('/api/speech'), { timeout: 125_000 });
  await page.getByRole('button', { name: 'Replay reply', exact: true }).click();
  expect((await replayResponse).status()).toBe(200);
  await expect.poll(() => page.evaluate(() => window.__stuLiveVoice.playbackStarts), { timeout: 125_000 }).toBeGreaterThan(playbackStarts);

  // Activating the microphone interrupts native playback; canceling records no transcript.
  await page.getByRole('button', { name: 'Record explanation', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__stuLiveVoice.players.every(player => player.paused))).toBe(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => window.__stuLiveVoice.transcriptionRequests)).toBe(1);
  expect(await page.evaluate(() => window.__stuLiveVoice.speechSignals.every(signal => signal.aborted))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__stuLiveVoice.stoppedTracks)).toBe(2);

  await page.getByRole('button', { name: 'Record explanation', exact: true }).click();
  await page.getByRole('button', { name: 'Pause session' }).click();
  await expect(page.getByRole('button', { name: 'Resume session' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__stuLiveVoice.stoppedTracks)).toBe(3);
  expect(await page.evaluate(() => window.__stuLiveVoice.transcriptionRequests)).toBe(1);
  expect(await page.evaluate(() => window.__stuLiveVoice.players.every(player => player.paused))).toBe(true);
});

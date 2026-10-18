import { useCallback, useEffect, useRef, useState } from 'react';

interface VoiceOptions {
  enabled: boolean;
  /** Place this text in an editable draft. Do not submit it automatically. */
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}

const MAX_RECORDING_BYTES = 12 * 1024 * 1024;
const MAX_RECORDING_MS = 3 * 60 * 1000;

function recordingError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Microphone access was not allowed. You can type your explanation, or allow microphone access in your browser and try again.';
    }
    if (error.name === 'NotFoundError') return 'No microphone was found. You can type your explanation instead.';
    if (error.name === 'NotReadableError') return 'Your microphone is unavailable or in use by another app. You can keep going by typing.';
  }
  return 'The microphone could not start. You can type your explanation instead.';
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error;
    }
  } catch { /* A connection error can return a non-JSON response. */ }
  return fallback;
}

/**
 * Explicit microphone → editable transcript, and cancellable response playback.
 * The caller should dispose on session/concept changes as well as interruption.
 * Recording bytes exist only until transcription completes or is canceled.
 */
export function useVoice(options: VoiceOptions) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const mounted = useRef(true);
  const [recording, setRecording] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechLoading, setSpeechLoading] = useState(false);

  const captureGeneration = useRef(0);
  const playbackGeneration = useRef(0);
  const microphonePending = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptionRequest = useRef<AbortController | null>(null);
  const speechRequest = useRef<AbortController | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);

  const stopTracks = useCallback(() => {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    recordingTimer.current = null;
  }, []);

  const cancelRecording = useCallback(() => {
    // getUserMedia cannot be aborted; its eventual stream is rejected by this token.
    captureGeneration.current += 1;
    microphonePending.current = false;
    transcriptionRequest.current?.abort();
    transcriptionRequest.current = null;
    const current = recorder.current;
    recorder.current = null;
    if (current) {
      current.ondataavailable = null;
      current.onstop = null;
      current.onerror = null;
      if (current.state !== 'inactive') current.stop();
    }
    stopTracks();
    if (mounted.current) {
      setRecording(false);
      setRequestingPermission(false);
      setTranscribing(false);
    }
  }, [stopTracks]);

  const stopPlayback = useCallback(() => {
    playbackGeneration.current += 1;
    speechRequest.current?.abort();
    speechRequest.current = null;
    const current = player.current;
    player.current = null;
    if (current) {
      current.onplaying = null;
      current.onended = null;
      current.onerror = null;
      current.pause();
      current.removeAttribute('src');
      current.load();
    }
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
    if (mounted.current) {
      setSpeaking(false);
      setSpeechLoading(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    const current = recorder.current;
    if (current?.state === 'recording') {
      current.stop();
      if (mounted.current) setRecording(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (microphonePending.current || recorder.current) return;
    if (!callbacks.current.enabled) {
      callbacks.current.onError('Voice is not configured on this server. Type your explanation to continue.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      callbacks.current.onError('Recording is not supported in this browser. Use a current browser on HTTPS or localhost, or type your explanation.');
      return;
    }

    cancelRecording();
    stopPlayback();
    const generation = captureGeneration.current;
    microphonePending.current = true;
    setRequestingPermission(true);
    const isCurrent = () => mounted.current && generation === captureGeneration.current && callbacks.current.enabled;

    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!isCurrent()) {
        acquired.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = acquired;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
        .find(type => MediaRecorder.isTypeSupported(type));
      const current = new MediaRecorder(acquired, mimeType ? { mimeType } : undefined);
      recorder.current = current;
      let chunks: Blob[] = [];
      let byteSize = 0;

      current.ondataavailable = event => {
        if (!isCurrent() || !event.data.size) return;
        byteSize += event.data.size;
        if (byteSize > MAX_RECORDING_BYTES) {
          chunks = [];
          cancelRecording();
          callbacks.current.onError('That recording exceeded the 12 MB limit. Try a shorter explanation, or type it instead.');
          return;
        }
        chunks.push(event.data);
      };
      current.onerror = () => {
        if (!isCurrent()) return;
        chunks = [];
        cancelRecording();
        callbacks.current.onError('Recording was interrupted. Your typed draft is still available; you can record again or keep typing.');
      };
      current.onstop = async () => {
        if (!isCurrent()) return;
        recorder.current = null;
        stopTracks();
        setRecording(false);
        const type = current.mimeType || chunks[0]?.type || 'audio/webm';
        const audio = new Blob(chunks, { type });
        chunks = [];
        if (!audio.size) {
          callbacks.current.onError('The recording was empty. Try again or type your explanation.');
          return;
        }

        const request = new AbortController();
        transcriptionRequest.current = request;
        setTranscribing(true);
        const extension = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
        const form = new FormData();
        form.append('audio', audio, `explanation.${extension}`);
        try {
          const response = await fetch('/api/transcribe', { method: 'POST', body: form, signal: request.signal });
          if (!response.ok) throw new Error(await responseError(response, 'Transcription is unavailable. Try again or type your explanation.'));
          const result: unknown = await response.json();
          if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string' || !result.text.trim()) {
            throw new Error('No speech was recognized. Try again or type your explanation.');
          }
          if (isCurrent() && !request.signal.aborted) callbacks.current.onTranscript(result.text.trim());
        } catch (error) {
          if (isCurrent() && !request.signal.aborted) {
            callbacks.current.onError(error instanceof TypeError
              ? 'The connection was lost during transcription. Your typed draft is safe. Try recording again or keep typing.'
              : error instanceof Error ? error.message : 'Transcription failed. You can keep going by typing.');
          }
        } finally {
          if (isCurrent()) {
            transcriptionRequest.current = null;
            setTranscribing(false);
          }
        }
      };

      current.start(250);
      setRecording(true);
      recordingTimer.current = setTimeout(() => {
        if (!isCurrent()) return;
        stopRecording();
        callbacks.current.onError('The three-minute recording is ready for transcription. Review the text before sending, then continue with another turn.');
      }, MAX_RECORDING_MS);
    } catch (error) {
      if (isCurrent()) {
        cancelRecording();
        callbacks.current.onError(recordingError(error));
      }
    } finally {
      if (isCurrent()) {
        microphonePending.current = false;
        setRequestingPermission(false);
      }
    }
  }, [cancelRecording, stopPlayback, stopRecording, stopTracks]);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (!callbacks.current.enabled) {
      callbacks.current.onError('Spoken responses are not configured on this server. The full response is available as text.');
      return;
    }
    // Never play Miso into an open microphone or interrupt a student's transcript.
    if (recorder.current || microphonePending.current || transcriptionRequest.current) return;
    stopPlayback();
    const generation = playbackGeneration.current;
    const request = new AbortController();
    speechRequest.current = request;
    setSpeechLoading(true);
    const isCurrent = () => mounted.current && generation === playbackGeneration.current && callbacks.current.enabled;

    try {
      const response = await fetch('/api/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: request.signal,
      });
      if (!response.ok) throw new Error(await responseError(response, 'Spoken audio is unavailable. You can read the response instead.'));
      const audio = await response.blob();
      if (!isCurrent() || request.signal.aborted) return;
      if (!audio.size) throw new Error('The spoken response was empty. You can read the response instead.');
      speechRequest.current = null;
      const url = URL.createObjectURL(audio);
      audioUrl.current = url;
      const current = new Audio(url);
      player.current = current;
      current.onplaying = () => {
        if (isCurrent()) {
          setSpeaking(true);
          setSpeechLoading(false);
        }
      };
      current.onended = () => { if (isCurrent()) stopPlayback(); };
      current.onerror = () => {
        if (!isCurrent()) return;
        stopPlayback();
        callbacks.current.onError('The spoken response could not play. You can read it in the conversation.');
      };
      await current.play();
    } catch (error) {
      if (isCurrent() && !request.signal.aborted) {
        stopPlayback();
        callbacks.current.onError(error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Your browser blocked audio playback. Use Read aloud to try again, or read the response on screen.'
          : error instanceof TypeError ? 'The connection was lost while preparing audio. You can read the response on screen.'
            : error instanceof Error ? error.message : 'The spoken response could not play. You can read it instead.');
      }
    }
  }, [stopPlayback]);

  const dispose = useCallback(() => {
    cancelRecording();
    stopPlayback();
  }, [cancelRecording, stopPlayback]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dispose();
    };
  }, [dispose]);

  useEffect(() => {
    if (!options.enabled) dispose();
  }, [options.enabled, dispose]);

  return {
    recording, requestingPermission, transcribing, speaking, speechLoading,
    startRecording, stopRecording, cancelRecording, speak, stopPlayback, dispose,
  };
}

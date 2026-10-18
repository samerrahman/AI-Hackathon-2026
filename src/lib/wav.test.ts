import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePcm16Wav } from './wav.js';

test('PCM WAV has correct format, byte lengths, sample rate and clipped signed samples', () => {
  const bytes = encodePcm16Wav([new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2, NaN])]);
  const view = new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), 'WAVE');
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 16);
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => view.getInt16(44 + index * 2, true)), [-32768, -32768, -16384, 0, 16384, 32767, 32767, 0]);
});

test('stereo channels are averaged into mono and malformed audio is rejected', () => {
  const view = new DataView(encodePcm16Wav([new Float32Array([1, 0.5, -1]), new Float32Array([-1, 0.5, 1])]));
  assert.deepEqual([44, 46, 48].map(offset => view.getInt16(offset, true)), [0, 16384, 0]);
  assert.throws(() => encodePcm16Wav([]), /no usable audio/);
  assert.throws(() => encodePcm16Wav([new Float32Array([1]), new Float32Array([1, 2])]), /no usable audio/);
  assert.throws(() => encodePcm16Wav([new Float32Array([1])], 0), /sample rate/);
});

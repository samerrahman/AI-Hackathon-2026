/** Encode decoded audio as actual mono PCM16 WAV. The caller supplies resampled channel data. */
export function encodePcm16Wav(channels: readonly Float32Array[], sampleRate = 16000): ArrayBuffer {
  const count = channels[0]?.length ?? 0;
  if (!channels.length || !count || channels.some(channel => channel.length !== count)) throw new Error('The recording contains no usable audio samples.');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Unsupported audio sample rate.');
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
  write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index++) {
    let mixed = 0;
    for (const channel of channels) mixed += Number.isFinite(channel[index]) ? channel[index] / channels.length : 0;
    const sample = Math.max(-1, Math.min(1, mixed));
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

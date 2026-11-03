// Bounded PCM queues: a slow sound device must not retain minutes of audio.
export class PcmQueue {
  constructor(capacity = 9600) {
    this.data = new Int16Array(capacity)
    this.read = 0
    this.length = 0
  }
  push(samples) {
    for (const sample of samples) {
      this.pushSample(sample)
    }
  }
  pushSample(sample) {
    if (this.length === this.data.length) {
      this.read = (this.read + 1) % this.data.length
      this.length--
    }
    this.data[(this.read + this.length++) % this.data.length] = sample
  }
  pushStereo48({ samples, sampleRate, channelCount }) {
    const frames = Math.floor(samples.length / channelCount)
    if (!frames || !sampleRate || !channelCount) return
    if (sampleRate === 48000 && channelCount === 2) {
      this.push(samples)
      return
    }
    const count = Math.floor(frames * 48000 / sampleRate)
    for (let i = 0; i < count; i++) {
      const position = i * sampleRate / 48000
      const a = Math.min(frames - 1, Math.floor(position))
      const b = Math.min(frames - 1, a + 1)
      const fraction = position - a
      const leftA = samples[a * channelCount], leftB = samples[b * channelCount]
      const rightChannel = Math.min(1, channelCount - 1)
      const rightA = samples[a * channelCount + rightChannel], rightB = samples[b * channelCount + rightChannel]
      this.pushSample(leftA * (1 - fraction) + leftB * fraction)
      this.pushSample(rightA * (1 - fraction) + rightB * fraction)
    }
  }
  pull(target) {
    const count = Math.min(target.length, this.length)
    for (let i = 0; i < count; i++) target[i] = this.data[(this.read + i) % this.data.length]
    target.fill(0, count)
    this.read = (this.read + count) % this.data.length
    this.length -= count
  }
  clear() { this.read = 0; this.length = 0 }
}

export function toStereo48({ samples, sampleRate, channelCount }) {
  const frames = Math.floor(samples.length / channelCount)
  const count = Math.floor(frames * 48000 / sampleRate)
  const output = new Int16Array(count * 2)
  for (let i = 0; i < count; i++) {
    const position = i * sampleRate / 48000
    const a = Math.min(frames - 1, Math.floor(position))
    const b = Math.min(frames - 1, a + 1)
    const fraction = position - a
    for (let c = 0; c < 2; c++) {
      const channel = Math.min(c, channelCount - 1)
      output[i * 2 + c] = samples[a * channelCount + channel] * (1 - fraction) + samples[b * channelCount + channel] * fraction
    }
  }
  return output
}

export function mixPcm(items, output, scratch, accumulator, deafened = false) {
  if (deafened) {
    output.fill(0)
    for (const item of items) item.queue.clear()
    return
  }
  accumulator.fill(0)
  for (const item of items) {
    if (item.muted) {
      item.queue.clear()
      continue
    }
    item.queue.pull(scratch)
    for (let i = 0; i < output.length; i++) accumulator[i] += scratch[i]
  }
  for (let i = 0; i < output.length; i++) output[i] = Math.max(-32768, Math.min(32767, accumulator[i]))
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { PcmQueue, mixPcm, toStereo48 } from './pcm.mjs'

test('slow playback discards oldest audio and zero-fills underruns', () => {
  const queue = new PcmQueue(4), out = new Int16Array(6)
  queue.push([1, 2, 3]); queue.push([4, 5, 6]); queue.pull(out)
  assert.deepEqual([...out], [3, 4, 5, 6, 0, 0])
  assert.equal(queue.length, 0)
})
test('multiple speakers mix with clipping and muted queues still drain', () => {
  const items = [20000, 20000, -30000].map(value => {
    const queue = new PcmQueue(4); queue.push([value, value]); return { queue, muted: false }
  })
  items[2].muted = true
  const output = new Int16Array(2)
  mixPcm(items, output, new Int16Array(2), new Int32Array(2))
  assert.deepEqual([...output], [32767, 32767])
  assert.ok(items.every(item => item.queue.length === 0))
})
test('matching 48 kHz stereo frames are queued without an intermediate buffer', () => {
  const queue = new PcmQueue(4)
  const samples = new Int16Array([1, 2, 3, 4])
  queue.pushStereo48({ samples, sampleRate: 48000, channelCount: 2 })
  const output = new Int16Array(4)
  queue.pull(output)
  assert.deepEqual([...output], [...samples])
})
test('deafening clears remote queues without mixing', () => {
  const queue = new PcmQueue(4); queue.push([100, 100])
  const output = new Int16Array(2)
  mixPcm([{ queue, muted: false }], output, new Int16Array(2), new Int32Array(2), true)
  assert.deepEqual([...output], [0, 0]); assert.equal(queue.length, 0)
})
test('16 kHz mono decode is converted to 48 kHz stereo for WASAPI', () => {
  const output = toStereo48({ samples: new Int16Array([0, 3000]), sampleRate: 16000, channelCount: 1 })
  assert.equal(output.length, 12)
  assert.deepEqual([...output.slice(0, 6)], [0, 0, 1000, 1000, 2000, 2000])
})

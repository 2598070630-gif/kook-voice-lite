import wrtc from '@roamhq/wrtc'
import audify from 'audify'
import { PcmQueue, mixPcm } from './pcm.mjs'

const { RtAudio, RtAudioApi, RtAudioFormat } = audify
const { RTCAudioSource, RTCAudioSink } = wrtc.nonstandard

function closeIo(io) {
  if (!io) return
  try { if (io.isStreamRunning()) io.stop() } catch {}
  try { if (io.isStreamOpen()) io.closeStream() } catch {}
}

export class NativeAudio {
  constructor(emit) {
    this.emit = emit
    this.remote = new Map()
    this.muted = false
    this.deafened = false
    this.meterEnabled = false
    this.lastMeterAt = 0
    this.output = null
    this.input = null
  }
  createIo() { return new RtAudio(RtAudioApi.WINDOWS_WASAPI) }
  devices() {
    const io = this.createIo()
    try {
      return io.getDevices().map(device => ({
        id: String(device.id), name: device.name,
        input: device.inputChannels > 0, output: device.outputChannels > 0,
        defaultInput: !!device.isDefaultInput, defaultOutput: !!device.isDefaultOutput,
      }))
    } finally { closeIo(io) }
  }
  createSource() {
    const source = new RTCAudioSource()
    const track = source.createTrack()
    return { source, track, close() { track.stop() } }
  }
  silentSource() {
    const source = this.createSource()
    source.track.enabled = false
    return source
  }
  openInput(deviceId = 'default') {
    // Keep the same native track when changing the capture device.
    this.capture ??= this.createSource()
    const previousId = this.inputId
    closeIo(this.input)
    this.input = null
    try {
      this.startInput(deviceId)
    } catch (error) {
      if (previousId != null) try { this.startInput(previousId) } catch {}
      throw error
    }
    return this.capture.track
  }
  startInput(deviceId) {
    const io = this.createIo()
    const queue = new PcmQueue(4800)
    const frame = new Int16Array(480)
    try {
      io.openStream(null, {
        deviceId: deviceId === 'default' ? io.getDefaultInputDevice() : Number(deviceId), nChannels: 1,
      }, RtAudioFormat.RTAUDIO_SINT16, 48000, 480, 'KOOK Voice Lite microphone', data => {
        if (this.input !== io) return
        queue.push(new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2))
        if (this.muted) {
          queue.clear()
          return
        }
        while (queue.length >= frame.length) {
          queue.pull(frame)
          let energy = 0
          for (const sample of frame) energy += sample * sample
          const db = 20 * Math.log10(Math.max(1e-9, Math.sqrt(energy / frame.length) / 32768))
          // One RMS pass serves both the existing -55 dB voice gate and the optional meter.
          if (db < -55) frame.fill(0)
          this.capture.source.onData({ samples: frame, sampleRate: 48000, bitsPerSample: 16, channelCount: 1, numberOfFrames: 480 })
          const now = Date.now()
          if (this.meterEnabled && now - this.lastMeterAt >= 200) {
            this.lastMeterAt = now
            this.emit('meter', { level: Math.max(0, Math.min(100, db + 90)) })
          }
        }
      }, null)
      this.input = io
      this.inputId = deviceId
      io.start()
    } catch (error) { closeIo(io); if (this.input === io) this.input = null; throw error }
  }
  openOutput(deviceId = 'default') {
    const previousId = this.outputId
    closeIo(this.output)
    this.output = null
    try { this.startOutput(deviceId) }
    catch (error) {
      if (previousId != null) try { this.startOutput(previousId) } catch {}
      throw error
    }
  }
  startOutput(deviceId) {
    const io = this.createIo()
    try {
      let output, scratch, accumulator, bytes
      const write = () => {
        if (this.output !== io) return
        mixPcm(this.remote.values(), output, scratch, accumulator, this.deafened)
        io.write(bytes)
      }
      const frames = io.openStream({
        deviceId: deviceId === 'default' ? io.getDefaultOutputDevice() : Number(deviceId), nChannels: 2,
      }, null, RtAudioFormat.RTAUDIO_SINT16, 48000, 480, 'KOOK Voice Lite speaker', null, write)
      output = new Int16Array(frames * 2)
      scratch = new Int16Array(output.length)
      accumulator = new Int32Array(output.length)
      bytes = Buffer.from(output.buffer)
      this.output = io
      this.outputId = deviceId
      // Two frames of bounded prebuffering; further writes follow the device callback.
      write(); write()
      io.start()
    } catch (error) { closeIo(io); if (this.output === io) this.output = null; throw error }
  }
  addRemote({ consumerId, peerId, peerInfo, track, kind }) {
    if (kind !== 'audio') return
    this.removeRemote(consumerId)
    const sink = new RTCAudioSink(track)
    const item = { sink, queue: new PcmQueue(), peerId: String(peerId), label: peerInfo?.displayName || peerInfo?.nickname || String(peerId), muted: false }
    sink.ondata = data => item.queue.pushStereo48(data)
    this.remote.set(consumerId, item)
  }
  removeRemote(id) {
    const item = this.remote.get(id)
    if (item) { item.sink.ondata = null; item.sink.stop(); item.queue.clear() }
    this.remote.delete(id)
  }
  peers() {
    const peers = new Map()
    for (const item of this.remote.values()) peers.set(item.peerId, { id: item.peerId, label: item.label, muted: item.muted })
    return [...peers.values()]
  }
  mutePeer(id, muted) {
    for (const item of this.remote.values()) if (item.peerId === id) item.muted = muted
  }
  close() {
    this.meterEnabled = false
    for (const id of this.remote.keys()) this.removeRemote(id)
    closeIo(this.input); closeIo(this.output)
    this.input = null; this.output = null
    this.inputId = null; this.outputId = null
    this.capture?.close(); this.capture = null
  }
}

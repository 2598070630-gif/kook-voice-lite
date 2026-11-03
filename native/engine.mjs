import wrtc from '@roamhq/wrtc'
import WebSocket from 'ws'
import { NativeAudio } from './audio.mjs'

// mediasoup's Chrome74 adapter uses the native PeerConnection API, with no DOM or GPU.
for (const name of ['RTCPeerConnection', 'RTCSessionDescription', 'RTCIceCandidate', 'MediaStream', 'MediaStreamTrack', 'RTCRtpSender', 'RTCRtpReceiver']) {
  globalThis[name] = wrtc[name]
}
globalThis.WebSocket ??= WebSocket
const { RtcCoreClient, Device, normalizeVoiceTokenConfig } = await import('@kookapp/voice-rtc-core')

export class VoiceEngine {
  constructor(emit = () => {}, audio = new NativeAudio(emit)) {
    this.emit = emit
    this.audio = audio
    this.client = null
    this.closing = false
    this.state = { connected: false, busy: false, muted: false, deafened: false, listenOnly: false, peers: [], channelId: '' }
  }
  snapshot() { return { ...this.state, peers: this.audio.peers() } }
  update(values = {}) { Object.assign(this.state, values); this.emit('state', this.snapshot()) }
  async join({ channelId, userId, token: rawToken, listenOnly = false, inputDevice = 'default', outputDevice = 'default' }) {
    if (this.client || this.state.busy) throw new Error('已有语音会话，请先断开')
    if (!/^\d+$/.test(channelId) || !/^\d+$/.test(userId)) throw new Error('频道和用户 ID 必须是数字字符串')
    const token = normalizeVoiceTokenConfig(rawToken, { ipDiscovery: [] })
    const gateway = new URL(token.gateway_url)
    if (!['ws:', 'wss:'].includes(gateway.protocol)) throw new Error('语音网关必须是 WebSocket 地址')
    this.update({ busy: true, channelId, listenOnly, muted: listenOnly, deafened: false })
    const client = new RtcCoreClient({
      uid: userId, joinId: `${Date.now()}-${userId}-${channelId}`, tokenConfig: token,
      createDevice: () => new Device({ handlerName: 'Chrome74' }),
      createSilentAudioSource: () => this.audio.silentSource(),
    })
    this.client = client
    client.on('consumer', data => { this.audio.addRemote(data); this.update() })
    client.on('consumer-close', ({ consumerId }) => { this.audio.removeRemote(consumerId); this.update() })
    client.on('error', () => this.emit('log', { message: '语音引擎发生错误，请重新连接。' }))
    client.on('transport-state-change', ({ direction, state }) => this.emit('log', { message: `${direction === 'send' ? '发送' : '接收'}链路：${state}` }))
    client.on('reload', async () => {
      if (this.client !== client || listenOnly) return
      try { await client.publishTrack(this.audio.capture.track, { codecOptions: { opusStereo: 0 }, stopTracks: false }) }
      catch { this.emit('log', { message: '重连后发布失败，请重新连接。' }) }
    })
    client.on('close', () => {
      if (this.client !== client) return
      const unexpected = this.state.connected && !this.closing
      this.client = null; this.audio.close()
      this.update({ connected: false, busy: false, peers: [], channelId: '' })
      this.emit('session-closed', { unexpected })
    })
    client.on('kickout', () => { void this.leave() })
    try {
      this.audio.openOutput(outputDevice)
      const track = listenOnly ? null : this.audio.openInput(inputDevice)
      await client.join(channelId, {
        gateway_url: token.gateway_url, iceServers: token.iceServers,
        iceTransportPolicy: token.iceTransportPolicy, rtcConfig: token.rtcConfig,
        forceRelay: token.forceRelay, quickJoinListenOnly: listenOnly, joinMuted: listenOnly, startAins: false,
      })
      if (track) await client.publishTrack(track, { codecOptions: { opusStereo: 0 }, stopTracks: false })
      if (client.closed) throw new Error('语音连接已关闭')
      this.update({ connected: true, busy: false })
      return this.snapshot()
    } catch (error) {
      this.closing = true
      client.close(); this.client = null; this.audio.close()
      this.update({ connected: false, busy: false, peers: [], channelId: '' })
      this.closing = false
      // Do not return SDK exception text: it can contain the credential-bearing gateway URL.
      throw new Error('原生语音连接失败，请检查凭证有效期、网络和系统音频设备。', { cause: error })
    }
  }
  async leave() {
    const client = this.client
    this.closing = true
    try { await client?.leave() }
    finally {
      client?.close(); this.client = null; this.audio.close()
      this.update({ connected: false, busy: false, muted: false, deafened: false, peers: [], channelId: '' })
      this.closing = false
    }
    return this.snapshot()
  }
  async command(action, args = {}) {
    if (action === 'join') return this.join(args)
    if (action === 'leave') return this.leave()
    if (action === 'devices') return this.audio.devices()
    if (action === 'snapshot') return this.snapshot()
    if (action === 'meter') { this.audio.meterEnabled = !!args.enabled; return null }
    if (!this.client || !this.state.connected) throw new Error('尚未连接语音')
    switch (action) {
      case 'microphone': {
        if (this.state.listenOnly) throw new Error('只听模式未启用麦克风')
        const muted = !this.state.muted
        if (muted) await this.client.pauseProducer(); else await this.client.resumeProducer()
        this.audio.muted = muted; this.update({ muted }); break
      }
      case 'headset': {
        const deafened = !this.state.deafened
        if (deafened) await this.client.pauseHeadset(); else await this.client.resumeHeadset()
        this.audio.deafened = deafened; this.update({ deafened }); break
      }
      case 'input': this.audio.openInput(args.deviceId); break
      case 'output': this.audio.openOutput(args.deviceId); break
      case 'peer': this.audio.mutePeer(String(args.peerId), !!args.muted); this.update(); break
      default: throw new Error('不支持的语音操作')
    }
    return this.snapshot()
  }
}

// Actual native Opus/ICE/DTLS loopback, then the KOOK QuickJoin/InitSpeaking protocol
// against a local signaling fixture. No account, microphone or external server is used.
import assert from 'node:assert/strict'
import { WebSocketServer } from 'ws'
import wrtc from '@roamhq/wrtc'
import { VoiceEngine } from './engine.mjs'
import { NativeAudio } from './audio.mjs'
const { RTCPeerConnection } = wrtc
const { RTCAudioSource, RTCAudioSink } = wrtc.nonstandard
const timeout = setTimeout(() => { console.error('native RTC smoke timeout'); process.exit(1) }, 20000)

async function loopback() {
  const a = new RTCPeerConnection(), b = new RTCPeerConnection()
  const source = new RTCAudioSource(), track = source.createTrack()
  let sink, timer
  a.onicecandidate = event => { if (event.candidate) b.addIceCandidate(event.candidate).catch(() => {}) }
  b.onicecandidate = event => { if (event.candidate) a.addIceCandidate(event.candidate).catch(() => {}) }
  const received = new Promise(resolve => {
    b.ontrack = ({ track }) => {
      sink = new RTCAudioSink(track)
      sink.ondata = ({ samples }) => { if (samples.some(value => Math.abs(value) > 100)) resolve() }
    }
  })
  try {
    a.addTrack(track)
    await a.setLocalDescription(await a.createOffer())
    await b.setRemoteDescription(a.localDescription)
    await b.setLocalDescription(await b.createAnswer())
    await a.setRemoteDescription(b.localDescription)
    let phase = 0
    timer = setInterval(() => {
      const samples = Int16Array.from({ length: 480 }, () => Math.round(Math.sin(phase++ * 2 * Math.PI * 440 / 48000) * 12000))
      source.onData({ samples, sampleRate: 48000, channelCount: 1, numberOfFrames: 480 })
    }, 10)
    await received
    console.log('PASS native ICE + DTLS + Opus audio loopback')
  } finally { clearInterval(timer); sink?.stop(); track.stop(); a.close(); b.close() }
}

async function signaling(listenOnly) {
  const certificatePc = new RTCPeerConnection()
  certificatePc.addTransceiver('audio')
  const offer = await certificatePc.createOffer()
  const fingerprint = offer.sdp.match(/a=fingerprint:sha-256 (.+)/)[1].trim()
  certificatePc.close()
  const transport = id => ({ id, iceParameters: { usernameFragment: 'fixture', password: 'fixture-password-123456789', iceLite: true },
    iceCandidates: [{ foundation: '1', priority: 100, ip: '127.0.0.1', protocol: 'udp', port: 9, type: 'host' }],
    dtlsParameters: { role: 'auto', fingerprints: [{ algorithm: 'sha-256', value: fingerprint }] },
  })
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise(resolve => server.once('listening', resolve))
  const requests = []
  server.on('connection', socket => socket.on('message', bytes => {
    const message = JSON.parse(String(bytes))
    if (!message.request) return
    requests.push(message)
    let data = {}
    if (message.method === 'quickJoin') data = { pTransport: transport('send'), cTransport: transport('recv'), rtpConfig: { audio: { ptime: 20, stereo: 0 } } }
    if (message.method === 'initSpeaking') data = { producer: { id: 'native-microphone' }, peers: [] }
    socket.send(JSON.stringify({ response: true, id: message.id, ok: true, data }))
  }))
  const native = new NativeAudio(() => {})
  const audio = {
    peers: () => [], openOutput() {}, close() { native.close() }, silentSource: () => native.silentSource(),
    openInput() { native.capture = native.createSource(); return native.capture.track },
  }
  const engine = new VoiceEngine(() => {}, audio)
  try {
    await engine.join({ channelId: '123', userId: '456', token: { gateway_url: `ws://127.0.0.1:${server.address().port}` }, listenOnly })
    assert.equal(engine.snapshot().connected, true)
    const init = requests.find(request => request.method === 'initSpeaking')
    assert.ok(init.data.pDtls.fingerprints.length)
    assert.ok(init.data.cDtls.fingerprints.length)
    assert.ok(init.data.rtpParameters.codecs.some(codec => codec.mimeType.toLowerCase() === 'audio/opus'))
    assert.equal(init.data.pauseMic, listenOnly)
    if (!listenOnly) { await engine.command('microphone'); assert.equal(engine.state.muted, true); await engine.command('microphone') }
    await engine.command('headset'); assert.equal(engine.state.deafened, true)
    await engine.leave(); assert.equal(engine.state.connected, false)
    console.log(`PASS native QuickJoin/InitSpeaking, ${listenOnly ? 'listen-only' : 'microphone'}, controls and cleanup`)
  } catch (error) { console.error(error.cause || error); throw error }
  finally {
    engine.client?.close(); audio.close()
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
  }
}
try { await loopback(); await signaling(false); await signaling(true); clearTimeout(timeout); process.exit(0) }
catch (error) { console.error(error); process.exit(1) }

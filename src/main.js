import './style.css'
import { icon, renderShell } from './view.js'
import { parseConnectionConfig } from './connection-config.js'

const $ = (selector) => document.querySelector(selector)
const app = $('#app')
app.innerHTML = renderShell()

let sdk = null
let sdkModule = null
let client = null
let localStream = null
let localMuted = false
let headsetPaused = false
let meterTimer = 0
let pendingMeter = null
let lastTalkLogAt = 0
let isHidden = false
let playwrightRunning = false
let connectionPending = false
let activeView = 'connect'
let logBuffer = ''
const remoteStreams = new Map()

async function nativeCommand(command) {
  const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke
  if (!invoke) return false
  try { await invoke(command); return true } catch { return false }
}

async function nativeInvoke(command, args = undefined) {
  const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke
  if (!invoke) throw new Error('当前页面不是 Tauri 应用，无法调用本地 Playwright')
  return invoke(command, args)
}

async function ensureSdk() {
  if (sdk) return sdk
  sdkModule = await import('@kookapp/voice-web-sdk')
  sdk = new sdkModule.default()
  log(`Voice SDK ${sdk.getVersion?.() || 'unknown'} 已按需加载`)
  return sdk
}

function log(message, detail) {
  const node = $('#log')
  if (!node) return
  const line = `[${new Date().toLocaleTimeString()}] ${message}${detail ? ` ${detail}` : ''}`
  logBuffer = `${line}\n${logBuffer}`.slice(0, 6000)
  if (activeView === 'diagnostics' && !isHidden) node.textContent = logBuffer
}

function setStatus(text, kind = 'idle') {
  const node = $('#status')
  node.replaceChildren(document.createElement('i'), document.createTextNode(text))
  node.className = `status ${kind}`
  $('#sidebar-status').textContent = text
}

function setView(name) {
  activeView = name
  if (name === 'diagnostics') $('#log').textContent = logBuffer || '尚无连接记录'
  if (name !== 'devices' && meterTimer) {
    window.clearTimeout(meterTimer)
    meterTimer = 0
  }
  const titles = { connect: '语音连接', devices: '音频设备', diagnostics: '连接诊断' }
  for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== `view-${name}`
  for (const item of document.querySelectorAll('[data-view]')) {
    item.classList.toggle('active', item.dataset.view === name)
    if (item.classList.contains('nav-item')) {
      if (item.dataset.view === name) item.setAttribute('aria-current', 'page')
      else item.removeAttribute('aria-current')
    }
  }
  $('#view-title').textContent = titles[name]
}

function setBusy(joining) {
  connectionPending = joining
  const busy = joining || playwrightRunning
  $('#join').disabled = busy || !!client
  $('#leave').disabled = joining || !client
  for (const id of ['channel-id', 'user-id', 'token-json', 'listen-only', 'import-config']) $(`#${id}`).disabled = busy || !!client
  $('#playwright-extract').disabled = joining || !!client || playwrightRunning
  syncTrayControls()
}

function syncTrayControls() {
  if (!window.__TAURI__) return
  nativeInvoke('sync_tray_controls', { connected: !!client, microphoneAvailable: !!localStream, muted: localMuted, deafened: headsetPaused, busy: connectionPending || playwrightRunning }).catch(() => {})
}

function renderPeers() {
  const node = $('#peers')
  $('#peer-count').textContent = String(remoteStreams.size)
  if (!remoteStreams.size) {
    node.className = 'peers empty'
    node.innerHTML = '<p>暂无远端音轨</p>'
    return
  }
  node.className = 'peers'
  const fragment = document.createDocumentFragment()
  for (const [id, item] of remoteStreams) {
    const row = document.createElement('div')
    row.className = 'peer'
    const dot = document.createElement('span')
    dot.className = 'dot'
    const name = document.createElement('span')
    name.className = 'peer-name'
    name.textContent = item.label || id
    const mute = document.createElement('button')
    mute.className = 'peer-mute'
    mute.type = 'button'
    mute.textContent = '静音'
    mute.onclick = () => { item.stream.setAudioVolume?.(0); log(`已静音远端音轨 ${id}`) }
    row.append(dot, name, mute)
    fragment.append(row)
  }
  node.replaceChildren(fragment)
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return
  const devices = await navigator.mediaDevices.enumerateDevices()
  const input = $('#input-device')
  const output = $('#output-device')
  const selectedInput = input.value
  const selectedOutput = output.value
  const inputFragment = document.createDocumentFragment()
  const outputFragment = document.createDocumentFragment()
  let inputIndex = 0
  let outputIndex = 0
  for (const device of devices) {
    if (device.kind === 'audioinput') inputFragment.append(new Option(device.label || `麦克风 ${++inputIndex}`, device.deviceId))
    if (device.kind === 'audiooutput') outputFragment.append(new Option(device.label || `扬声器 ${++outputIndex}`, device.deviceId))
  }
  input.replaceChildren(inputFragment)
  output.replaceChildren(outputFragment)
  input.disabled = !localStream
  output.disabled = !client
  if (selectedInput) input.value = selectedInput
  if (selectedOutput) output.value = selectedOutput
}

function installSdkHooks() {
  sdkModule.setSdkDeps({
    getInitVolume: () => ({ outputVolume: 100, usersVolume: {} }),
    getInputMuted: () => localMuted,
    getVtrxSwitch: () => false,
    supportAiNoiseSuppression: () => false,
    request: { get: async () => ({ data: null }) },
    onUserTalk: (peerId) => {
      const now = Date.now()
      if (now - lastTalkLogAt > 2000) { lastTalkLogAt = now; log(`远端发言: ${peerId}`) }
    },
    onLocalVolume: (level) => {
      if (isHidden || activeView !== 'devices') return
      pendingMeter = Math.max(0, Math.min(100, Number(level) + 90))
      if (meterTimer) return
      meterTimer = window.setTimeout(() => {
        meterTimer = 0
        if (isHidden || activeView !== 'devices') return
        if (pendingMeter == null) return
        $('#meter-fill').style.transform = `scaleX(${pendingMeter / 100})`
        $('#meter-value').textContent = `${Math.round(pendingMeter)}%`
      }, 200)
    },
    onAuthing: (active) => log(active ? '正在鉴权' : '鉴权完成'),
    onAiNoiseSuppressionError: (error) => log('AI 降噪不可用，已关闭', String(error)),
    onDiagnosticLog: (record) => { if (record?.level === 'error') log(`SDK: ${record.event}`, record.message || '') },
  })
}

async function hideToTray() {
  isHidden = true
  await nativeCommand('hide_to_tray')
}

async function showWindow() {
  isHidden = false
  if (activeView === 'diagnostics') $('#log').textContent = logBuffer || '尚无连接记录'
  await nativeCommand('show_window')
}

async function join(event) {
  event.preventDefault()
  if (client || playwrightRunning || connectionPending) return
  const channelId = $('#channel-id').value.trim()
  const uid = $('#user-id').value.trim()
  const listenOnly = $('#listen-only').checked
  let rawToken
  try { rawToken = JSON.parse($('#token-json').value) } catch {
    setStatus('Token JSON 无效', 'error'); log('Token JSON 解析失败'); setView('diagnostics'); return
  }
  setBusy(true)
  setStatus('加载语音…', 'busy')
  try {
    const voiceSdk = await ensureSdk()
    if (!voiceSdk.checkSystemRequirements()) throw new Error('需要 HTTPS/localhost、RTCPeerConnection 和 getUserMedia')
    installSdkHooks()
    const token = sdkModule.normalizeVoiceTokenConfig(rawToken, { ipDiscovery: [] })
    if (!token.gateway_url) throw new Error('Token 缺少 gateway_url/wsUrl')
    if (!listenOnly) {
      localStream = voiceSdk.createStream({ userID: uid, audio: true, video: false, microphoneId: $('#input-device').value || 'default', autoSens: false, sensValue: -55, aiNoiseSuppression: false })
      await new Promise((resolve, reject) => localStream.init(resolve, reject))
    }
    client = voiceSdk.createClient({ uid, joinId: `${Date.now()}-${uid}-${channelId}`, handlers: {
      getLocalStream: () => localStream,
      restartTrack: (_oldTrack, replace) => { const track = localStream?.streamObj?.getAudioTracks?.()[0]; if (track) replace(track, localStream) },
    } })
    client.tokenConfig = token
    client.on('stream-added', async ({ stream, peerInfo } = {}) => {
      if (!stream) return
      const id = String(peerInfo?.id || peerInfo?.uid || stream.getId?.() || `peer-${remoteStreams.size + 1}`)
      remoteStreams.set(id, { stream, label: peerInfo?.displayName || peerInfo?.name || id })
      client.subscribe(stream)
      stream.play?.(undefined, (error) => error && log(`远端音频播放失败 ${id}`, error.message || String(error)))
      renderPeers()
    })
    client.on('peer-leave', (peer = {}) => { const id = String(peer.id || peer.uid || ''); if (id) remoteStreams.delete(id); renderPeers() })
    client.on('peer-join', (peer = {}) => log(`成员加入 ${peer.id || peer.uid || ''}`))
    client.on('error', (error) => { log('SDK 错误', error?.message || String(error)); setStatus('语音错误', 'error'); setView('diagnostics') })
    setStatus('连接中…', 'busy')
    await client.join(channelId, { gateway_url: token.gateway_url, ip_discovery: token.ipDiscovery, forceRelay: token.forceRelay, rtcConfig: token.rtcConfig, iceServers: token.iceServers, iceTransportPolicy: token.iceTransportPolicy, quickJoinListenOnly: listenOnly, joinMuted: listenOnly, joinDeafened: false })
    if (!listenOnly) await client.publish(localStream)
    $('#room-label').textContent = channelId
    $('#connection-title').textContent = listenOnly ? '已连接 · 只听模式' : '已连接语音'
    $('#connection-symbol').classList.add('connected')
    $('#mic').disabled = listenOnly
    $('#headset').disabled = false
    $('#input-device').disabled = listenOnly
    $('#output-device').disabled = false
    setStatus(listenOnly ? '已加入 · 只听' : '已加入', 'ok')
    log(`已加入频道 ${channelId}`)
    await refreshDevices()
    await hideToTray()
  } catch (error) {
    log('加入失败', error?.message || String(error)); setView('diagnostics'); await leave(false); setStatus('加入失败', 'error')
  } finally { setBusy(false) }
}

async function leave(restoreWindow = true) {
  const oldClient = client
  client = null
  try { await oldClient?.leave?.() } catch (error) { log('离开时出现错误', error?.message || String(error)) }
  try { oldClient?.close?.() } catch {}
  try { localStream?.close?.() } catch {}
  if (meterTimer) window.clearTimeout(meterTimer)
  meterTimer = 0
  localStream = null
  localMuted = false
  headsetPaused = false
  $('#mic').setAttribute('aria-pressed', 'false')
  $('#mic-label').textContent = '静音'
  $('#headset').setAttribute('aria-pressed', 'false')
  $('#headset-label').textContent = '耳机'
  remoteStreams.clear()
  renderPeers()
  $('#room-label').textContent = '选择频道，开始通话'
  $('#connection-title').textContent = '尚未连接语音'
  $('#connection-symbol').classList.remove('connected')
  $('#mic').disabled = true
  $('#headset').disabled = true
  $('#input-device').disabled = true
  $('#output-device').disabled = true
  $('#meter-fill').style.transform = 'scaleX(0)'
  $('#meter-value').textContent = '—'
  setStatus('未连接', 'idle')
  setBusy(false)
  if (restoreWindow) await showWindow()
}

document.querySelectorAll('[data-view]').forEach((item) => item.addEventListener('click', () => setView(item.dataset.view)))
$('#join-form').addEventListener('submit', join)
$('#import-config').addEventListener('click', () => $('#config-file').click())

function importConnectionConfig(text, automatic = false) {
  const config = parseConnectionConfig(text)
  $('#channel-id').value = config.channelId
  $('#user-id').value = config.userId
  $('#token-json').value = JSON.stringify(config.token, null, 2)
  const feedback = $('#import-feedback')
  feedback.textContent = `${automatic ? '提取成功，已自动导入' : '已导入'}频道 ${config.channelId} 的语音配置，点击「加入语音」即可连接。`
  feedback.className = 'import-feedback'
  feedback.hidden = false
  log(`${automatic ? '已自动导入' : '已导入'}频道 ${config.channelId} 的语音配置`)
  return config
}

async function extractWithPlaywright() {
  if (client || playwrightRunning || connectionPending) return
  const channel = $('#channel-id').value.trim()
  playwrightRunning = true
  setBusy(false)
  setView('diagnostics')
  setStatus('Playwright 提取中…', 'busy')
  log(channel ? `正在启动 Playwright，目标频道 ${channel}` : '正在启动 Playwright，等待语音频道请求')
  log('请在打开的 Edge 中登录并重新加入目标语音频道，提取后将自动导入。')
  let unlisten
  try {
    unlisten = await window.__TAURI__.event.listen('playwright-progress', ({ payload }) => {
      if (payload.message) log(payload.message)
      const titles = { opening: '正在打开 Edge…', waiting: '等待加入语音频道…', captured: '已捕获语音凭证…', verifying: '正在生成配置…', 'wrong-channel': '请加入目标频道…' }
      if (titles[payload.stage]) setStatus(titles[payload.stage], 'busy')
    })
    const config = await nativeInvoke('run_playwright_extractor', { channel: channel || null })
    importConnectionConfig(JSON.stringify(config), true)
    setStatus('提取成功 · 已自动导入', 'ok')
    setView('connect')
    await showWindow()
  } catch (error) {
    setStatus('Playwright 提取未完成', 'error')
    log('Playwright 提取未完成', error?.message || String(error))
  } finally {
    playwrightRunning = false
    unlisten?.()
    setBusy(false)
  }
}
$('#playwright-extract').addEventListener('click', extractWithPlaywright)
$('#config-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]
  if (!file || client) return
  const feedback = $('#import-feedback')
  try {
    if (file.size > 256 * 1024) throw new Error('配置文件过大，请选择提取脚本生成的小型 JSON 文件')
    importConnectionConfig(await file.text())
  } catch (error) {
    feedback.textContent = error.message || '配置导入失败'
    feedback.className = 'import-feedback error'
  } finally {
    feedback.hidden = false
    event.target.value = ''
  }
})
$('#leave').addEventListener('click', () => leave(true))
$('#tray').addEventListener('click', hideToTray)
$('#clear-log').addEventListener('click', () => { logBuffer = ''; $('#log').textContent = '尚无连接记录' })
function toggleMicrophone() {
  if (!client || !localStream || connectionPending) return
  const muted = !localMuted
  if (muted) client.pauseMic(localStream); else client.resumeMic(localStream)
  localMuted = muted
  $('#mic').setAttribute('aria-pressed', String(localMuted)); $('#mic-label').textContent = localMuted ? '开麦' : '静音'
  syncTrayControls()
}
function toggleHeadset() {
  if (!client || connectionPending) return
  const paused = !headsetPaused
  if (paused) client.pauseHeadset(); else client.resumeHeadset()
  headsetPaused = paused
  $('#headset').setAttribute('aria-pressed', String(headsetPaused)); $('#headset-label').textContent = headsetPaused ? '恢复' : '耳机'
  syncTrayControls()
}
$('#mic').addEventListener('click', toggleMicrophone)
$('#headset').addEventListener('click', toggleHeadset)

async function handleTrayAction(action) {
  try {
    if (['connect', 'devices', 'diagnostics'].includes(action)) {
      setView(action)
      await showWindow()
    } else if (action === 'microphone') toggleMicrophone()
    else if (action === 'headset') toggleHeadset()
    else if (action === 'disconnect' && client && !connectionPending) await leave(false)
    else if (action === 'extract') { await showWindow(); await extractWithPlaywright() }
  } catch (error) {
    log('托盘操作失败', error?.message || String(error))
    setView('diagnostics')
    await showWindow()
  } finally { syncTrayControls() }
}
if (window.__TAURI__?.event?.listen) {
  window.__TAURI__.event.listen('tray-action', ({ payload }) => handleTrayAction(payload)).then(syncTrayControls).catch(error => log('托盘控制不可用', String(error)))
  window.__TAURI__.event.listen('tray-error', async ({ payload }) => { log(payload); setView('diagnostics'); await showWindow() }).catch(() => {})
}
$('#input-device').addEventListener('change', async (event) => { try { await localStream?.switchDevice(client, event.target.value); log('已切换麦克风') } catch (error) { log('切换麦克风失败', error?.message || String(error)) } })
$('#output-device').addEventListener('change', (event) => { for (const { stream } of remoteStreams.values()) stream.setAudioOutput?.(event.target.value); log('已切换扬声器') })
document.addEventListener('visibilitychange', () => { isHidden = document.visibilityState === 'hidden' })
window.addEventListener('focus', () => {
  isHidden = false
  if (activeView === 'diagnostics') $('#log').textContent = logBuffer || '尚无连接记录'
})
window.addEventListener('blur', () => { if (document.visibilityState === 'hidden') isHidden = true })

setView('connect')
if (!window.isSecureContext) log('提示：请通过 localhost/HTTPS 打开，file:// 会被浏览器拒绝麦克风。')

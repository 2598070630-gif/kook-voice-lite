import './style.css'
import { renderShell } from './view.js'
import { parseConnectionConfig } from './connection-config.js'
const $ = selector => document.querySelector(selector)
$('#app').innerHTML = renderShell()
let state = { connected: false, busy: false, muted: false, deafened: false, listenOnly: false, peers: [], channelId: '' }
let activeView = 'workspace', isHidden = document.hidden, playwrightRunning = false, localBusy = false, ready = false
let logBuffer = '', peersKey = ''
function invoke(command, args) {
  const fn = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke
  return fn ? fn(command, args) : Promise.reject(new Error('请在桌面应用中使用此功能'))
}
const voice = (action, args = {}) => invoke('voice_command', { action, args })
function log(message) {
  logBuffer = `[${new Date().toLocaleTimeString()}] ${message}\n${logBuffer}`.slice(0, 6000)
  if (!isHidden) $('#log').textContent = logBuffer
}
function saveUi() {
  return invoke('save_ui', { ui: {
    view: activeView, channelId: $('#channel-id').value, userId: $('#user-id').value,
    token: $('#token-json').value, listenOnly: $('#listen-only').checked,
    connectionExpanded: $('#connection-details')?.open !== false,
    deviceExpanded: $('#device-details')?.open !== false,
    logExpanded: $('#log-details')?.open !== false,
    peersExpanded: $('#peers-details')?.open !== false,
    inputDevice: $('#input-device').value || 'default', outputDevice: $('#output-device').value || 'default', log: logBuffer,
  } })
}
function setStatus(text, kind = 'idle') {
  $('#status').replaceChildren(document.createElement('i'), document.createTextNode(text))
  $('#status').className = `status ${kind}`
}
function updateMeterSubscription() {
  if (ready) voice('meter', { enabled: state.connected && !state.listenOnly && !isHidden }).catch(() => {})
}
function setView(name) {
  activeView = 'workspace'
  $('#log').textContent = logBuffer || '尚无连接记录'
  updateMeterSubscription()
  if (ready) saveUi().catch(() => {})
}
function setBusy() {
  const busy = localBusy || state.busy || playwrightRunning
  $('#join').disabled = !ready || busy || state.connected
  $('#leave').disabled = busy || !state.connected
  for (const id of ['channel-id', 'user-id', 'token-json', 'listen-only', 'import-config']) $(`#${id}`).disabled = busy || state.connected
  $('#playwright-extract').disabled = busy || state.connected
  $('#mic').disabled = $('#input-device').disabled = busy || !state.connected || state.listenOnly
  $('#headset').disabled = $('#output-device').disabled = busy || !state.connected
}
function renderPeers() {
  if (isHidden) return
  const key = JSON.stringify(state.peers)
  if (key === peersKey) return
  peersKey = key; $('#peer-count').textContent = String(state.peers.length)
  const node = $('#peers'); node.className = state.peers.length ? 'peers' : 'peers empty'
  if (!state.peers.length) { node.innerHTML = '<p>暂无远端音轨</p>'; return }
  const fragment = document.createDocumentFragment()
  for (const peer of state.peers) {
    const row = document.createElement('div'); row.className = 'peer'
    const dot = document.createElement('span'); dot.className = 'dot'
    const name = document.createElement('span'); name.className = 'peer-name'; name.textContent = peer.label || peer.id
    const button = document.createElement('button'); button.className = 'peer-mute'; button.type = 'button'
    button.textContent = peer.muted ? '恢复' : '静音'
    button.onclick = () => runVoice('peer', { peerId: peer.id, muted: !peer.muted })
    row.append(dot, name, button); fragment.append(row)
  }
  node.replaceChildren(fragment)
}
function renderState(next = state) {
  state = next; setBusy()
  if (isHidden) return
  $('#mic').setAttribute('aria-pressed', String(state.muted)); $('#mic-label').textContent = state.muted ? '开麦' : '静音'
  $('#headset').setAttribute('aria-pressed', String(state.deafened)); $('#headset-label').textContent = state.deafened ? '恢复' : '耳机'
  $('#connection-symbol').classList.toggle('connected', state.connected)
  $('#room-label').textContent = state.connected ? state.channelId : '选择频道，开始通话'
  $('#connection-title').textContent = state.connected ? (state.listenOnly ? '已连接 · 只听模式' : '已连接语音') : '尚未连接语音'
  if (!playwrightRunning) setStatus(state.busy ? '连接中…' : state.connected ? '已加入' : '未连接', state.busy ? 'busy' : state.connected ? 'ok' : 'idle')
  if (!state.connected) { $('#meter-fill').style.transform = 'scaleX(0)'; $('#meter-value').textContent = '—' }
  renderPeers()
}
async function refreshDevices(saved = {}) {
  const devices = await voice('devices')
  for (const [id, kind, selected] of [['input-device', 'input', saved.inputDevice], ['output-device', 'output', saved.outputDevice]]) {
    const node = $(`#${id}`), previous = selected || node.value || 'default'
    node.replaceChildren(new Option('系统默认设备', 'default'), ...devices.filter(d => d[kind]).map(d => new Option(d.name, d.id)))
    node.value = [...node.options].some(o => o.value === previous) ? previous : 'default'
  }
}
async function hideToTray() {
  await saveUi(); await voice('meter', { enabled: false }); await invoke('hide_to_tray'); isHidden = true
}
async function showWindow() { await invoke('show_window'); isHidden = false; renderState(); updateMeterSubscription() }
async function runVoice(action, args = {}) {
  if (localBusy) return
  localBusy = true; setBusy()
  try { renderState(await voice(action, args)); if (action === 'leave') updateMeterSubscription(); await saveUi() }
  catch (error) { log(String(error)); setView('diagnostics') }
  finally { localBusy = false; setBusy() }
}
async function join(event) {
  event.preventDefault()
  if (localBusy || state.busy || state.connected || playwrightRunning) return
  let token
  try { token = JSON.parse($('#token-json').value) } catch { setStatus('Token JSON 无效', 'error'); return }
  localBusy = true; setBusy(); setStatus('连接中…', 'busy')
  try {
    await saveUi()
    renderState(await voice('join', {
      channelId: $('#channel-id').value.trim(), userId: $('#user-id').value.trim(), token,
      listenOnly: $('#listen-only').checked, inputDevice: $('#input-device').value || 'default', outputDevice: $('#output-device').value || 'default',
    }))
    log('已通过原生语音引擎加入频道'); await refreshDevices()
  } catch (error) {
    renderState((await invoke('app_snapshot')).voice)
    log(String(error)); setView('diagnostics'); setStatus('加入失败', 'error')
  } finally { localBusy = false; setBusy() }
  if (state.connected) await hideToTray()
}
function importConnectionConfig(text, automatic = false) {
  const config = parseConnectionConfig(text)
  $('#channel-id').value = config.channelId; $('#user-id').value = config.userId; $('#token-json').value = JSON.stringify(config.token, null, 2)
  const feedback = $('#import-feedback')
  feedback.textContent = `${automatic ? '提取成功，已自动导入' : '已导入'}频道 ${config.channelId} 的语音配置，点击「加入语音」即可连接。`
  feedback.className = 'import-feedback'; feedback.hidden = false
  log(`已导入频道 ${config.channelId} 的语音配置`); saveUi().catch(() => {})
}
async function extractWithPlaywright() {
  if (state.connected || playwrightRunning || localBusy || state.busy) return
  playwrightRunning = true; setBusy(); setView('diagnostics'); setStatus('Playwright 提取中…', 'busy')
  log('请在打开的 Edge 中登录并重新加入目标语音频道，提取后将自动导入。')
  let unlisten
  try {
    unlisten = await window.__TAURI__.event.listen('playwright-progress', ({ payload }) => { if (payload.message) log(payload.message) })
    const config = await invoke('run_playwright_extractor', { channel: $('#channel-id').value.trim() || null })
    importConnectionConfig(JSON.stringify(config), true)
    setStatus('提取成功 · 已自动导入', 'ok'); setView('connect'); await showWindow()
  } catch (error) { setStatus('Playwright 提取未完成', 'error'); log(String(error)) }
  finally { playwrightRunning = false; unlisten?.(); setBusy(); await saveUi() }
}
async function handleTrayAction(action) {
  if (['connect', 'devices', 'diagnostics'].includes(action)) { setView(action); await showWindow() }
  else if (action === 'extract') { await invoke('app_snapshot'); await extractWithPlaywright() }
}
$('#join-form').addEventListener('submit', join)
for (const id of ['connection-details', 'device-details', 'log-details', 'peers-details']) {
  $(`#${id}`).addEventListener('toggle', () => { if (ready) saveUi().catch(() => {}) })
}
$('#import-config').onclick = () => $('#config-file').click()
$('#playwright-extract').onclick = extractWithPlaywright
$('#config-file').onchange = async event => {
  const file = event.target.files?.[0]
  if (!file || state.connected) return
  try { if (file.size > 256 * 1024) throw new Error('配置文件过大'); importConnectionConfig(await file.text()) }
  catch (error) { $('#import-feedback').textContent = error.message; $('#import-feedback').className = 'import-feedback error'; $('#import-feedback').hidden = false }
  finally { event.target.value = '' }
}
$('#leave').onclick = () => runVoice('leave')
$('#tray').onclick = () => hideToTray().catch(error => log(String(error)))
$('#mic').onclick = () => runVoice('microphone'); $('#headset').onclick = () => runVoice('headset')
$('#clear-log').onclick = event => { event.preventDefault(); logBuffer = ''; $('#log').textContent = '尚无连接记录'; saveUi().catch(() => {}) }
$('#input-device').onchange = event => runVoice('input', { deviceId: event.target.value })
$('#output-device').onchange = event => runVoice('output', { deviceId: event.target.value })
for (const id of ['channel-id', 'user-id', 'token-json', 'listen-only']) $(`#${id}`).addEventListener('input', () => saveUi().catch(() => {}))
document.addEventListener('visibilitychange', () => {
  isHidden = document.hidden; updateMeterSubscription()
  if (!isHidden) { renderState(); $('#log').textContent = logBuffer }
})
async function bootstrap() {
  if (!window.__TAURI__) { setStatus('请启动桌面应用', 'idle'); return }
  await window.__TAURI__.event.listen('voice-event', ({ payload: { event, payload } }) => {
    if (event === 'state') { renderState(payload); updateMeterSubscription() }
    else if (event === 'log') log(payload.message)
    else if (event === 'meter' && !isHidden) {
      $('#meter-fill').style.transform = `scaleX(${payload.level / 100})`; $('#meter-value').textContent = `${Math.round(payload.level)}%`
    }
  })
  await window.__TAURI__.event.listen('tray-action', ({ payload }) => handleTrayAction(payload).catch(error => log(String(error))))
  await window.__TAURI__.event.listen('tray-error', async ({ payload }) => { log(payload); setView('diagnostics'); await showWindow() })
  const snapshot = await invoke('app_snapshot'), ui = snapshot.ui
  $('#channel-id').value = ui.channelId || ''; $('#user-id').value = ui.userId || ''; $('#token-json').value = ui.token || ''; $('#listen-only').checked = !!ui.listenOnly
  $('#connection-details').open = ui.connectionExpanded !== false
  $('#device-details').open = ui.deviceExpanded !== false
  $('#log-details').open = ui.logExpanded !== false
  $('#peers-details').open = ui.peersExpanded !== false
  logBuffer = ui.log || snapshot.logs.map(message => `${message}\n`).reverse().join('')
  ready = true; renderState(snapshot.voice)
  if (state.connected) await refreshDevices(ui)
  setView(ui.view || 'connect')
  if (ui.action === 'extract') await extractWithPlaywright()
}
setBusy()
bootstrap().catch(error => { log(String(error)); setStatus('初始化失败', 'error') })

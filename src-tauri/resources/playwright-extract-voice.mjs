#!/usr/bin/env node
/*
 * KOOK Voice Lite - Playwright extractor
 *
 * This is intentionally a separate automation wrapper. It uses a dedicated
 * persistent Edge profile so a successful KOOK login can be reused on later
 * runs without copying the user's normal Edge profile or its cookies.
 */
import { chromium } from 'playwright-core'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HOSTS = new Set(['www.kookapp.cn', 'www.kookyuyin.cn'])
const DEFAULT_URL = 'https://www.kookapp.cn/app/'
const PROGRAM_DIR = path.resolve(
  process.env.KOOK_VOICE_PROGRAM_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
)
const TOKEN_KEYS = [
  'gateway_url', 'wsUrl', 'iceServers', 'iceTransportPolicy',
  'rtc_config', 'rtcConfig', 'ip_discovery', 'ipDiscovery',
  'forceRelay', 'call_id', 'callId', 'join_voice', 'joinVoice', 'startAins',
]

function usage() {
  console.log(`KOOK Voice Lite Playwright 提取器

用法:
  node playwright-extract-voice.mjs [选项]

选项:
  --channel-id <数字>  只接受该频道的语音 Token（可选）
  --url <URL>          KOOK 页面地址，默认 ${DEFAULT_URL}
  --profile <目录>     持久化 Playwright 登录目录
  --output <目录>      配置和诊断输出目录
  --timeout <毫秒>     等待时间，默认 180000
  --headless           无界面运行（首次登录不要使用）
  --help               显示帮助

首次运行会打开 Edge。请在窗口中登录 KOOK，并手动进入/重新加入目标语音频道。
登录状态会保存在专用 profile，下一次运行自动复用。不会读取或改写普通 Edge profile。
`)
}

function parseArgs(argv) {
  const args = { channelId: '', url: DEFAULT_URL, profile: '', output: '', timeout: 180000, headless: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { usage(); process.exit(0) }
    if (arg === '--headless') { args.headless = true; continue }
    const next = () => {
      const value = argv[++i]
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少参数`)
      return value
    }
    if (arg === '--channel-id') { args.channelId = next(); continue }
    if (arg === '--url') { args.url = next(); continue }
    if (arg === '--profile') { args.profile = next(); continue }
    if (arg === '--output') { args.output = next(); continue }
    if (arg === '--timeout') { args.timeout = Number(next()); continue }
    throw new Error(`未知选项：${arg}`)
  }
  if (args.channelId && !/^\d+$/.test(args.channelId)) throw new Error('--channel-id 必须是数字 ID')
  if (!Number.isInteger(args.timeout) || args.timeout < 1000 || args.timeout > 1800000) throw new Error('--timeout 范围必须是 1000..1800000')
  const url = new URL(args.url)
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) throw new Error('--url 必须是 KOOK 官方网页地址')
  return args
}

function edgePath() {
  const candidates = [
    process.env.KOOK_EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean)
  const found = candidates.find(existsSync)
  if (!found) throw new Error('找不到 Microsoft Edge。可设置 KOOK_EDGE_PATH 指向 msedge.exe')
  return found
}

function defaultProfile() {
  return path.join(PROGRAM_DIR, 'playwright-profile')
}

function defaultOutput() {
  return path.join(PROGRAM_DIR, 'captures')
}

function asId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
  return /^\d+$/.test(text) ? text : ''
}

function dataObject(payload) {
  if (typeof payload?.data !== 'string') return payload?.data
  try { return JSON.parse(payload.data) } catch { return null }
}

function selectToken(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const gateway = value.gateway_url || value.wsUrl
  try {
    if (!['ws:', 'wss:'].includes(new URL(gateway).protocol)) return null
  } catch { return null }
  return Object.fromEntries(TOKEN_KEYS.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
}

function tokenFromPayload(payload) {
  const data = dataObject(payload)
  return selectToken(data) || selectToken(payload)
}

function tokenRequest(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !HOSTS.has(parsed.hostname)) return null
    const match = parsed.pathname.match(/^\/api\/v2\/channels\/token\/(\d+)\/?$/)
    return match ? { channelId: match[1], path: '/api/v2/channels/token/<id>' } : null
  } catch { return null }
}

async function pageIdentity(page) {
  return page.evaluate(() => {
    let state = {}
    try { state = window.reduxStore?.getState?.() || {} } catch {}
    const value = state.global?.userInfo?.id || window.g_client?._uid
    const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
    return { userId: /^\d+$/.test(text) ? text : '', hasClient: !!window.g_client, clientClosed: window.g_client?._closed === true }
  }).then(async identity => {
    if (identity.userId) return identity
    // Some page revisions expose the user only through the normal self API.
    const fromApi = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/v3/user/me', { credentials: 'include' })
        const payload = await response.json()
        let data = payload?.data
        if (typeof data === 'string') { try { data = JSON.parse(data) } catch {} }
        const value = data?.id || payload?.id
        const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
        return /^\d+$/.test(text) ? text : ''
      } catch { return '' }
    }).catch(() => '')
    return { ...identity, userId: fromApi }
  }).catch(() => ({ userId: '', hasClient: false, clientClosed: false }))
}

async function pageVoiceState(page) {
  return page.evaluate(() => {
    const client = window.g_client
    const candidates = [
      client?._peerConnection, client?.peerConnection, client?._pc,
      client?._client?._peerConnection, client?._client?._pc,
      client?._rtcClient?._peerConnection, client?._rtcClient?._pc,
    ].filter(Boolean)
    const first = keys => {
      for (const candidate of candidates) {
        for (const key of keys) {
          try {
            const value = candidate[key]
            if (typeof value === 'string' && value) return value
          } catch {}
        }
      }
      for (const key of keys) {
        try {
          const value = client?.[key]
          if (typeof value === 'string' && value) return value
        } catch {}
      }
      return ''
    }
    let localAudioTracks = 0
    let remoteAudioTracks = 0
    for (const candidate of candidates) {
      try { localAudioTracks = Math.max(localAudioTracks, candidate.getSenders?.().filter(sender => sender.track?.kind === 'audio').length || 0) } catch {}
      try { remoteAudioTracks = Math.max(remoteAudioTracks, candidate.getReceivers?.().filter(receiver => receiver.track?.kind === 'audio').length || 0) } catch {}
    }
    const connectionState = first(['connectionState'])
    const iceConnectionState = first(['iceConnectionState'])
    const connected = ['connected', 'completed'].includes(connectionState) || ['connected', 'completed'].includes(iceConnectionState)
    return {
      clientPresent: !!client,
      clientClosed: client?._closed === true,
      connectionState,
      iceConnectionState,
      localAudioTracks,
      remoteAudioTracks,
      verification: connected ? 'connected' : (connectionState || iceConnectionState ? 'not-connected' : 'unavailable'),
    }
  }).catch(() => ({ clientPresent: false, clientClosed: false, connectionState: '', iceConnectionState: '', localAudioTracks: 0, remoteAudioTracks: 0, verification: 'unavailable' }))
}

async function waitForVoiceState(page, timeout = 8000) {
  const deadline = Date.now() + timeout
  let state = await pageVoiceState(page)
  while (Date.now() < deadline && state.verification === 'unavailable') {
    await new Promise(resolve => setTimeout(resolve, 500))
    state = await pageVoiceState(page)
  }
  return state
}

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
  await rename(temporary, file)
}

async function report(stage, message, config) {
  console.log(message)
  if (process.env.KOOK_PLAYWRIGHT_STATUS) {
    await atomicJson(process.env.KOOK_PLAYWRIGHT_STATUS, { stage, message, ...(config ? { config } : {}) })
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const profile = path.resolve(args.profile || process.env.KOOK_PLAYWRIGHT_PROFILE || defaultProfile())
  const output = path.resolve(args.output || process.env.KOOK_VOICE_OUTPUT || defaultOutput())
  await mkdir(profile, { recursive: true })
  await mkdir(output, { recursive: true })

  const diagnostics = {
    schema: 'kook-voice-lite/playwright-diagnostic-v1',
    startedAt: new Date().toISOString(),
    pageHost: '', requests: 0, matchingResponses: 0, httpStatus: null,
    apiCode: null, responseKeys: [], dataKeys: [], gatewayPresent: false,
    stage: 'starting', clientPresent: false, clientClosed: false,
    voiceState: null,
  }
  await report('opening', '正在打开 Edge，复用已保存的登录状态…')
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edgePath(),
    headless: args.headless,
    acceptDownloads: true,
    viewport: null,
  })
  await context.grantPermissions(['microphone'], { origin: new URL(args.url).origin }).catch(() => {})
  let page = context.pages()[0] || await context.newPage()
  const onPage = candidate => { if (!page || page.isClosed()) page = candidate; wirePage(candidate) }
  context.on('page', onPage)
  diagnostics.stage = 'waiting'

  let resolveCapture
  let rejectCapture
  let captured = false
  const capture = new Promise((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject })
  // Navigation can fail before capture is awaited.
  capture.catch(() => {})
  context.once('close', () => rejectCapture(new Error('Edge 已关闭，可再次点击按钮重试')))
  const timer = setTimeout(() => rejectCapture(new Error('等待语音 Token 超时')), args.timeout)

  const onResponse = async response => {
    if (captured) return
    const info = tokenRequest(response.url())
    if (!info) return
    diagnostics.matchingResponses += 1
    diagnostics.httpStatus = response.status()
    if (response.status() < 200 || response.status() >= 300) {
      diagnostics.stage = 'http-error'
      return
    }
    let payload
    try { payload = await response.json() } catch { diagnostics.stage = 'invalid-json'; return }
    diagnostics.responseKeys = payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 30) : []
    const data = dataObject(payload)
    diagnostics.dataKeys = data && typeof data === 'object' ? Object.keys(data).slice(0, 30) : []
    diagnostics.apiCode = payload?.code === undefined ? null : Number(payload.code)
    diagnostics.gatewayPresent = !!(data?.gateway_url || data?.wsUrl || payload?.gateway_url || payload?.wsUrl)
    if (payload?.code !== undefined && Number(payload.code) !== 0) { diagnostics.stage = 'api-error'; return }
    const token = tokenFromPayload(payload)
    if (!token) { diagnostics.stage = 'missing-gateway'; return }
    if (args.channelId && info.channelId !== args.channelId) {
      await report('wrong-channel', '已收到其他频道请求，请加入填写的目标频道，或清空频道 ID 后重试。')
      return
    }
    captured = true
    diagnostics.stage = 'captured'
    await report('captured', '已捕获语音凭证，正在读取当前用户 ID…')
    let sourcePage = page
    try { sourcePage = response.frame()?.page() || page } catch {}
    try {
      const identity = await pageIdentity(sourcePage)
      resolveCapture({ channelId: info.channelId, userId: identity.userId, token, identity, page: sourcePage })
    } catch (error) { rejectCapture(error) }
  }
  function wirePage(candidate) {
    candidate.on('response', response => { diagnostics.requests += 1; onResponse(response).catch(rejectCapture) })
  }
  for (const candidate of context.pages()) wirePage(candidate)

  try {
    await report('waiting', args.channelId ? `等待频道 ${args.channelId} 的语音请求，请在 Edge 中退出并重新加入该频道。` : '等待语音请求，请在 Edge 中登录并加入目标语音频道。')
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    diagnostics.pageHost = new URL(page.url()).hostname
    console.log(`Playwright profile: ${profile}`)
    console.log(`页面已打开：${page.url()}`)
    console.log('首次运行请在 Edge 中登录 KOOK，然后手动退出并重新加入目标语音频道。')
    const result = await capture
    clearTimeout(timer)
    if (!result.userId) {
      diagnostics.stage = 'missing-user-id'
      throw new Error('已捕获语音凭证，但未能读取当前用户 ID；请保持页面登录并重试')
    }
    const config = { schema: 'kook-voice-lite/connection-v1', channelId: result.channelId, userId: result.userId, token: result.token, capturedAt: new Date().toISOString() }
    const configPath = path.join(output, `kook-voice-${result.channelId}.json`)
    await atomicJson(configPath, config)
    await report('verifying', '配置已保存，正在检查网页语音连接状态…')
    const capturedPage = result.page || page
    const after = await pageIdentity(capturedPage)
    const voiceState = await waitForVoiceState(capturedPage)
    diagnostics.clientPresent = voiceState.clientPresent || after.hasClient
    diagnostics.clientClosed = voiceState.clientClosed || after.clientClosed
    diagnostics.voiceState = voiceState
    diagnostics.stage = voiceState.verification === 'connected' ? 'captured-connected' : (diagnostics.clientClosed ? 'captured-client-closed' : 'captured')
    diagnostics.finishedAt = new Date().toISOString()
    const diagnosticPath = path.join(output, 'kook-voice-playwright-diagnostic.json')
    await atomicJson(diagnosticPath, diagnostics)
    console.log(`已保存配置：${configPath}`)
    console.log(`已保存诊断：${diagnosticPath}`)
    console.log(`语音连接验证：${voiceState.verification}（connection=${voiceState.connectionState || 'n/a'}, ice=${voiceState.iceConnectionState || 'n/a'}）`)
    await report('done', process.env.KOOK_PLAYWRIGHT_STATUS ? '提取成功，正在自动导入 KOOK Lite。' : '提取成功，请将配置 JSON 导入 KOOK Lite。', config)
  } catch (error) {
    clearTimeout(timer)
    diagnostics.stage = diagnostics.stage === 'starting' ? 'failed' : diagnostics.stage
    diagnostics.finishedAt = new Date().toISOString()
    const diagnosticPath = path.join(output, 'kook-voice-playwright-diagnostic.json')
    await atomicJson(diagnosticPath, diagnostics)
    console.error(`提取失败：${error?.message || String(error)}`)
    console.error(`已保存诊断：${diagnosticPath}`)
    await report('error', error?.message || String(error))
    process.exitCode = 1
  } finally {
    await context.close()
  }
}

main().catch(async error => {
  console.error(error?.stack || error)
  await report('error', error?.message || String(error)).catch(() => {})
  process.exitCode = 1
})

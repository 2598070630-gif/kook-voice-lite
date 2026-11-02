/* KOOK Voice Lite: run in the DevTools console of your signed-in KOOK Edge tab. */
(() => {
  'use strict'
  if (location.protocol !== 'https:' || !['www.kookapp.cn', 'www.kookyuyin.cn'].includes(location.hostname)) {
    throw new Error('请在已登录的 KOOK 网页版 https://www.kookapp.cn/app/ 中运行。')
  }
  const previous = window.__kookVoiceLiteExtractor
  if (previous?.version === 2) previous.dispose()
  else if (previous) throw new Error('检测到旧版提取脚本。请先刷新 KOOK 页面，再执行新版脚本。')

  const originalFetch = window.fetch
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  const requests = new WeakMap()
  const xhrListeners = new Map()
  const tokenKeys = ['gateway_url', 'wsUrl', 'iceServers', 'iceTransportPolicy', 'rtc_config', 'rtcConfig', 'call_id', 'callId', 'join_voice', 'joinVoice', 'startAins']
  let pending = null
  let result = null
  let stopped = false
  let lastDownloaded = ''
  let timer = 0
  let sawTokenResponse = false
  const diagnostic = { version: 2, stage: 'waiting', requests: 0, lastRequestPath: '', httpStatus: null, apiCode: null, responseKeys: [], dataKeys: [], gatewayPresent: false, gatewayType: 'undefined', hasCurrentUser: false, hasCurrentChannel: false, hasClient: false }

  const host = document.createElement('div')
  host.id = 'kook-voice-lite-extractor'
  host.style.cssText = 'position:fixed;right:20px;top:20px;z-index:2147483647;'
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `<style>
    :host{all:initial}*{box-sizing:border-box}.panel{width:340px;padding:18px;color:#e4e5e7;background:#222629;border:1px solid #465139;border-radius:10px;font:13px/1.65 "Segoe UI","Microsoft YaHei",sans-serif}h3{margin:0 0 8px;font-size:15px;color:#98e62d}p{margin:8px 0;overflow-wrap:anywhere}.note{color:#a2aaa8;font-size:12px}button{font:inherit;cursor:pointer;border:0;border-radius:5px;padding:7px 12px;background:#87d80b;color:#20300c}button:disabled{opacity:.4;cursor:default}.buttons{display:flex;gap:8px;margin-top:12px}.quiet{color:#c3c9cc;background:#373c40}.status{white-space:pre-line}
  </style><section class="panel"><h3>KOOK · 语音配置提取 v2</h3><p class="status" role="status"></p><p class="note">先运行脚本，再手动退出并重新加入目标语音频道。诊断文件不含用户 ID、频道 ID 或凭证内容；语音配置仅保存在本机，请勿分享。</p><div class="buttons"><button id="save" disabled>下载配置</button><button id="diagnostic" class="quiet">下载诊断</button><button id="close" class="quiet">关闭</button></div></section>`
  document.documentElement.appendChild(host)
  const status = shadow.querySelector('.status')
  const save = shadow.querySelector('#save')
  status.textContent = '正在等候语音请求…\n若已经在频道中，请手动退出后重新加入；只点击当前频道可能不会发出新请求。'

  function asId(value) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
    const s = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
    return /^\d+$/.test(s) ? s : ''
  }

  function selectToken(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const gateway = value.gateway_url || value.wsUrl
    try { if (!['ws:', 'wss:'].includes(new URL(gateway).protocol)) return null } catch { return null }
    return Object.fromEntries(tokenKeys.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
  }

  // The shipped web app exposes reduxStore; user identity does not depend on RTC backend.
  function pageState() {
    let state = {}
    try { state = window.reduxStore?.getState?.() || {} } catch {}
    const userId = asId(state.global?.userInfo?.id) || asId(window.g_client?._uid) || observedUserId
    const channelId = asId(state.audio?.currentAudioChannelInfo?.id)
    diagnostic.hasCurrentUser = !!userId
    diagnostic.hasCurrentChannel = !!channelId
    diagnostic.hasClient = !!(window.g_client || state.audio?.audioClient)
    return { state, userId, channelId }
  }

  // Read only the current page's known voice-client fields. No cookie/storage scan.
  function snapshot() {
    const page = pageState()
    const client = window.g_client || page.state.audio?.audioClient
    if (!client || client._closed === true) return null
    const channelId = asId(client._roomId) || page.channelId
    const userId = page.userId || asId(client._uid)
    if (!channelId || !userId) return null
    const config = client.tokenConfig || {}
    const token = selectToken({ ...config.raw, ...config, gateway_url: client._options?.gateway_url || config.gateway_url || config.wsUrl })
    return token ? { channelId, userId, token } : null
  }

  function stopHooks() {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    if (window.fetch === wrappedFetch) window.fetch = originalFetch
    if (XMLHttpRequest.prototype.open === wrappedOpen) XMLHttpRequest.prototype.open = originalOpen
    if (XMLHttpRequest.prototype.send === wrappedSend) XMLHttpRequest.prototype.send = originalSend
    for (const [xhr, listener] of xhrListeners) xhr.removeEventListener('load', listener)
    xhrListeners.clear()
  }

  function downloadJson(value, name) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function download() {
    if (!result) return
    downloadJson(result, `kook-voice-${result.channelId}.json`)
    lastDownloaded = JSON.stringify(result)
  }

  function complete(value) {
    diagnostic.stage = 'complete'
    result = { schema: 'kook-voice-lite/connection-v1', ...value, capturedAt: new Date().toISOString() }
    save.disabled = false
    status.textContent = `已提取频道 ID：${value.channelId}\n用户 ID：${value.userId}\n语音凭证已就绪。请在轻量客户端点击「导入 Edge 语音配置」。若未自动下载，点击下方按钮。`
    stopHooks()
    if (JSON.stringify(result) !== lastDownloaded) download()
  }

  function refresh() {
    if (result || stopped) return
    const page = pageState()
    if (pending && page.userId) {
      complete({ channelId: pending.channelId, userId: page.userId, token: pending.token })
      return
    }
    const current = snapshot()
    if (pending && current?.channelId === pending.channelId) complete({ channelId: pending.channelId, userId: current.userId, token: pending.token })
    else if (!sawTokenResponse && current) complete(current)
    else if (!sawTokenResponse && page.userId && page.channelId) status.textContent = '已识别你的用户和当前频道，但没有可读取的语音网关。\n请手动退出语音频道，再重新加入，以捕获新的语音响应。'
  }

  function requestInfo(url) {
    try {
      const parsed = new URL(url, location.href)
      if (parsed.protocol !== 'https:' || !['www.kookapp.cn', 'www.kookyuyin.cn'].includes(parsed.hostname)) return null
      const channelId = parsed.pathname.match(/^\/api\/v2\/channels\/token\/(\d+)\/?$/)?.[1]
      const self = /^\/api\/v3\/user\/me\/?$/.test(parsed.pathname)
      return channelId ? { channelId, path: '/api/v2/channels/token/<id>' } : self ? { self: true, path: '/api/v3/user/me' } : null
    } catch { return null }
  }

  let observedUserId = ''
  function observeSelf(payload) {
    if (stopped || (payload?.code !== undefined && Number(payload.code) !== 0)) return
    observedUserId = asId(payload?.data?.id) || asId(payload?.id)
    if (pending && observedUserId) complete({ channelId: pending.channelId, userId: observedUserId, token: pending.token })
  }

  function dataObject(payload) {
    if (typeof payload?.data !== 'string') return payload?.data
    try { return JSON.parse(payload.data) } catch { return null }
  }

  function observeResponse(info, payload) {
    if (info.self) observeSelf(payload)
    else observe(info.channelId, payload)
  }

  function recordResponse(info, httpStatus) {
    if (info.self || stopped) return
    diagnostic.requests++
    diagnostic.lastRequestPath = info.path
    diagnostic.httpStatus = httpStatus
    if (httpStatus < 200 || httpStatus >= 300) {
      diagnostic.stage = 'http-error'
      sawTokenResponse = true
      status.textContent = `已捕获语音请求，但服务器返回 HTTP ${httpStatus}。请先确认网页可以正常加入频道，再下载诊断。`
    }
  }

  function observe(channelId, payload) {
    if (stopped) return
    sawTokenResponse = true
    pending = null
    const data = dataObject(payload)
    diagnostic.responseKeys = payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 30) : []
    diagnostic.dataKeys = data && typeof data === 'object' ? Object.keys(data).slice(0, 30) : []
    const gateway = data?.gateway_url || data?.wsUrl || payload?.gateway_url || payload?.wsUrl
    diagnostic.gatewayPresent = !!gateway
    diagnostic.gatewayType = typeof gateway
    diagnostic.apiCode = typeof payload?.code === 'number' || /^-?\d+$/.test(String(payload?.code)) ? Number(payload.code) : null
    if (payload?.code !== undefined && Number(payload.code) !== 0) {
      diagnostic.stage = 'api-error'
      status.textContent = '网页加入频道未成功。请在网页完成登录、频道密码或权限操作后再试。'
      return
    }
    const token = selectToken(data) || selectToken(payload)
    if (!token) {
      diagnostic.stage = 'missing-gateway'
      status.textContent = gateway ? '响应包含网关字段，但格式不符合此客户端要求。请下载诊断，便于适配实际格式。' : '已捕获语音响应，但没有 WebRTC 网关字段。当前后端或响应格式与轻量客户端不兼容；请下载诊断，不能凭空生成凭证。'
      return
    }
    diagnostic.stage = 'waiting-user'
    pending = { channelId, token }
    if (observedUserId) { complete({ channelId, userId: observedUserId, token }); return }
    status.textContent = '已捕获语音凭证，正在读取当前用户 ID。若持续停留在此处，请下载诊断。'
    refresh()
  }

  async function wrappedFetch(input, options) {
    const info = requestInfo(typeof input === 'string' || input instanceof URL ? String(input) : input?.url)
    const response = await originalFetch.apply(this, arguments)
    if (info && !stopped) {
      recordResponse(info, response.status)
      // Clone only the exact voice-token response; preserve the page's response body.
      if (response.ok) {
        try { void response.clone().json().then(payload => observeResponse(info, payload)).catch(() => { if (!stopped && !info.self) { diagnostic.stage = 'invalid-json'; status.textContent = '语音响应不是有效 JSON，请下载诊断。' } }) } catch {}
      }
    }
    return response
  }

  function wrappedOpen(method, url) {
    requests.set(this, requestInfo(url))
    return originalOpen.apply(this, arguments)
  }

  function wrappedSend() {
    const info = requests.get(this)
    if (info && !stopped) {
      const xhr = this
      const listener = () => {
        xhrListeners.delete(xhr)
        if (stopped) return
        recordResponse(info, xhr.status)
        if (xhr.status < 200 || xhr.status >= 300) return
        try { observeResponse(info, xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText)) } catch { if (!info.self) { diagnostic.stage = 'invalid-json'; status.textContent = '语音响应不是有效 JSON，请下载诊断。' } }
      }
      xhrListeners.set(xhr, listener)
      xhr.addEventListener('load', listener, { once: true })
    }
    return originalSend.apply(this, arguments)
  }

  window.fetch = wrappedFetch
  XMLHttpRequest.prototype.open = wrappedOpen
  XMLHttpRequest.prototype.send = wrappedSend
  function dispose() {
    stopHooks()
    pending = null
    result = null
    observedUserId = ''
    host.remove()
    delete window.__kookVoiceLiteExtractor
  }
  window.__kookVoiceLiteExtractor = { version: 2, refresh, dispose }
  save.addEventListener('click', download)
  shadow.querySelector('#diagnostic').addEventListener('click', () => {
    pageState()
    downloadJson({ ...diagnostic, pageHost: location.hostname }, 'kook-voice-diagnostic.json')
  })
  shadow.querySelector('#close').addEventListener('click', dispose)
  // Poll only during extraction, for at most 3 minutes. No permanent background work.
  const deadline = Date.now() + 180000
  timer = setInterval(() => {
    refresh()
    if (!stopped && Date.now() >= deadline) {
      stopHooks()
      if (diagnostic.stage === 'waiting') status.textContent = '三分钟内没有捕获到语音请求。提取已停止。请先下载诊断，再重新执行脚本，手动退出并重新加入频道。'
      else status.textContent += '\n提取已在三分钟后停止。可以下载诊断，然后重新执行脚本。'
    }
  }, 500)
  refresh()
})()

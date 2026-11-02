const paths = {
  voice: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  headset: '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  diagnostics: '<path d="M4 20h16M7 16v-5m5 5V4m5 12V8"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  leave: '<path d="M9 4H4v16h5m1-8h11m-4-4 4 4-4 4"/>',
  tray: '<path d="M4 15v5h16v-5M12 3v12m-5-5 5 5 5-5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
}

export function icon(name, className = '') {
  return `<svg class="icon ${className}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`
}

export function renderShell() {
  return `
  <div class="desktop-shell">
    <aside class="channel-sidebar">
      <header class="space-header"><strong>KOOK <span>LITE</span></strong></header>
      <div class="sidebar-content">
        <nav class="channel-nav" aria-label="应用页面">
          <button id="nav-connect" class="nav-item active" data-view="connect" aria-current="page">${icon('voice')}<span>语音连接</span><i class="nav-dot"></i></button>
          <button id="nav-devices" class="nav-item" data-view="devices">${icon('settings')}<span>音频设备</span></button>
          <button id="nav-diagnostics" class="nav-item" data-view="diagnostics">${icon('diagnostics')}<span>连接诊断</span></button>
        </nav>
      </div>
      <div class="local-session"><span id="sidebar-status">尚未连接</span><small>关闭窗口后留在托盘</small></div>
    </aside>

    <section class="main-area">
      <header class="channel-header">
        <div class="channel-title">${icon('voice')}<strong id="view-title">语音连接</strong></div>
        <span id="status" class="status idle"><i></i>未连接</span>
      </header>

      <div class="main-body">
        <main class="view-scroll">
          <section id="view-connect" class="view" aria-labelledby="connect-heading">
            <div class="page-heading"><h1 id="connect-heading">连接语音频道</h1><p>准备好设备，加入你的频道。</p></div>
            <form id="join-form" class="connection-form">
              <div class="import-row"><button id="import-config" class="import-button" type="button">${icon('arrow')}导入配置</button><button id="playwright-extract" class="import-button" type="button">${icon('voice')}使用playwright调用</button></div>
              <input id="config-file" type="file" accept=".json,application/json" hidden />
              <p id="import-feedback" class="import-feedback" role="status" hidden></p>
              <div class="field-grid">
                <label for="channel-id">频道 ID <span class="required">*</span><input id="channel-id" required placeholder="输入语音频道 ID" autocomplete="off" /></label>
                <label for="user-id">用户 ID <span class="required">*</span><input id="user-id" required placeholder="输入你的 KOOK 用户 ID" autocomplete="off" /></label>
              </div>
              <label class="token-label" for="token-json">语音凭证 <span class="field-note">Token JSON</span><textarea id="token-json" required spellcheck="false" autocomplete="off" placeholder='粘贴有效的语音 Token JSON\n{"gateway_url":"…","iceServers":[]}'></textarea></label>
              <label class="listen-option"><span class="listen-icon">${icon('headset')}</span><span class="listen-copy"><strong>只听模式</strong><small>收听频道，不启用麦克风</small></span><input id="listen-only" type="checkbox" /><span class="switch" aria-hidden="true"></span></label>
              <button id="join" class="primary" type="submit">${icon('voice')}<span>加入语音</span>${icon('arrow', 'join-arrow')}</button>
              <p class="credential-hint">${icon('shield')}凭证仅保存在本机，请勿分享导出配置。</p>
            </form>
          </section>

          <section id="view-devices" class="view" hidden aria-labelledby="devices-heading">
            <div class="page-heading"><h1 id="devices-heading">音频设备</h1><p>加入频道后，可切换输入和输出设备。</p></div>
            <div class="device-settings">
              <label for="input-device">输入设备<select id="input-device" disabled><option value="default">加入后选择麦克风</option></select></label>
              <label for="output-device">输出设备<select id="output-device" disabled><option value="default">加入后选择扬声器</option></select></label>
              <div class="meter-heading"><span>麦克风音量</span><span id="meter-value">—</span></div>
              <div class="meter"><span id="meter-fill"></span></div>
              <p class="device-hint">只听模式不采集麦克风。静音和耳机开关始终在下方。</p>
            </div>
          </section>

          <section id="view-diagnostics" class="view" hidden aria-labelledby="diagnostics-heading">
            <div class="page-heading"><h1 id="diagnostics-heading">连接诊断</h1><p>查看当前会话的连接状态与错误。</p></div>
            <div class="log-heading"><span>本次会话记录</span><button id="clear-log" type="button" class="text-button">清空记录</button></div>
            <pre id="log" class="diagnostic-log">尚无连接记录</pre>
          </section>
        </main>

        <aside class="member-sidebar" aria-labelledby="members-heading">
          <div class="member-heading"><h2 id="members-heading">远端音轨</h2><span id="peer-count">0</span></div>
          <div id="peers" class="peers empty"><p>暂无远端音轨</p></div>
        </aside>
      </div>

      <footer class="voice-dock">
        <div class="dock-connection"><span id="connection-symbol" class="connection-symbol">${icon('voice')}</span><div><strong id="connection-title">尚未连接语音</strong><span id="room-label">选择频道，开始通话</span></div></div>
        <div class="dock-actions">
          <button id="mic" class="dock-control" type="button" disabled aria-pressed="false" title="麦克风静音">${icon('mic')}<span id="mic-label">静音</span></button>
          <button id="headset" class="dock-control" type="button" disabled aria-pressed="false" title="耳机静音">${icon('headset')}<span id="headset-label">耳机</span></button>
          <span class="dock-divider"></span>
          <button id="tray" class="dock-control" type="button" title="隐藏到托盘">${icon('tray')}<span>托盘</span></button>
          <button id="leave" class="disconnect" type="button" disabled title="断开语音">${icon('leave')}<span>断开</span></button>
        </div>
      </footer>
    </section>
  </div>`
}

const paths = {
  voice: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  headset: '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
  voice: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
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
    <section class="main-area">
      <header class="channel-header">
        <span id="status" class="status idle"><i></i>未连接</span>
      </header>

      <div class="main-body">
        <main class="view-scroll" tabindex="0" aria-label="语音内容">
          <section id="view-workspace" class="view workspace" aria-label="语音内容">
            <div class="workspace-grid">
              <details id="connection-details" class="workspace-card connection-card" open>
                <summary class="card-heading connection-summary"><h2>连接语音频道</h2><span class="card-summary-meta"><span>配置</span><span class="collapse-label">收起</span></span></summary>
                <form id="join-form" class="connection-form">
                  <div class="import-row"><button id="import-config" class="import-button" type="button">${icon('arrow')}导入配置</button><button id="playwright-extract" class="import-button" type="button">${icon('voice')}使用playwright调用</button></div>
                  <input id="config-file" type="file" accept=".json,application/json" hidden />
                  <p id="import-feedback" class="import-feedback" role="status" hidden></p>
                  <div class="field-grid">
                    <label for="channel-id">频道 ID <span class="required">*</span><input id="channel-id" required placeholder="语音频道 ID" autocomplete="off" /></label>
                    <label for="user-id">用户 ID <span class="required">*</span><input id="user-id" required placeholder="KOOK 用户 ID" autocomplete="off" /></label>
                  </div>
                  <label class="token-label" for="token-json">语音凭证 <span class="field-note">Token JSON</span><textarea id="token-json" required spellcheck="false" autocomplete="off" placeholder='粘贴有效的语音 Token JSON\n{"gateway_url":"…","iceServers":[]}'></textarea></label>
                  <label class="listen-option"><span class="listen-icon">${icon('headset')}</span><span class="listen-copy"><strong>只听模式</strong><small>收听频道，不启用麦克风</small></span><input id="listen-only" type="checkbox" /><span class="switch" aria-hidden="true"></span></label>
                  <button id="join" class="primary" type="submit">${icon('voice')}<span>加入语音</span>${icon('arrow', 'join-arrow')}</button>
                  <p class="credential-hint">${icon('shield')}凭证仅保存在本机，请勿分享导出配置。</p>
                </form>
              </details>

              <details id="device-details" class="workspace-card device-card" open>
                <summary class="card-heading unit-summary"><h2>音频设备</h2><span>实时</span></summary>
                <div class="device-settings">
                  <label for="input-device">输入设备<select id="input-device" disabled><option value="default">加入后选择麦克风</option></select></label>
                  <label for="output-device">输出设备<select id="output-device" disabled><option value="default">加入后选择扬声器</option></select></label>
                  <div class="meter-heading"><span>麦克风音量</span><span id="meter-value">—</span></div>
                  <div class="meter"><span id="meter-fill"></span></div>
                  <p class="device-hint">只听模式不采集麦克风。建议佩戴耳机，避免外放回声。</p>
                </div>
              </details>
            </div>

            <details id="log-details" class="workspace-card diagnostic-panel" open>
              <summary class="log-heading unit-summary"><span>连接日志</span><button id="clear-log" type="button" class="text-button">清空记录</button></summary>
              <pre id="log" class="diagnostic-log">尚无连接记录</pre>
            </details>
          </section>
        </main>

        <details id="peers-details" class="member-sidebar" open>
          <summary class="member-heading"><h2>远端音轨</h2><span id="peer-count">0</span></summary>
          <div id="peers" class="peers empty"><p>暂无远端音轨</p></div>
        </details>
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

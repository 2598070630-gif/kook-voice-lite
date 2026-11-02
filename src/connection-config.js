// IDs stay strings: KOOK channel IDs can exceed Number.MAX_SAFE_INTEGER.
function idString(value, name) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`${name} 精度已丢失，请重新提取`)
  const result = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
  if (!result || !/^\d+$/.test(result)) throw new Error(`${name} 必须是完整的数字 ID`)
  return result
}

export function parseConnectionConfig(text) {
  let data
  try { data = JSON.parse(text) } catch { throw new Error('配置文件不是有效 JSON') }
  if (data?.schema !== 'kook-voice-lite/connection-v1') throw new Error('请选择 Edge 提取脚本生成的配置文件')
  const channelId = idString(data.channelId, '频道 ID')
  const userId = idString(data.userId, '用户 ID')
  const token = data.token
  if (!token || typeof token !== 'object' || Array.isArray(token)) throw new Error('配置缺少语音凭证')
  let gateway
  try { gateway = new URL(token.gateway_url || token.wsUrl) } catch { throw new Error('语音凭证缺少有效的 gateway_url') }
  if (!['ws:', 'wss:'].includes(gateway.protocol)) throw new Error('语音网关必须是 WebSocket 地址')
  return { channelId, userId, token, capturedAt: typeof data.capturedAt === 'string' ? data.capturedAt : '' }
}

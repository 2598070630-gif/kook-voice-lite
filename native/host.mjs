import { createInterface } from 'node:readline'
// stdout is a JSON-only pipe owned by Tauri. Never print native SDK diagnostic arguments.
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`)
console.log = console.info = console.debug = console.warn = console.error = () => {}
const { VoiceEngine } = await import('./engine.mjs')
const engine = new VoiceEngine((event, payload) => {
  send({ event, payload })
  if (event === 'session-closed' && payload?.unexpected) setTimeout(() => process.exit(0), 100)
})
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
let queue = Promise.resolve()
input.on('line', line => {
  let request
  try { request = JSON.parse(line) } catch { return }
  queue = queue.then(async () => {
    try { send({ id: request.id, result: await engine.command(request.action, request.args) }) }
    catch { send({ id: request.id, error: request.action === 'join' ? '原生语音连接失败，请检查凭证、网络和音频设备。' : '原生音频操作失败，请检查设备和连接状态。' }) }
  })
})
// Parent exit closes this pipe, including after a crash; native audio cannot outlive it.
input.on('close', () => { engine.client?.close(); engine.audio.close(); process.exit(0) })
process.on('uncaughtException', () => { send({ event: 'log', payload: { message: '原生语音进程异常退出。' } }); process.exit(1) })
send({ event: 'ready', payload: { backend: 'libwebrtc-wasapi' } })

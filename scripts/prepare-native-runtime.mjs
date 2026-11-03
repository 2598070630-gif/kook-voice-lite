import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const resources = path.join(root, 'src-tauri/resources')
const modules = path.join(resources, 'node_modules')
await mkdir(modules, { recursive: true })
await cp(path.join(root, 'native'), path.join(resources, 'native'), { recursive: true, force: true })
// Runtime files only. Audify's compiler/vendor tree is not needed to load its prebuilt addon.
const files = {
  '@kookapp/voice-rtc-core': ['package.json', 'dist', 'LICENSE'],
  '@roamhq/wrtc': ['package.json', 'lib'],
  '@roamhq/wrtc-win32-x64': ['package.json', 'index.js', 'wrtc.node'],
  audify: ['package.json', 'index.js', 'LICENSE', 'build/Release'],
  bindings: ['package.json', 'bindings.js', 'LICENSE.md'],
  'file-uri-to-path': ['package.json', 'index.js', 'LICENSE'],
  ws: ['package.json', 'index.js', 'browser.js', 'wrapper.mjs', 'LICENSE', 'lib'],
}
for (const [name, entries] of Object.entries(files)) {
  const source = path.join(root, 'node_modules', name), target = path.join(modules, name)
  await mkdir(target, { recursive: true })
  for (const entry of entries) await cp(path.join(source, entry), path.join(target, entry), { recursive: true, force: true })
}
// Both packages advertise licenses but their npm binary archives omit the notice.
// Include the upstream notice alongside the native binary and in the release license directory.
for (const name of ['@roamhq/wrtc', '@roamhq/wrtc-win32-x64']) {
  const notice = await readFile(path.join(root, 'native/licenses/node-webrtc-LICENSE'), 'utf8')
  await writeFile(path.join(modules, name, 'LICENSE'), notice)
}
console.log('Prepared native libwebrtc/WASAPI runtime (no browser voice SDK).')

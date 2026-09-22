import { createRequire } from 'node:module'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const scriptDir = dirname(fileURLToPath(import.meta.url))

function getTarget() {
  if (process.platform === 'darwin' && (process.arch === 'x64' || process.arch === 'arm64')) {
    return { backend: 'fs-events', file: `darwin-${process.arch}.node` }
  }
  if (process.platform === 'win32' && (process.arch === 'x64' || process.arch === 'arm64')) {
    return { backend: 'windows', file: `win32-${process.arch}.node` }
  }
  if (process.platform === 'freebsd' && process.arch === 'x64') {
    return { backend: 'kqueue', file: 'freebsd-x64.node' }
  }
  if (process.platform === 'linux' && (process.arch === 'x64' || process.arch === 'arm64' || process.arch === 'arm')) {
    let report
    try {
      report = process.report?.getReport()
    } catch {}
    const libc = typeof report !== 'object' || report == null || typeof report.header?.glibcVersionRuntime === 'string' ? 'glibc' : 'musl'
    return { backend: 'inotify', file: `linux-${process.arch}-${libc}.node` }
  }
  throw new Error(`No bundled watcher for ${process.platform}-${process.arch}`)
}

function pathKey(filepath) {
  if (process.platform === 'win32') {
    if (filepath.toLowerCase().startsWith('\\\\?\\unc\\')) {
      filepath = `\\\\${filepath.slice(8)}`
    } else if (filepath.startsWith('\\\\?\\')) {
      filepath = filepath.slice(4)
    }
  } else if (process.platform === 'darwin') {
    filepath = filepath.normalize('NFC')
  }
  return process.platform === 'darwin' || process.platform === 'win32' ? filepath.toLowerCase() : filepath
}

const target = getTarget()
const binary = join(scriptDir, '..', 'bin', 'watcher', target.file)
const binding = require(binary)
const root = await mkdtemp(join(tmpdir(), 'coc-watcher-smoke-'))
const watchRoot = await realpath(root)
const createdFile = join(watchRoot, 'created.txt')
const createdFileKey = pathKey(createdFile)
let timeout
let callback

try {
  const eventReceived = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`No event received from ${target.file}`)), 15000)
    callback = (error, events) => {
      if (error) {
        reject(error)
      } else if (events.some(event => {
        const eventPath = pathKey(event.path)
        return eventPath === createdFileKey && event.type === 'create'
      })) {
        resolve()
      }
    }
  })
  await binding.subscribe(watchRoot, callback, { backend: target.backend })
  await writeFile(createdFile, 'watcher smoke test')
  await eventReceived
  console.log(`Verified ${target.file} with ${target.backend}`)
} finally {
  clearTimeout(timeout)
  if (callback) await binding.unsubscribe(watchRoot, callback, { backend: target.backend })
  await rm(root, { recursive: true, force: true })
}

import { appendFile, mkdtemp, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const scriptDir = dirname(fileURLToPath(import.meta.url))

function getTarget() {
  if (process.platform === 'darwin' && (process.arch === 'x64' || process.arch === 'arm64')) return `darwin-${process.arch}.node`
  if (process.platform === 'win32' && (process.arch === 'x64' || process.arch === 'arm64')) return `win32-${process.arch}.node`
  if (process.platform === 'linux' && (process.arch === 'x64' || process.arch === 'arm64')) {
    let report
    try {
      report = process.report?.getReport()
    } catch {}
    const libc = typeof report !== 'object' || report == null || typeof report.header?.glibcVersionRuntime === 'string' ? 'glibc' : 'musl'
    return `linux-${process.arch}-${libc}.node`
  }
  throw new Error(`No bundled watcher for ${process.platform}-${process.arch}`)
}

const binary = getTarget()
const binding = require(join(scriptDir, '..', 'bin', 'watcher', binary))
const root = await mkdtemp(join(tmpdir(), 'coc-watcher-smoke-'))
const watchRoot = await realpath(root)
const created = join(watchRoot, 'created.txt')
const renamed = join(watchRoot, 'renamed.txt')
let handler
let rejectWait
const callback = (error, events) => handler?.(error, events)

function waitFor(predicate, action) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      rejectWait = undefined
      reject(new Error(`Timed out waiting for ${binary}`))
    }, 15000)
    rejectWait = reject
    handler = (error, events) => {
      if (error) {
        clearTimeout(timeout)
        rejectWait = undefined
        reject(error)
        return
      }
      if (events.some(predicate)) {
        clearTimeout(timeout)
        rejectWait = undefined
        resolve()
      }
    }
    void action().catch(error => {
      clearTimeout(timeout)
      rejectWait = undefined
      reject(error)
    })
  })
}

try {
  await binding.subscribe(watchRoot, callback, {})
  await waitFor(event => event.path === created && event.type === 'create' && event.kind === 'file', () => writeFile(created, 'watcher smoke test'))
  await waitFor(event => event.path === created && event.type === 'update' && event.kind === 'file', () => appendFile(created, '\nupdated'))
  const renameEvents = []
  await waitFor(event => {
    if (event.kind === 'file' && (event.path === created || event.path === renamed)) renameEvents.push(event)
    const deleted = renameEvents.find(item => item.path === created && item.type === 'delete' && typeof item.renameId === 'string')
    return deleted != null && renameEvents.some(item => item.path === renamed && item.type === 'create' && item.renameId === deleted.renameId)
  }, () => rename(created, renamed))
  await waitFor(event => event.path === renamed && event.type === 'delete' && event.kind === 'file', () => unlink(renamed))
  console.log(`Verified ${binary}`)
} finally {
  await binding.unsubscribe(watchRoot, callback, {})
  if (rejectWait) rejectWait(new Error('Watcher smoke test stopped'))
  await rm(root, { recursive: true, force: true })
}

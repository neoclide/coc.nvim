'use strict'
import {run} from 'node:test'
import * as cp from 'node:child_process'
import crypto from 'node:crypto'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {projectRoot} from './paths.mjs'
import {initializeTestHooks} from './bundle-hooks.mjs'

process.once('message', message => {
  if (message?.type !== 'run') return
  void main(message.options).catch(error => {
    process.exitCode = 1
    process.send?.({type: 'error', error: serializeError(error)}, () => process.disconnect?.())
  })
})

async function main(options) {
  const {file, editor, testNamePattern, shardTimeoutMs, testTimeout} = options
  const records = await requestCompiledRecords([file])
  initializeTestHooks(records, editor, testNamePattern)
  const abort = new AbortController()
  const timeoutTimer = setTimeout(() => abort.abort(), shardTimeoutMs)
  timeoutTimer.unref?.()
  const stats = {passed: 0, failed: 0, skipped: 0, todo: 0, failures: [], diagnostics: []}
  const leafStats = {[file]: {passed: 0, failed: 0}}
  const captured = []
  let suiteFailures = 0
  let durationMs = 0
  const session = createEditorSession()
  process.send?.({type: 'progress', file, state: {status: 'running', durationMs: 0}})
  try {
    await session.start(editor)
    globalThis.editorReset = session.reset
    globalThis.editorStop = session.stop
    const stream = run({
      isolation: 'none',
      concurrency: false,
      cwd: projectRoot,
      files: [file],
      timeout: testTimeout,
      testNamePatterns: testNamePattern ? [new RegExp(testNamePattern)] : undefined,
      signal: abort.signal,
    })
    for await (const event of stream) {
      const data = event.data
      const isLeaf = data.details?.type === 'test'
      switch (event.type) {
        case 'test:pass':
          if (isLeaf) {
            stats.passed++
            leafStats[file].passed++
            durationMs += data.details?.duration_ms ?? 0
          }
          break
        case 'test:fail':
          if (isLeaf) {
            const serialized = serializeData(data)
            stats.failed++
            leafStats[file].failed++
            durationMs += data.details?.duration_ms ?? 0
            stats.failures.push(serialized)
            process.send?.({type: 'failure', data: serialized})
          } else {
            suiteFailures++
          }
          break
        case 'test:skip':
          stats.skipped++
          break
        case 'test:todo':
          stats.todo++
          break
        case 'test:diagnostic':
          if (!/^(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(data.message)) {
            stats.diagnostics.push(data.message)
          }
          break
        case 'test:stderr':
        case 'test:stdout':
          if (typeof data.message === 'string') {
            captured.push(data.message)
            process.send?.({
              type: 'output',
              stream: event.type === 'test:stderr' ? 'stderr' : 'stdout',
              message: data.message,
            })
          }
          break
      }
    }
  } finally {
    clearTimeout(timeoutTimer)
    delete globalThis.editorReset
    delete globalThis.editorStop
    await session.stop()
  }
  if (stats.failed === 0 && suiteFailures > 0) {
    stats.failed = suiteFailures
    stats.failures.push({
      name: 'suite failure',
      file,
      details: {error: {message: captured.join('').trim() || 'a test suite failed to load or threw before any test ran'}},
    })
  }
  const roundedDuration = Math.round(durationMs)
  process.send?.({
    type: 'progress',
    file,
    state: {status: stats.failed > 0 ? 'failed' : 'passed', durationMs: roundedDuration},
  })
  process.send?.({
    type: 'result',
    result: {
      stats,
      timings: {[file]: roundedDuration},
      leafStats,
      timedOut: abort.signal.aborted,
    },
  }, () => process.disconnect?.())
}

function requestCompiledRecords(files) {
  return new Promise(resolve => {
    const onMessage = message => {
      if (message.type !== 'compiled') return
      process.off('message', onMessage)
      resolve(message.records)
    }
    process.on('message', onMessage)
    process.send?.({type: 'request-compiled', files})
  })
}

function createEditorSession() {
  const bundle = globalThis.__cocBundle
  const attach = bundle['src/attach'].default
  const {terminate} = bundle['src/util/processes']
  const vimrc = path.join(projectRoot, 'src', '__tests__', 'vimrc')
  const nvimCwd = path.join(projectRoot, 'src', '__tests__')
  let proc
  let server
  let plugin
  let stopped = false

  async function start(kind) {
    if (plugin) return
    if (kind === 'vim') await startVim()
    else await startNvim()
    await plugin.init('')
  }

  async function startNvim() {
    proc = cp.spawn(process.env.NVIM_COMMAND ?? 'nvim', ['-u', vimrc, '-i', 'NONE', '--embed'], {cwd: nvimCwd})
    proc.unref()
    plugin = attach({proc})
    const {nvim} = plugin
    await nvim.uiAttach(160, 80, {})
    nvim.call('coc#rpc#set_channel', [1], true)
    nvim.on('vim_error', error => {
      if (typeof error === 'string' && error.startsWith('Lua')) console.error('Error from vim: ', error)
    })
  }

  async function startVim() {
    if (process.env.VIM_NODE_RPC !== '1') throw new Error('VIM_NODE_RPC should be 1')
    const connected = new Promise(resolve => {
      server = net.createServer(socket => {
        plugin = attach({reader: socket, writer: socket})
        plugin.nvim.on('vim_error', error => console.error('Error from vim: ', error))
        resolve()
      })
    })
    const address = await listenOnVim(server)
    proc = cp.spawn(process.env.VIM_COMMAND ?? 'vim', ['--clean', '--not-a-term', '-u', vimrc], {
      stdio: 'pipe',
      cwd: nvimCwd,
      env: {COC_NVIM_REMOTE_ADDRESS: address, ...process.env},
    })
    proc.on('error', error => console.error(error))
    proc.on('exit', code => {
      if (code) console.error('vim exit with code ' + code)
    })
    await connected
  }

  async function reset(t) {
    const {completion, workspace, nvim} = plugin
    t?.mock?.reset()
    completion.cancelAndClose()
    workspace.reset()
    await nvim.input('<esc>')
    nvim.pauseNotification()
    nvim.command('stopinsert', true)
    nvim.call('coc#float#close_all', [], true)
    nvim.command('silent! %bwipeout! | setl nopreviewwindow', true)
    await nvim.resumeNotification()
    await workspace.document
  }

  async function stop() {
    if (stopped) return
    stopped = true
    server?.close()
    server = undefined
    if (proc) terminate(proc)
    proc = undefined
    plugin = undefined
  }

  return {start, reset, stop}
}

async function listenOnVim(server) {
  if (process.platform !== 'win32') {
    try {
      const socket = path.join(os.tmpdir(), `coc-test-${crypto.randomUUID()}.sock`)
      return await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(socket, () => {
          server.removeListener('error', reject)
          server.unref()
          resolve(socket)
        })
      })
    } catch {
      // Fall through to TCP when Unix sockets are unavailable.
    }
  }
  return await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      server.unref()
      resolve(`127.0.0.1:${server.address().port}`)
    })
  })
}

function serializeData(data) {
  return {
    name: data.name,
    file: data.file,
    details: data.details ? {...data.details, error: serializeError(data.details.error)} : undefined,
  }
}

function serializeError(error) {
  if (!error) return undefined
  return {
    message: error.message,
    stack: error.stack,
    cause: serializeError(error.cause),
  }
}

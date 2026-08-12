'use strict'

// Test runtime infrastructure for the editor lanes, served on demand by
// bundle-hooks.mjs as `coc-test/edit_session`. Every non-unit test file runs
// in its own child process, so module state is the session state for that
// file. Unit tests never load this module.

import * as cp from 'node:child_process'
import crypto from 'node:crypto'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

// Editor runtime bundle: full-path keyed and lazy, bound by bundle-hooks.mjs
// so module instances (workspace, events, ...) are the same ones the tests
// import from the bundle.
const bundle = globalThis.__cocBundle
const attach = bundle['src/attach'].default
const {terminate} = bundle['src/util/processes']

// The vimrc computes its root from `<sfile>` (`:h:h:h`), so a copy inside
// the build tree would resolve to the build dir instead of the repo root.
// Always use the source-tree vimrc; the project root is passed explicitly
// (the temp build tree is no longer three levels under the repository).
const projectRoot = process.env.COC_TEST_ROOT || process.cwd()
const vimrc = path.join(projectRoot, 'src', '__tests__', 'vimrc')

// Where nvim starts and where relative `:edit` paths land. There is no build
// tree anymore (everything compiles in memory), so tests run from the source
// test directory; fixtures (test.zip, sample/, ...) live there too.
const nvimCwd = path.join(projectRoot, 'src', '__tests__')

let proc
let server
let plugin

async function startNvim() {
  proc = cp.spawn(process.env.NVIM_COMMAND ?? 'nvim', ['-u', vimrc, '-i', 'NONE', '--embed'], {
    cwd: nvimCwd
  })
  proc.unref()
  plugin = attach({proc})
  const {nvim} = plugin
  await nvim.uiAttach(160, 80, {})
  nvim.call('coc#rpc#set_channel', [1], true)
  nvim.on('vim_error', err => {
    if (typeof err === 'string' && err.startsWith('Lua')) {
      console.error('Error from vim: ', err)
    }
  })
}

async function startVim() {
  if (process.env.VIM_NODE_RPC != '1') {
    throw new Error('VIM_NODE_RPC should be 1')
  }
  let promise = new Promise(resolve => {
    server = net.createServer(socket => {
      plugin = attach({reader: socket, writer: socket})
      plugin.nvim.on('vim_error', err => {
        console.error('Error from vim: ', err)
      })
      resolve()
    })
  })
  let address = await listenOnVim(server)
  proc = cp.spawn(process.env.VIM_COMMAND ?? 'vim', ['--clean', '--not-a-term', '-u', vimrc], {
    stdio: 'pipe',
    cwd: nvimCwd,
    env: {
      COC_NVIM_REMOTE_ADDRESS: address,
      ...process.env
    }
  })
  proc.on('error', err => {
    console.error(err)
  })
  proc.on('exit', code => {
    if (code) console.error('vim exit with code ' + code)
  })
  await promise
}

async function listenOnVim(server) {
  const isWindows = process.platform === 'win32'
  if (!isWindows) {
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
    } catch (e) {
      // fall through to TCP
    }
  }
  return await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      let port = server.address().port
      server.unref()
      resolve(`127.0.0.1:${port}`)
    })
  })
}

/** Starts the one editor runtime owned by this test-file process. */
export async function start(kind = 'nvim') {
  if (plugin) return
  if (kind === 'vim') {
    await startVim()
  } else {
    await startNvim()
  }
  await plugin.init('')
}

/**
 * Resets editor and coc state after one test case.
 * Pass directly to node:test `afterEach` so case mocks are restored before
 * reset accesses nvim/workspace methods.
 */
export async function reset(t) {
  const {completion, workspace, nvim} = plugin
  t?.mock?.reset()
  // A test aborted while waiting on a dialog prompt leaves
  // coc#dialog#prompt_confirm blocked in getchar(); its RPC promise and the
  // Dialogs mutex never settle until a key is fed. Dismiss it so later tests
  // can use dialogs again.
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

/** Stops the editor runtime without a graceful RPC shutdown. */
export async function stop() {
  if (server) server.close()
  if (proc) terminate(proc)
  if (plugin) {
    // Deliberately do NOT call plugin.dispose(): it tears down bundle
    // singletons and leaves language client IPC sockets half-closed, which
    // hangs the child process. Stop registered services explicitly after
    // ending the editor so their sockets/forks cannot keep the test child
    // alive.
    // const services = bundle['src/services'].default
    // try {
    //   await services.stopAll()
    // } catch (e) {
    //   console.error('edit_session stopAll error', e)
    // }
  }
}

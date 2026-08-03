// Merged from rpc.test.ts, lua_api.test.ts and progressPart.test.ts to share
// a single nvim session and reduce per-file startup overhead.
import { Neovim } from '../../neovim'
import { Emitter, Event, NotificationHandler, WorkDoneProgressBegin, WorkDoneProgressEnd, WorkDoneProgressReport } from 'vscode-languageserver-protocol'
import { ProgressContext, ProgressPart } from '../../language-client/progressPart'
import helper from '../helper'

type ProgressType = WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd

let nvim: Neovim

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

describe('rpc client', () => {
  it('should report live channel as running', async () => {
    // The E475 handling checks is_running before resetting the client, a
    // live channel must never be reported as dead.
    expect(await nvim.call('coc#client#is_running', ['coc'])).toBe(1)
  })

  it('should reset client when channel is gone on E475', async () => {
    // rpcnotify on a nonexistent channel raises E475, which must still be
    // treated as connection loss for a dead channel.
    await nvim.command(`
      let g:fake = coc#client#create('fake', [])
      let g:fake['running'] = 1
      let g:fake['chan_id'] = 99999
      call g:fake['notify']('testMethod', [])
    `)
    expect(await nvim.call('eval', ["coc#client#get_client('fake')['running']"])).toBe(0)
  })
})

describe('lua api wrapper', () => {
  beforeAll(async () => {
    // Simulate what client.vim's s:start() does: expose channel id for Lua RPC
    await nvim.command('let g:coc_channel_id = 1')
  })

  it('should load require("coc") without error', async () => {
    const ok = await nvim.request('nvim_exec_lua', [`local r, e = pcall(require, 'coc'); return r`, []])
    expect(ok).toBe(true)
  })

  it('get_diagnostics should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.get_diagnostics) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('get_config should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.get_config) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('workspace_symbols should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.workspace_symbols) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('document_symbols should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.document_symbols) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('execute_command should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.execute_command) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('command_list should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.command_list) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('extension_stats should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.extension_stats) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('get_diagnostics should return table when called', async () => {
    const result = await nvim.request('nvim_exec_lua', [
      `return require('coc').get_diagnostics()`, []
    ])
    // should return a table (nil or list) without throwing
    expect(result == null || Array.isArray(result)).toBe(true)
  })

  it('get_config should return config', async () => {
    const result = await nvim.request('nvim_exec_lua', [
      `return require('coc').get_config('suggest')`, []
    ])
    // should return a table without throwing
    expect(result == null || typeof result === 'object').toBe(true)
  })
})

describe('ProgressPart', () => {
  afterEach(async () => {
    await helper.reset()
  })

  function createClient(): ProgressContext & { fire: (ev: ProgressType) => void, token: string | undefined } {
    let _onDidProgress = new Emitter<ProgressType>()
    let onDidProgress: Event<ProgressType> = _onDidProgress.event
    let notificationToken: string | undefined
    return {
      id: 'test',
      get token() {
        return notificationToken
      },
      fire(ev) {
        _onDidProgress.fire(ev)
      },
      onProgress<ProgressType>(_, __, handler: NotificationHandler<ProgressType>) {
        return onDidProgress(ev => {
          void handler(ev as any)
        })
      },
      sendNotification(_, params) {
        notificationToken = (params as any).token
      }
    }
  }

  it('should not start if cancelled', async () => {
    let client = createClient()
    let p = new ProgressPart(client, '0c7faec8-e36c-4cde-9815-95635c37d696')
    p.report({ kind: 'report', message: 'msg' })
    p.cancel()
    expect(p.begin({ kind: 'begin', title: 'canceleld' })).toBe(false)
  })

  it('should report progress', async () => {
    let client = createClient()
    let p = new ProgressPart(client, '0c7faec8-e36c-4cde-9815-95635c37d696')
    p.begin({ kind: 'begin', title: 'p', percentage: 1, cancellable: true })
    await helper.waitValue(async () => (await nvim.call('coc#notify#win_list') as number[]).length, 1)
    p.report({ kind: 'report', message: 'msg', percentage: 10 })
    await helper.wait(20)
    p.report({ kind: 'report', message: 'msg', percentage: 50 })
    await helper.wait(20)
    p.done('finished')
  })

  it('should close notification on cancel', async () => {
    helper.updateConfiguration('notification.statusLineProgress', false)
    let client = createClient()
    let p = new ProgressPart(client, '0c7faec8-e36c-4cde-9815-95635c37d696')
    let started = p.begin({ kind: 'begin', title: 'canceleld' })
    expect(started).toBe(true)
    p.cancel()
    p.cancel()
    await helper.waitValue(async () => (await nvim.call('coc#notify#win_list') as number[]).length, 1)
    let winids = await nvim.call('coc#notify#win_list') as number[]
    expect(winids.length).toBe(1)
    let win = nvim.createWindow(winids[0])
    let closing = await win.getVar('closing')
    expect(closing).toBe(1)
  })

  it('should send notification on cancel', async () => {
    helper.updateConfiguration('notification.statusLineProgress', false)
    let client = createClient()
    let token = '0c7faec8-e36c-4cde-9815-95635c37d696'
    let p = new ProgressPart(client, token)
    let started = p.begin({ kind: 'begin', title: 'canceleld', cancellable: true })
    expect(started).toBe(true)
    await helper.waitValue(async () => (await nvim.call('coc#notify#win_list') as number[]).length, 1)
    nvim.call('coc#float#close_all', [], true)
    await helper.waitValue(() => {
      return client.token
    }, token)
  })
})

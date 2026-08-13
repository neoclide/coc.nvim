import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { Disposable } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import { LanguageClient, RevealOutputChannelOn, ServerOptions, State, TransportKind } from '../../language-client'
import services, { convertState, documentSelectorToLanguageIds, getDocumentSelector, getForkOptions, getLanguageServerOptions, getRevealOutputChannelOn, getSpawnOptions, getStateName, getTransportKind, isValidServerConfig, LanguageServerConfig, ServiceStat, stateString } from '../../services'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import events from '../../events'
import window from '../../window'

let nvim: Neovim
let disposables: Disposable[] = []
const serverModule = path.join(import.meta.dirname, 'server.js')
before(async () => {
  nvim = workspace.nvim
})

afterEach(async () => {
  disposeAll(disposables)
})

function toConfig(c: Partial<LanguageServerConfig>): LanguageServerConfig {
  if (!c.filetypes) {
    c.filetypes = ['vim']
  }
  return c as LanguageServerConfig
}

describe('services', () => {
  describe('functions', () => {
    it('should convertState', async t => {
      assert.strictEqual(convertState(null as any), undefined)
    })

    it('should check valid server config', async t => {
      assert.strictEqual(isValidServerConfig('name', {} as any), false)
      assert.strictEqual(isValidServerConfig('name', { module: [] } as any), false)
      assert.strictEqual(isValidServerConfig('name', { command: [] } as any), false)
      assert.strictEqual(isValidServerConfig('name', { transport: '' } as any), false)
      assert.strictEqual(isValidServerConfig('name', { transportPort: 'ab' } as any), false)
      assert.strictEqual(isValidServerConfig('name', { filetypes: '' } as any), false)
      assert.strictEqual(isValidServerConfig('name', { additionalSchemes: '' } as any), false)
      assert.strictEqual(isValidServerConfig('name', { additionalSchemes: [1] } as any), false)
      assert.strictEqual(isValidServerConfig('name', { module: 'module', filetypes: ['vim'] } as any), true)
    })

    it('should get state name', async t => {
      assert.strictEqual(getStateName(ServiceStat.Initial), 'init')
      assert.strictEqual(getStateName(ServiceStat.Running), 'running')
      assert.strictEqual(getStateName(ServiceStat.Starting), 'starting')
      assert.strictEqual(getStateName(ServiceStat.StartFailed), 'startFailed')
      assert.strictEqual(getStateName(ServiceStat.Stopping), 'stopping')
      assert.strictEqual(getStateName(ServiceStat.Stopped), 'stopped')
      assert.strictEqual(getStateName(null as any), 'unknown')
    })

    it('should use languageserver config from workspace folder', async t => {
      let folder = path.join(os.tmpdir(), crypto.randomUUID())
      fs.mkdirSync(path.join(folder, '.vim'), { recursive: true })
      let configFile = path.join(folder, '.vim/coc-settings.json')
      fs.writeFileSync(configFile, '{"languageserver": {"foo": {"command":"bar", "filetypes": ["vim"]}, "bar": {}}}')
      let uri = URI.file(path.join(folder, 't')).toString()
      let added = workspace.configurations.locateFolderConfigution(uri)
      assert.strictEqual(added, true)
      let w = workspace.workspaceFolderControl
      w.addWorkspaceFolder(folder, true)
      let s = services.getService('foo')
      t.mock.method(window as any, 'showErrorMessage', () => {
        return Promise.resolve()
      })
      assert.notStrictEqual(s, undefined)
      await s.restart()
      w.removeWorkspaceFolder(folder)
    })

    it('should get stateString', async t => {
      assert.strictEqual(stateString(State.Stopped), 'stopped')
      assert.strictEqual(stateString(State.Running), 'running')
      assert.strictEqual(stateString(State.Starting), 'starting')
      assert.strictEqual(stateString(null as any), 'unknown')
    })

    it('should getSpawnOptions', async t => {
      assert.notStrictEqual(getSpawnOptions(toConfig({ cwd: process.cwd() })), undefined)
      assert.notStrictEqual(getSpawnOptions(toConfig({ cwd: process.cwd(), detached: true, shell: true, env: {} })), undefined)
    })

    it('should getForkOptions', async t => {
      assert.notStrictEqual(getForkOptions(toConfig({ cwd: process.cwd() })), undefined)
      assert.notStrictEqual(getForkOptions(toConfig({ cwd: process.cwd(), execArgv: [], env: {} })), undefined)
    })

    it('should getTransportKind', async t => {
      assert.strictEqual(getTransportKind(toConfig({})), TransportKind.ipc)
      assert.strictEqual(getTransportKind(toConfig({ transport: 'ipc' })), TransportKind.ipc)
      assert.strictEqual(getTransportKind(toConfig({ transport: 'stdio' })), TransportKind.stdio)
      assert.strictEqual(getTransportKind(toConfig({ transport: 'pipe' })), TransportKind.pipe)
      assert.deepStrictEqual(getTransportKind(toConfig({ transport: 'socket', transportPort: 3300 })), { kind: TransportKind.socket, port: 3300 })
    })

    it('should getDocumentSelector', async t => {
      assert.deepStrictEqual(getDocumentSelector(undefined, []), [{ scheme: 'file' }, { scheme: 'untitled' }])
      assert.strictEqual(getDocumentSelector(['vim'], []).length, 2)
    })

    it('should getRevealOutputChannelOn', async t => {
      assert.strictEqual(getRevealOutputChannelOn('error'), RevealOutputChannelOn.Error)
      assert.strictEqual(getRevealOutputChannelOn('info'), RevealOutputChannelOn.Info)
      assert.strictEqual(getRevealOutputChannelOn('warn'), RevealOutputChannelOn.Warn)
      assert.strictEqual(getRevealOutputChannelOn('never'), RevealOutputChannelOn.Never)
      assert.strictEqual(getRevealOutputChannelOn(''), RevealOutputChannelOn.Never)
    })

    it('should getLanguageServerOptions', async t => {
      assert.strictEqual(getLanguageServerOptions('x', 'y', {} as any), null)
      assert.strictEqual(getLanguageServerOptions('x', 'y', { filetypes: ['vim'] }), null)
      assert.strictEqual(getLanguageServerOptions('x', 'y', toConfig({ module: 'not_exists' })), null)
      assert.notStrictEqual(getLanguageServerOptions('x', 'y', toConfig({ module: import.meta.filename, maxRestartCount: 1 })), undefined)
      assert.notStrictEqual(getLanguageServerOptions('x', 'y', toConfig({ module: import.meta.filename, runtime: process.execPath })), undefined)
      assert.notStrictEqual(getLanguageServerOptions('x', 'y', toConfig({ command: 'cmd', args: [], disableWorkspaceFolders: true, disableSnippetCompletion: true } as any)), undefined)
      assert.notStrictEqual(getLanguageServerOptions('x', 'y', toConfig({ command: 'cmd', ignoredRootPaths: ['/foo'], initializationOptions: {} })), undefined)
    })

    it('should expand variables in args', async t => {
      let basename = path.basename(workspace.root)
      let opts = getLanguageServerOptions('x', 'y', toConfig({
        command: 'cmd',
        args: ['-data', '${workspaceFolderBasename}/.cache', '${env:NODE_ENV}']
      }))
      assert.notStrictEqual(opts, undefined)
      let serverOptions = opts[1] as { args: string[] }
      assert.deepStrictEqual(serverOptions.args, ['-data', `${basename}/.cache`, 'test'])
    })

    it('should use socket port for language server #1', async t => {
      let opts = getLanguageServerOptions('x', 'y', toConfig({ port: 3300, host: '127.0.0.1' }))
      let fn = opts[1] as Function
      await assert.rejects(fn(), Error)
    })

    it('should use socket port for language server #2', async t => {
      let connected = false
      let s
      let server = net.createServer(socket => {
        connected = true
        s = socket
      })
      server.listen(12580, '127.0.0.1')
      let opts = getLanguageServerOptions('x', 'y', toConfig({ port: 12580 }))
      let fn = opts[1] as Function
      let res = await fn()
      await shared.waitValue(() => connected, true)
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(connected, true)
      s.destroy()
      server.close()
    })

    it('should documentSelectorToLanguageIds', async t => {
      assert.deepStrictEqual(documentSelectorToLanguageIds(['vim']), ['vim'])
    })
  })

  describe('getServiceStats()', () => {
    it('should get services', async t => {
      let res = await shared.doAction('services')
      assert.notStrictEqual(res, undefined)
    })
  })

  describe('toggle()', () => {
    it('should throw when service not found', async t => {
      let fn = async () => {
        await shared.doAction('toggleService', 'id')
      }
      await assert.rejects(fn(), Error)
    })

    it('should toggle language client state', async t => {
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {
        documentSelector: [{ language: 'vim', scheme: 'file' }]
      })
      let d = services.registerLanguageClient(client)
      disposables.push(d)
      let p = services.toggle('test')
      void services.toggle('test')
      await p
      let s = services.getService('test')
      assert.strictEqual(s.state, ServiceStat.Running)
      d.dispose()
    })
  })

  describe('start()', () => {
    it('should delay start when not plugin not ready', async t => {
      Object.assign(events, { _ready: false })
      let called = false
      services.tryStartService({
        id: 'test',
        start: () => {
          called = true
        }
      } as any)
      let started = false
      services.tryStartService({
        id: 'test',
        state: ServiceStat.Initial,
        selector: [{ language: '*' }],
        start: () => {
          started = true
        }
      } as any)

      await events.fire('ready', [])
      assert.strictEqual(called, false)
      assert.strictEqual(started, true)
    })

    it('does not start a service disposed before plugin ready', async t => {
      Object.assign(events, { _ready: false })
      await shared.edit('t.vim')
      let starts = 0
      let d = services.register({
        id: 'disposed-before-ready',
        state: ServiceStat.Initial,
        selector: [{ language: 'vim', scheme: 'file' }],
        onServiceReady: () => Disposable.create(() => {}),
        dispose: () => {},
        start: () => {
          starts++
        }
      } as any)
      let before = ((events as any).handlers.get('ready') ?? []).length
      d.dispose()
      let after = ((events as any).handlers.get('ready') ?? []).length
      assert.strictEqual(after, before - 1)
      await events.fire('ready', [])
      assert.strictEqual(starts, 0)
      await nvim.command('bd!')
    })

    it('should start language client on by document', async t => {
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {
        documentSelector: [{ language: 'vim', scheme: 'file' }]
      })
      disposables.push(services.registerLanguageClient(client))
      let document = TextDocument.create('file:///1', 'vim', 1, '')
      await services.start(document)
      await services.start(TextDocument.create('file:///2', 'java', 1, ''))
      let s = services.getService('test')
      assert.strictEqual(s.state, ServiceStat.Running)
      let code = `call coc#on_notify('test', 'notification', { -> execute('let g:called = 1')})`
      await nvim.exec(code)
      await shared.doAction('registerNotification', 'test', 'notification')
      await client.sendNotification('triggerNotification')
      await shared.waitValue(() => {
        return nvim.getVar('called')
      }, 1)
    })
  })

  describe('stop()', () => {
    it('should not throw when service not found', async t => {
      await services.stop('id')
    })
  })

  describe('shouldStart()', () => {
    it('should start when document matches', async t => {
      await shared.edit('t.vim')
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {
        documentSelector: [{ language: 'vim', scheme: 'file' }]
      })
      disposables.push(services.registerLanguageClient(client))
      services.register({ id: 'test' } as any)
      await shared.waitValue(() => {
        return client.state
      }, State.Running)
      await nvim.command('bd!')
    })

    it('should not start when client already started', async t => {
      await shared.edit('t.vim')
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {
        documentSelector: [{ language: 'vim', scheme: 'file' }]
      })
      await client.start()
      disposables.push(services.registerLanguageClient(client))
      await nvim.command('bd!')
    })
  })

  describe('registerLanguageClient', () => {

    it('should not create client when not enabled', async t => {
      workspace.configurations.updateMemoryConfig({
        languageserver: {
          test: {
            filetypes: ['vim'],
            enabled: false
          }
        }
      })
      disposables.push(services.registerLanguageClient('test', { filetypes: ['vim'], enable: true }))
      let client = services.getService('test')
      assert.notStrictEqual(client, undefined)
      await client.start()
      assert.strictEqual(client.state, ServiceStat.Initial)
    })

    it('should not start for bad config', async t => {
      workspace.configurations.updateMemoryConfig({
        languageserver: {
          test: {
            filetypes: ['vim']
          }
        }
      })
      disposables.push(services.registerLanguageClient('test', { filetypes: ['vim'], enable: true }))
      let client = services.getService('test')
      assert.notStrictEqual(client, undefined)
      await client.start()
      assert.strictEqual(client.state, ServiceStat.Initial)
    })

    it('should start and stop language client', async t => {
      let config = { filetypes: ['vim'], module: serverModule, enabled: false }
      workspace.configurations.updateMemoryConfig({
        languageserver: { test: config }
      })
      disposables.push(services.registerLanguageClient('test', config))
      disposables.push(services.registerLanguageClient('test', config))
      let client = services.getService('test')
      let p = client.start()
      void client.start()
      await p
      await client.start()
      await client.restart()
      let pro = client.stop()
      void client.stop()
      await pro
      assert.strictEqual(client.state, ServiceStat.Stopped)
    })

    it('should start language client by restart', async t => {
      let config = { filetypes: ['vim'], module: serverModule, enabled: false }
      workspace.configurations.updateMemoryConfig({
        languageserver: { test: config }
      })
      disposables.push(services.registerLanguageClient('test', config))
      let client = services.getService('test')
      await client.restart()
      assert.strictEqual(client.state, ServiceStat.Running)
    })

    it('should not throw on start error', async t => {
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {})
      t.mock.method(client, 'start', () => {
        throw new Error('custom error')
      })
      disposables.push(services.registerLanguageClient(client))
      let service = services.getService('test')
      await service.start()
      let line = await shared.getCmdline()
      assert.match(line, new RegExp('failed to start'))
    })

    it('should not leave service Starting on restart error', async t => {
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {})
      t.mock.method(client, 'restart', () => {
        throw new Error('custom error')
      })
      disposables.push(services.registerLanguageClient(client))
      let service = services.getService('test')
      await service.restart()
      assert.strictEqual(service.state, ServiceStat.StartFailed)
    })

    it('should sendRequest & sendNotification', async t => {
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {})
      disposables.push(services.registerLanguageClient(client))
      let service = services.getService('test')
      await service.start()
      let res = await getCurrentPlugin().cocAction('sendRequest', 'test', 'request', { value: 2 })
      assert.strictEqual(res, 3)
      await getCurrentPlugin().cocAction('sendNotification', 'test', 'notification', {})
      let result = await service.client.sendRequest('notified')
      assert.deepStrictEqual(result, { notified: true })
    })

    it('should throw when service not found', async t => {
      let fn = async () => {
        await services.sendNotification('id', 'method')
      }
      await assert.rejects(fn(), Error)
    })

    it('should register notification when client created', async t => {
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {})
      services.registerLanguageClient(client)
      let service = services.getService('test')
      await getCurrentPlugin().cocAction('registerNotification', 'test', 'notification')
      await service.start()
      await service.client.sendNotification('triggerNotification')
      await shared.wait(20)
      await services.stop('test')
    })

    it('should register notification when client not created', async t => {
      await getCurrentPlugin().cocAction('registerNotification', 'def', 'notification')
      workspace.configurations.updateMemoryConfig({
        languageserver: {
          def: {
            filetypes: ['vim'],
            module: serverModule,
          }
        }
      })
      services.registerLanguageClient('def', { filetypes: ['.vim'], module: serverModule }, URI.file(import.meta.dirname))
      let res
      t.mock.method(services, 'sendNotificationVim' as any, (id, method, result) => {
        res = { id, method, result }
      })
      let service = services.getService('def')
      await service.start()
      await service.client.sendNotification('triggerNotification')
      await shared.waitValue(() => {
        return res != undefined
      }, true)
      await services.stop('def')
      assert.deepStrictEqual(res, { id: 'def', method: 'notification', result: { x: 1 } })
    })
  })

  describe('stopAll()', () => {
    it('should stop all registered services', async t => {
      let stopped: string[] = []
      let d1 = services.register({
        id: 'test-stop-all-1',
        name: 'test-stop-all-1',
        state: ServiceStat.Running,
        selector: [],
        onServiceReady: t.mock.fn(),
        start: t.mock.fn(),
        dispose: t.mock.fn(),
        stop: async () => {
          stopped.push('1')
        },
        restart: t.mock.fn()
      } as any)
      let d2 = services.register({
        id: 'test-stop-all-2',
        name: 'test-stop-all-2',
        state: ServiceStat.Running,
        selector: [],
        onServiceReady: t.mock.fn(),
        start: t.mock.fn(),
        dispose: t.mock.fn(),
        stop: async () => {
          stopped.push('2')
        },
        restart: t.mock.fn()
      } as any)
      try {
        await services.stopAll(500)
        assert.deepStrictEqual(stopped, ['1', '2'])
      } finally {
        d1.dispose()
        d2.dispose()
      }
    })

    it('should resolve on timeout when service stop hangs', async t => {
      let d = services.register({
        id: 'test-stop-all-hang',
        name: 'test-stop-all-hang',
        state: ServiceStat.Running,
        selector: [],
        onServiceReady: t.mock.fn(),
        start: t.mock.fn(),
        dispose: t.mock.fn(),
        stop: () => new Promise(() => {}),
        restart: t.mock.fn()
      } as any)
      try {
        await services.stopAll(100)
      } finally {
        d.dispose()
      }
    })

    it('should stop running language client', async t => {
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test-stop-all', 'Test Language Server', serverOptions, {
        documentSelector: [{ language: 'vim', scheme: 'file' }]
      })
      let d = services.registerLanguageClient(client)
      try {
        let s = services.getService('test-stop-all')
        await s.start()
        assert.strictEqual(s.state, ServiceStat.Running)
        await services.stopAll(1000)
        assert.strictEqual(convertState(client.state), ServiceStat.Stopped)
      } finally {
        d.dispose()
      }
    })
  })
})

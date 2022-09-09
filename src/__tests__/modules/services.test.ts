import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { Disposable } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import { LanguageClient, RevealOutputChannelOn, ServerOptions, State, TransportKind } from '../../language-client'
import services, { converState, documentSelectorToLanguageIds, getDocumentSelector, getForkOptions, getLanguageServerOptions, getRevealOutputChannelOn, getSpawnOptions, getStateName, getTransportKind, isValidServerConfig, LanguageServerConfig, stateString } from '../../services'
import { ServiceStat } from '../../types'
import { disposeAll } from '../../util'
import { Workspace } from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let workspace: Workspace
const serverModule = path.join(__dirname, 'server.js')
beforeAll(async () => {
  await helper.setup()
  workspace = helper.workspace
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
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
    it('should converState', async () => {
      expect(converState(null as any)).toBeUndefined()
    })

    it('should check valid server config', async () => {
      expect(isValidServerConfig('name', {} as any)).toBe(false)
      expect(isValidServerConfig('name', { module: [] } as any)).toBe(false)
      expect(isValidServerConfig('name', { command: [] } as any)).toBe(false)
      expect(isValidServerConfig('name', { transport: '' } as any)).toBe(false)
      expect(isValidServerConfig('name', { transportPort: 'ab' } as any)).toBe(false)
      expect(isValidServerConfig('name', { filetypes: '' } as any)).toBe(false)
      expect(isValidServerConfig('name', { additionalSchemes: '' } as any)).toBe(false)
      expect(isValidServerConfig('name', { additionalSchemes: [1] } as any)).toBe(false)
      expect(isValidServerConfig('name', { module: 'module', filetypes: ['vim'] } as any)).toBe(true)
    })

    it('should get state name', async () => {
      expect(getStateName(ServiceStat.Initial)).toBe('init')
      expect(getStateName(ServiceStat.Running)).toBe('running')
      expect(getStateName(ServiceStat.Starting)).toBe('starting')
      expect(getStateName(ServiceStat.StartFailed)).toBe('startFailed')
      expect(getStateName(ServiceStat.Stopping)).toBe('stopping')
      expect(getStateName(ServiceStat.Stopped)).toBe('stopped')
      expect(getStateName(null as any)).toBe('unknown')
    })

    it('should use languageserver config from workspace folder', async () => {
      let folder = path.join(os.tmpdir(), uuid())
      fs.mkdirSync(path.join(folder, '.vim'), { recursive: true })
      let configFile = path.join(folder, '.vim/coc-settings.json')
      fs.writeFileSync(configFile, '{"languageserver": {"foo": {"command":"bar", "filetypes": ["vim"]}, "bar": {}}}')
      let uri = URI.file(path.join(folder, 't')).toString()
      let added = workspace.configurations.locateFolderConfigution(uri)
      expect(added).toBe(true)
      let w = workspace.workspaceFolderControl
      w.addWorkspaceFolder(folder, true)
      let s = services.getService('foo')
      expect(s).toBeDefined()
      await s.start()
      w.removeWorkspaceFolder(folder)
    })

    it('should get stateString', async () => {
      expect(stateString(State.Stopped)).toBe('stopped')
      expect(stateString(State.Running)).toBe('running')
      expect(stateString(State.Starting)).toBe('starting')
      expect(stateString(null as any)).toBe('unknown')
    })

    it('should getSpawnOptions', async () => {
      expect(getSpawnOptions(toConfig({ cwd: process.cwd() }))).toBeDefined()
      expect(getSpawnOptions(toConfig({ cwd: process.cwd(), detached: true, shell: true, env: {} }))).toBeDefined()
    })

    it('should getForkOptions', async () => {
      expect(getForkOptions(toConfig({ cwd: process.cwd() }))).toBeDefined()
      expect(getForkOptions(toConfig({ cwd: process.cwd(), execArgv: [], env: {} }))).toBeDefined()
    })

    it('should getTransportKind', async () => {
      expect(getTransportKind(toConfig({}))).toBe(TransportKind.ipc)
      expect(getTransportKind(toConfig({ transport: 'ipc' }))).toBe(TransportKind.ipc)
      expect(getTransportKind(toConfig({ transport: 'stdio' }))).toBe(TransportKind.stdio)
      expect(getTransportKind(toConfig({ transport: 'pipe' }))).toBe(TransportKind.pipe)
      expect(getTransportKind(toConfig({ transport: 'socket', transportPort: 3300 }))).toEqual({ kind: TransportKind.socket, port: 3300 })
    })

    it('should getDocumentSelector', async () => {
      expect(getDocumentSelector(undefined, [])).toEqual([{ scheme: 'file' }, { scheme: 'untitled' }])
      expect(getDocumentSelector(['vim'], []).length).toBe(2)
    })

    it('should getRevealOutputChannelOn', async () => {
      expect(getRevealOutputChannelOn('error')).toBe(RevealOutputChannelOn.Error)
      expect(getRevealOutputChannelOn('info')).toBe(RevealOutputChannelOn.Info)
      expect(getRevealOutputChannelOn('warn')).toBe(RevealOutputChannelOn.Warn)
      expect(getRevealOutputChannelOn('never')).toBe(RevealOutputChannelOn.Never)
      expect(getRevealOutputChannelOn('')).toBe(RevealOutputChannelOn.Never)
    })

    it('should getLanguageServerOptions', async () => {
      expect(getLanguageServerOptions('x', 'y', {} as any)).toBe(null)
      expect(getLanguageServerOptions('x', 'y', { filetypes: ['vim'] })).toBe(null)
      expect(getLanguageServerOptions('x', 'y', toConfig({ module: 'not_exists' }))).toBe(null)
      expect(getLanguageServerOptions('x', 'y', toConfig({ module: __filename }))).toBeDefined()
      expect(getLanguageServerOptions('x', 'y', toConfig({ module: __filename, runtime: process.execPath }))).toBeDefined()
      expect(getLanguageServerOptions('x', 'y', toConfig({ command: 'cmd', args: [], disableWorkspaceFolders: true, disableSnippetCompletion: true } as any))).toBeDefined()
      expect(getLanguageServerOptions('x', 'y', toConfig({ command: 'cmd', ignoredRootPaths: ['/foo'], initializationOptions: {} }))).toBeDefined()
    })

    it('should use socket port for language server #1', async () => {
      let opts = getLanguageServerOptions('x', 'y', toConfig({ port: 3300, host: '127.0.0.1' }))
      let fn = opts[1] as Function
      await expect(fn()).rejects.toThrow(Error)
    })

    it('should use socket port for language server #2', async () => {
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
      await helper.wait(30)
      expect(res).toBeDefined()
      expect(connected).toBe(true)
      s.destroy()
      server.close()
    })

    it('should documentSelectorToLanguageIds', async () => {
      expect(documentSelectorToLanguageIds(['vim'])).toEqual(['vim'])
    })
  })

  describe('toggle()', () => {
    it('should throw when service not found ', async () => {
      let fn = async () => {
        await services.toggle('id')
      }
      await expect(fn()).rejects.toThrow(Error)
    })

    it('should toggle language client state', async () => {
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {
        documentSelector: [{ language: 'vim', scheme: 'file' }]
      })
      let d = services.registLanguageClient(client)
      disposables.push(d)
      let p = services.toggle('test')
      void services.toggle('test')
      await p
      let s = services.getService('test')
      expect(s.state).toBe(ServiceStat.Running)
      d.dispose()
    })
  })

  describe('start()', () => {
    it('should start language client on by document', async () => {
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {
        documentSelector: [{ language: 'vim', scheme: 'file' }]
      })
      disposables.push(services.registLanguageClient(client))
      let document = TextDocument.create('file:///1', 'vim', 1, '')
      await services.start(document)
      await services.start(TextDocument.create('file:///2', 'java', 1, ''))
      let s = services.getService('test')
      expect(s.state).toBe(ServiceStat.Running)
    })
  })

  describe('stop()', () => {
    it('should not throw when service not found ', async () => {
      await services.stop('id')
    })
  })

  describe('shouldStart()', () => {
    it('should start when document matches', async () => {
      await helper.edit('t.vim')
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {
        documentSelector: [{ language: 'vim', scheme: 'file' }]
      })
      disposables.push(services.registLanguageClient(client))
      services.regist({ id: 'test' } as any)
      await helper.waitValue(() => {
        return client.state
      }, State.Running)
      await nvim.command('bd!')
    })

    it('should not start when client already started', async () => {
      await helper.edit('t.vim')
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {
        documentSelector: [{ language: 'vim', scheme: 'file' }]
      })
      await client.start()
      disposables.push(services.registLanguageClient(client))
      await nvim.command('bd!')
    })
  })

  describe('registLanguageClient', () => {

    it('should not create client when not enabled', async () => {
      workspace.configurations.updateMemoryConfig({
        languageserver: {
          test: {
            filetypes: ['vim'],
            enabled: false
          }
        }
      })
      disposables.push(services.registLanguageClient('test', { filetypes: ['vim'], enable: true }))
      let client = services.getService('test')
      expect(client).toBeDefined()
      await client.start()
      expect(client.state).toBe(ServiceStat.Initial)
    })

    it('should not start for bad config', async () => {
      workspace.configurations.updateMemoryConfig({
        languageserver: {
          test: {
            filetypes: ['vim']
          }
        }
      })
      disposables.push(services.registLanguageClient('test', { filetypes: ['vim'], enable: true }))
      let client = services.getService('test')
      expect(client).toBeDefined()
      await client.start()
      expect(client.state).toBe(ServiceStat.Initial)
    })

    it('should start and stop language client', async () => {
      let config = { filetypes: ['vim'], module: serverModule, enabled: false }
      workspace.configurations.updateMemoryConfig({
        languageserver: { test: config }
      })
      disposables.push(services.registLanguageClient('test', config))
      disposables.push(services.registLanguageClient('test', config))
      let client = services.getService('test')
      let p = client.start()
      void client.start()
      await p
      await client.start()
      await client.restart()
      let pro = client.stop()
      void client.stop()
      await pro
      expect(client.state).toBe(ServiceStat.Stopped)
    })

    it('should start language client by restart', async () => {
      let config = { filetypes: ['vim'], module: serverModule, enabled: false }
      workspace.configurations.updateMemoryConfig({
        languageserver: { test: config }
      })
      disposables.push(services.registLanguageClient('test', config))
      let client = services.getService('test')
      await client.restart()
      expect(client.state).toBe(ServiceStat.Running)
    })

    it('should not throw on start error', async () => {
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {})
      let spy = jest.spyOn(client, 'start').mockImplementation(() => {
        throw new Error('custom error')
      })
      disposables.push(services.registLanguageClient(client))
      let service = services.getService('test')
      await service.start()
      spy.mockRestore()
      let line = await helper.getCmdline()
      expect(line).toMatch('failed to start')
    })

    it('should sendRequest & sendNotification', async () => {
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {})
      disposables.push(services.registLanguageClient(client))
      let service = services.getService('test')
      await service.start()
      let res = await helper.plugin.cocAction('sendRequest', 'test', 'request', { value: 2 })
      expect(res).toBe(3)
      await helper.plugin.cocAction('sendNotification', 'test', 'notification', {})
      let result = await service.client.sendRequest('notified')
      expect(result).toEqual({ notified: true })
    })

    it('should throw when service not found', async () => {
      let fn = async () => {
        await services.sendNotification('id', 'method')
      }
      await expect(fn()).rejects.toThrow(Error)
    })

    it('should regist notification', async () => {
      const serverOptions: ServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
      }
      const client = new LanguageClient('test', 'Test Language Server', serverOptions, {})
      services.registLanguageClient(client)
      let service = services.getService('test')
      await helper.plugin.cocAction('registNotification', 'test', 'notification')
      await service.start()
      await service.client.sendNotification('triggerNotification')
      await helper.wait(10)
      await services.stop('test')
    })
  })
})

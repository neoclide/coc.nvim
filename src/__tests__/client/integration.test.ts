import * as assert from 'assert'
import cp from 'child_process'
import path from 'path'
import { CancellationToken, CancellationTokenSource, DidCreateFilesNotification, LSPErrorCodes, MessageType, ResponseError, Trace, WorkDoneProgress } from 'vscode-languageserver-protocol'
import { IPCMessageReader, IPCMessageWriter } from 'vscode-languageserver-protocol/node'
import { Diagnostic, MarkupKind, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import * as lsclient from '../../language-client'
import { CloseAction, ErrorAction, HandleDiagnosticsSignature } from '../../language-client'
import { InitializationFailedHandler } from '../../language-client/utils/errorHandler'
import { CancellationError } from '../../util/errors'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

beforeAll(async () => {
  await helper.setup()
})

afterAll(async () => {
  await helper.shutdown()
})

describe('global functions', () => {
  it('should get working directory', async () => {
    let cwd = await lsclient.getServerWorkingDir()
    expect(cwd).toBeDefined()
    cwd = await lsclient.getServerWorkingDir({ cwd: 'not_exists' })
    expect(cwd).toBeUndefined()
  })

  it('should get main root', async () => {
    expect(lsclient.mainGetRootPath()).toBeUndefined()
    let uri = URI.file(__filename)
    await workspace.openResource(uri.toString())
    expect(lsclient.mainGetRootPath()).toBeDefined()
  })

  it('should get runtime path', async () => {
    expect(lsclient.getRuntimePath(__filename, undefined)).toBeDefined()
    let uri = URI.file(__filename)
    await workspace.openResource(uri.toString())
    expect(lsclient.getRuntimePath('package.json', undefined)).toBeDefined()
    let name = path.basename(__filename)
    expect(lsclient.getRuntimePath(name, __dirname)).toBeDefined()
  })

  it('should check debug mode', async () => {
    expect(lsclient.startedInDebugMode(['--debug'])).toBe(true)
    expect(lsclient.startedInDebugMode(undefined)).toBe(false)
  })
})

describe('Client events', () => {
  it('should start server', async () => {
    let clientOptions: lsclient.LanguageClientOptions = {}
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.ipc
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    await client.start()
    await client.stop()
  })

  it('should register events before server start', async () => {
    let clientOptions: lsclient.LanguageClientOptions = {}
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.ipc
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    let fn = jest.fn()
    let disposable = client.onRequest('customRequest', () => {
      fn()
      disposable.dispose()
      return {}
    })
    let dispose = client.onNotification('customNotification', () => {
      fn()
      dispose.dispose()
    })
    let dis = client.onProgress(WorkDoneProgress.type, '4fb247f8-0ede-415d-a80a-6629b6a9eaf8', p => {
      expect(p).toEqual({ kind: 'end', message: 'end message' })
      fn()
      dis.dispose()
    })
    await client.start()
    await client.sendNotification('send')
    await helper.wait(60)
    expect(fn).toBeCalledTimes(3)
    //   let client = await testEventServer({ initEvent: true })
    await client.stop()
  })

  it('should register events after server start', async () => {
    let clientOptions: lsclient.LanguageClientOptions = {
      synchronize: {},
      initializationOptions: { initEvent: true }
    }
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.stdio
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    await client.start()
    let fn = jest.fn()
    let disposable = client.onRequest('customRequest', () => {
      fn()
      disposable.dispose()
      return {}
    })
    let dispose = client.onNotification('customNotification', () => {
      fn()
      dispose.dispose()
    })
    let dis = client.onProgress(WorkDoneProgress.type, '4fb247f8-0ede-415d-a80a-6629b6a9eaf8', p => {
      expect(p).toEqual({ kind: 'end', message: 'end message' })
      fn()
      dis.dispose()
    })
    await client.sendNotification('send')
    await helper.wait(50)
    expect(fn).toBeCalledTimes(3)
    //   let client = await testEventServer({ initEvent: true })
    await client.stop()
  })

  it('should send progress', async () => {
    let clientOptions: lsclient.LanguageClientOptions = {
      synchronize: {},
      initializationOptions: { initEvent: true }
    }
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.stdio
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    let fn = jest.fn()
    client.onNotification('progressResult', res => {
      fn()
      expect(res).toEqual({ kind: 'begin', title: 'begin progress' })
    })
    await client.sendProgress(WorkDoneProgress.type, '4b3a71d0-2b3f-46af-be2c-2827f548579f', { kind: 'begin', title: 'begin progress' })
    await client.start()
    await helper.wait(50)
    let p = client.stop()
    await expect(async () => {
      await client._start()
    }).rejects.toThrow(Error)
    await p
    expect(fn).toBeCalled()
  })

  it('should handle error', async () => {
    let called = false
    let clientOptions: lsclient.LanguageClientOptions = {
      synchronize: {},
      errorHandler: {
        error: () => {
          return ErrorAction.Shutdown
        },
        closed: () => {
          called = true
          return CloseAction.DoNotRestart
        }
      },
      initializationOptions: { initEvent: true }
    }
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.stdio
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    await client.sendRequest('doExit')
    await client.start()
    await helper.waitValue(() => {
      return called
    }, true)
    await client.stop()
  })

  it('should handle message events', async () => {
    let clientOptions: lsclient.LanguageClientOptions = {
      synchronize: {},
    }
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.stdio
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    await client.start()
    await client.sendNotification('logMessage')
    await client.sendNotification('showMessage')
    let types = [MessageType.Error, MessageType.Warning, MessageType.Info, MessageType.Log]
    for (const t of types) {
      await client.sendNotification('requestMessage', { type: t })
      await helper.wait(30)
      if (t == MessageType.Error) {
        await workspace.nvim.input('1')
      } else {
        await workspace.nvim.input('<cr>')
      }
    }
    let uri = URI.file(__filename)
    await client.sendNotification('showDocument', { external: true, uri: 'lsptest:///1' })
    await client.sendNotification('showDocument', { uri: 'lsptest:///1', takeFocus: false })
    await client.sendNotification('showDocument', { uri: uri.toString() })
    await client.sendNotification('showDocument', { uri: uri.toString(), selection: Range.create(0, 0, 1, 0) })
    await helper.wait(300)
    expect(client.hasPendingResponse).toBe(false)
    await client.stop()
  })

  it('should invoke showDocument middleware', async () => {
    let fn = jest.fn()
    let clientOptions: lsclient.LanguageClientOptions = {
      synchronize: {},
      middleware: {
        window: {
          showDocument: async (params, next) => {
            fn()
            let res = await next(params, CancellationToken.None)
            return res as any
          }
        }
      }
    }
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.stdio
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    let uri = URI.file(__filename)
    await client.start()
    await client.sendNotification('showDocument', { uri: uri.toString() })
    await helper.wait(50)
    expect(fn).toBeCalled()
    await client.restart()
    await client.stop()
  })
})

describe('Client integration', () => {
  async function testLanguageServer(serverOptions: lsclient.ServerOptions, clientOpts?: lsclient.LanguageClientOptions): Promise<lsclient.LanguageClient> {
    let clientOptions: lsclient.LanguageClientOptions = {
      documentSelector: ['css'],
      initializationOptions: {}
    }
    if (clientOpts) Object.assign(clientOptions, clientOpts)
    let client = new lsclient.LanguageClient('css', 'Test Language Server', serverOptions, clientOptions)
    await client.start()
    expect(client.initializeResult).toBeDefined()
    expect(client.started).toBe(true)
    return client
  }

  it('should initialize from function', async () => {
    async function testServer(serverOptions: lsclient.ServerOptions) {
      let clientOptions: lsclient.LanguageClientOptions = {}
      let client = new lsclient.LanguageClient('HTML', serverOptions, clientOptions)
      await client.start()
      await client.dispose()
    }
    await testServer(() => {
      let module = path.join(__dirname, './server/eventServer.js')
      let sp = cp.fork(module, ['--node-ipc'], { cwd: process.cwd() })
      return Promise.resolve({ reader: new IPCMessageReader(sp), writer: new IPCMessageWriter(sp) })
    })
    await testServer(() => {
      let module = path.join(__dirname, './server/eventServer.js')
      let sp = cp.fork(module, ['--stdio'], {
        cwd: process.cwd(),
        execArgv: [],
        silent: true,
      })
      return Promise.resolve({ reader: sp.stdout, writer: sp.stdin })
    })
    await testServer(() => {
      let module = path.join(__dirname, './server/eventServer.js')
      let sp = cp.fork(module, ['--stdio'], {
        cwd: process.cwd(),
        execArgv: [],
        silent: true,
      })
      return Promise.resolve({ process: sp, detached: false })
    })
    await testServer(() => {
      let module = path.join(__dirname, './server/eventServer.js')
      let sp = cp.fork(module, ['--stdio'], {
        cwd: process.cwd(),
        execArgv: [],
        silent: true,
      })
      return Promise.resolve(sp)
    })
  })

  it('should initialize use IPC channel', async () => {
    helper.updateConfiguration('css.trace.server.verbosity', 'verbose')
    helper.updateConfiguration('css.trace.server.format', 'json')
    let uri = URI.file(__filename)
    await workspace.loadFile(uri.toString())
    let serverModule = path.join(__dirname, './server/testInitializeResult.js')
    let serverOptions: lsclient.ServerOptions = {
      run: { module: serverModule, transport: lsclient.TransportKind.ipc },
      debug: { module: serverModule, transport: lsclient.TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6014'] } }
    }
    let clientOptions: lsclient.LanguageClientOptions = {
      rootPatterns: ['.vim'],
      requireRootPattern: true,
      documentSelector: ['css'],
      synchronize: {}, initializationOptions: {},
      middleware: {
        handleDiagnostics: (uri, diagnostics, next) => {
          assert.equal(uri, "uri:/test.ts")
          assert.ok(Array.isArray(diagnostics))
          assert.equal(diagnostics.length, 0)
          next(uri, diagnostics)
        }
      }
    }
    let client = new lsclient.LanguageClient('css', 'Test Language Server', serverOptions, clientOptions)
    await client.start()
    let expected = {
      capabilities: {
        textDocumentSync: 1,
        completionProvider: { resolveProvider: true, triggerCharacters: ['"', ':'] },
        hoverProvider: true,
        renameProvider: {
          prepareProvider: true
        }
      },
      customResults: {
        hello: "world"
      }
    }
    assert.deepEqual(client.initializeResult, expected)
    await client.stop()
  })

  it('should initialize use stdio', async () => {
    helper.updateConfiguration('css.trace.server.verbosity', 'verbose')
    helper.updateConfiguration('css.trace.server.format', 'text')
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.stdio
    }
    let client = await testLanguageServer(serverOptions, {
      workspaceFolder: { name: 'test', uri: URI.file(__dirname).toString() },
      outputChannel: window.createOutputChannel('test'),
      markdown: {},
      disabledFeatures: ['pullDiagnostic'],
      revealOutputChannelOn: lsclient.RevealOutputChannelOn.Info,
      outputChannelName: 'custom',
      connectionOptions: {
        cancellationStrategy: {} as any,
        maxRestartCount: 10,
      },
      stdioEncoding: 'utf8',
      errorHandler: {
        error: (): lsclient.ErrorAction => {
          return lsclient.ErrorAction.Continue
        },
        closed: () => {
          return lsclient.CloseAction.DoNotRestart
        }
      },
      progressOnInitialization: true,
      disableMarkdown: true,
      disableDiagnostics: true
    })
    assert.deepStrictEqual(client.supportedMarkupKind, [MarkupKind.PlainText])
    assert.strictEqual(client.name, 'Test Language Server')
    assert.strictEqual(client.diagnostics, undefined)
    client.trace = Trace.Verbose
    let d = client.start()
    let s = new CancellationTokenSource()
    s.cancel()
    client.handleFailedRequest(DidCreateFilesNotification.type, s.token, undefined, '')
    await expect(async () => {
      let error = new ResponseError(LSPErrorCodes.RequestCancelled, 'request cancelled')
      client.handleFailedRequest(DidCreateFilesNotification.type, undefined, error, '')
    }).rejects.toThrow(CancellationError)
    let error = new ResponseError(LSPErrorCodes.ContentModified, 'content changed')
    client.handleFailedRequest(DidCreateFilesNotification.type, undefined, error, '')
    await client.stop()
    client.info('message', new Error('my error'), true)
    client.warn('message', 'error', true)
    client.warn('message', 0, true)
    client.logFailedRequest()
    assert.strictEqual(client.diagnostics, undefined)
    d.dispose()
  })

  it('should initialize use pipe', async () => {
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.pipe
    }
    let client = await testLanguageServer(serverOptions, {
      ignoredRootPaths: [workspace.root]
    })
    expect(client.serviceState).toBeDefined()
    await client.stop()
  })

  it('should initialize use socket', async () => {
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      options: {
        env: {
          NODE_SOCKET_TEST: 1
        }
      },
      transport: {
        kind: lsclient.TransportKind.socket,
        port: 8088
      }
    }
    let client = await testLanguageServer(serverOptions)
    await client.stop()
  })

  it('should initialize as command', async () => {
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      command: 'node',
      args: [serverModule, '--stdio']
    }
    let client = await testLanguageServer(serverOptions)
    await client.stop()
  })

  it('should not throw as command', async () => {
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      command: 'not_exists',
      args: [serverModule, '--stdio']
    }
    let clientOptions: lsclient.LanguageClientOptions = {
      documentSelector: ['css'],
      initializationOptions: {}
    }
    await expect(async () => {
      let client = new lsclient.LanguageClient('css', 'Test Language Server', serverOptions, clientOptions)
      await client.start()
      await client.stop()
    }).rejects.toThrow(Error)
  })

  it('should logMessage', async () => {
    let called = false
    let outputChannel = {
      name: 'empty',
      content: '',
      append: () => {
        called = true
      },
      appendLine: () => {},
      clear: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {}
    }
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      command: 'node',
      args: [serverModule, '--stdio']
    }
    let client = await testLanguageServer(serverOptions, { outputChannel })
    client.logMessage('message')
    client.logMessage(Buffer.from('message', 'utf8'))
    expect(called).toBe(true)
    await client.stop()
  })

  it('should handle error on initialize', async () => {
    async function startServer(handler: InitializationFailedHandler | undefined, key = 'throwError'): Promise<lsclient.LanguageClient> {
      let clientOptions: lsclient.LanguageClientOptions = {
        initializationFailedHandler: handler,
        initializationOptions: {
          [key]: true
        }
      }
      let serverModule = path.join(__dirname, './server/eventServer.js')
      let serverOptions: lsclient.ServerOptions = {
        module: serverModule,
        transport: lsclient.TransportKind.ipc,
      }
      let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
      await client.start()
      return client
    }
    let n = 0
    try {
      let client = await startServer(() => {
        n++
        return n == 1
      })
      await client.stop()
    } catch (e) {
      // ignore
    }
    try {
      let client = await startServer(undefined)
      await client.stop()
    } catch (e) {
      // ignore
    }
    try {
      let client = await startServer(undefined, 'normalThrow')
      await client.stop()
    } catch (e) {
      // ignore
    }
    try {
      let client = await startServer(undefined, 'utf8')
      void client.stop()
      await client.stop()
    } catch (e) {
      // ignore
    }
  })

  it('should separate diagnostics', async () => {
    async function startServer(disable?: boolean, handleDiagnostics?: (uri: string, diagnostics: Diagnostic[], next: HandleDiagnosticsSignature) => void): Promise<lsclient.LanguageClient> {
      let clientOptions: lsclient.LanguageClientOptions = {
        disableDiagnostics: disable,
        separateDiagnostics: true,
        initializationOptions: {},
        middleware: {
          handleDiagnostics
        }
      }
      let serverModule = path.join(__dirname, './server/eventServer.js')
      let serverOptions: lsclient.ServerOptions = {
        module: serverModule,
        transport: lsclient.TransportKind.stdio,
      }
      let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
      await client.start()
      return client
    }
    let client = await startServer()
    await client.sendNotification('diagnostics')
    await helper.wait(30)
    let collection = client.diagnostics
    let res = collection.get('lsptest:/2')
    expect(res.length).toBe(2)
    await client.stop()
    client = await startServer(true)
    await client.sendNotification('diagnostics')
    await helper.wait(30)
    collection = client.diagnostics
    expect(collection).toBeUndefined()
    await client.stop()
    let called = false
    client = await startServer(false, (uri, diagnostics, next) => {
      called = true
      next(uri, diagnostics)
    })
    await client.sendNotification('diagnostics')
    await helper.wait(30)
    expect(called).toBe(true)
    await client.stop()
  })

  it('should check version on apply workspaceEdit', async () => {
    let uri = URI.file(__filename)
    await workspace.loadFile(uri.toString())
    let clientOptions: lsclient.LanguageClientOptions = {
      documentSelector: [{ scheme: 'file' }],
      initializationOptions: {},
    }
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.stdio,
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    let res
    client.onNotification('result', p => {
      res = p
    })
    await client.start()
    await helper.wait(10)
    await client.sendNotification('edits')
    await helper.wait(50)
    expect(res).toBeDefined()
    expect(res).toEqual({ applied: false })
    await client.stop()
  })

  it('should apply simple workspaceEdit', async () => {
    let clientOptions: lsclient.LanguageClientOptions = {
      initializationOptions: {},
    }
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.stdio,
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    let res
    client.onNotification('result', p => {
      res = p
    })
    await client.start()
    await client.sendNotification('simpleEdit')
    await helper.wait(30)
    expect(res).toBeDefined()
    expect(res).toEqual({ applied: true })
    await client.stop()
  })
})

describe('SettingMonitor', () => {
  it('should setup SettingMonitor', async () => {
    let clientOptions: lsclient.LanguageClientOptions = {}
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.ipc
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    await client.start()
    let monitor = new lsclient.SettingMonitor(client, 'html.enabled')
    let disposable = monitor.start()
    helper.updateConfiguration('html.enabled', false)
    await helper.wait(30)
    expect(client.state).toBe(lsclient.State.Stopped)
    helper.updateConfiguration('html.enabled', true)
    await helper.wait(30)
    expect(client.state).toBe(lsclient.State.Starting)
    await client.onReady()
    disposable.dispose()
  })
})

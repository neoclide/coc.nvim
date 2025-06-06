import * as assert from 'assert'
import cp, { ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { CancellationToken, DidCreateFilesNotification, Disposable, ErrorCodes, InlayHintRequest, LSPErrorCodes, MessageType, ResponseError, Trace, WorkDoneProgress } from 'vscode-languageserver-protocol'
import { IPCMessageReader, IPCMessageWriter } from 'vscode-languageserver-protocol/node'
import { MarkupKind, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import * as lsclient from '../../language-client'
import { CloseAction, ErrorAction } from '../../language-client'
import { FeatureState, LSPCancellationError, StaticFeature } from '../../language-client/features'
import { DefaultErrorHandler, ErrorHandlerResult, InitializationFailedHandler } from '../../language-client/utils/errorHandler'
import { disposeAll } from '../../util'
import { CancellationError } from '../../util/errors'
import * as extension from '../../util/extensionRegistry'
import { Registry } from '../../util/registry'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
})

afterEach(() => {
  disposeAll(disposables)
})

afterAll(async () => {
  await helper.shutdown()
})

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

describe('SettingMonitor', () => {
  it('should setup SettingMonitor', async () => {
    let clientOptions: lsclient.LanguageClientOptions = {
      uriConverter: { code2Protocol: uri => uri.toString() },
      initializationOptions: () => {
        return {}
      },
      markdown: { supportHtml: true },
      disableDynamicRegister: true
    }
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.ipc
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    client.onNotification('customNotification', () => {
    })
    client.onProgress(WorkDoneProgress.type, '4fb247f8-0ede-415d-a80a-6629b6a9eaf8', () => {
    })
    await client.start()
    await client.forceDocumentSync()
    await client.sendNotification('register')
    await helper.wait(30)
    expect(client.traceOutputChannel).toBeDefined()
    let monitor = new lsclient.SettingMonitor(client, 'html.enabled')
    helper.updateConfiguration('html.enabled', false)
    disposables.push(monitor.start())
    await helper.waitValue(() => {
      return client.state
    }, lsclient.State.Stopped)
    helper.updateConfiguration('html.enabled', true, disposables)
    await helper.waitValue(() => {
      return client.state != lsclient.State.Stopped
    }, true)
    await client.onReady()
    await client.stop()
  })

  it('should use SettingMonitor for primary setting', async () => {
    let clientOptions: lsclient.LanguageClientOptions = {}
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      command: 'node',
      args: [serverModule],
      transport: lsclient.TransportKind.stdio,
      options: { env: false }
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    let monitor = new lsclient.SettingMonitor(client, 'TestServerEnabled')
    let spy = jest.spyOn(client, 'start').mockReturnValue(Promise.reject(new Error('myerror')) as any)
    disposables.push(monitor.start())
    spy.mockRestore()
    await client.start()
    let called = false
    let s = jest.spyOn(client, 'stop').mockImplementation(() => {
      called = true
      return Promise.reject(new Error('myerror'))
    })
    helper.updateConfiguration('TestServerEnabled', false)
    await helper.waitValue(() => called, true)
    s.mockRestore()
    await client.stop()
  })
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
    await workspace.nvim.command('bd!')
  })

  it('should get runtime path', async () => {
    expect(lsclient.getRuntimePath('node', undefined)).toBe('node')
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
    disposables.push(client)
    await client.start()
    let called = false
    let spy = jest.spyOn(client, 'error').mockImplementation(() => {
      called = true
    })
    await client.sendNotification('registerBad')
    await helper.waitValue(() => called, true)
    spy.mockRestore()
    {
      let spy = jest.spyOn(client['_connection'], 'trace').mockReturnValue(Promise.reject(new Error('myerror')))
      client.trace = Trace.Compact
      spy.mockRestore()
    }
  })

  it('should restart on error', async () => {
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      command: 'node',
      args: [serverModule, '--stdio']
    }
    let client = await testLanguageServer(serverOptions, {
      errorHandler: new DefaultErrorHandler('test', 2)
    })
    let called = false
    let spy = jest.spyOn(client, 'start').mockImplementation((async () => {
      called = true
      throw new Error('myerror')
    }) as any)
    let sp: ChildProcess = client['_serverProcess']
    sp.kill('SIGKILL')
    await helper.waitValue(() => called, true)
    spy.mockRestore()
  })

  it('should not start on process exit', async () => {
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      command: 'node',
      args: [serverModule, '--stdio']
    }
    let clientOptions: lsclient.LanguageClientOptions = {
      documentSelector: ['css'],
      errorHandler: {
        error: () => ErrorAction.Shutdown,
        closed: () => {
          return { action: CloseAction.DoNotRestart, handled: true }
        }
      }
    }
    let client = new lsclient.LanguageClient('css', 'Test Language Server', serverOptions, clientOptions)
    await client.start()
    client['_state'] = lsclient.ClientState.Starting
    let sp: ChildProcess = client['_serverProcess']
    sp.kill()
    await helper.waitValue(() => client['_state'], lsclient.ClientState.StartFailed)
  })

  it('should register events before server start', async () => {
    let clientOptions: lsclient.LanguageClientOptions = {}
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.ipc
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    let name = client.getExtensionName()
    expect(name).toBe('html')
    let n = 0
    let disposable = client.onRequest('customRequest', () => {
      n++
      disposable.dispose()
      return {}
    })
    let dispose = client.onNotification('customNotification', () => {
      n++
      dispose.dispose()
    })
    let dis = client.onProgress(WorkDoneProgress.type, '4fb247f8-0ede-415d-a80a-6629b6a9eaf8', p => {
      expect(p).toEqual({ kind: 'end', message: 'end message' })
      n++
      dis.dispose()
    })
    disposables.push(client)
    await client.start()
    await client.sendNotification('send')
    await helper.waitValue(() => {
      return n
    }, 3)
    //   let client = await testEventServer({ initEvent: true })
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
    disposables.push(client)
    await client.start()
    let n = 0
    let disposable = client.onRequest('customRequest', () => {
      n++
      disposable.dispose()
      return {}
    })
    let dispose = client.onNotification('customNotification', () => {
      n++
      dispose.dispose()
    })
    let dis = client.onProgress(WorkDoneProgress.type, '4fb247f8-0ede-415d-a80a-6629b6a9eaf8', p => {
      expect(p).toEqual({ kind: 'end', message: 'end message' })
      n++
      dis.dispose()
    })
    await client.sendNotification('send')
    await helper.waitValue(() => {
      return n
    }, 3)
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
    let called = false
    client.onNotification('progressResult', res => {
      called = true
      expect(res).toEqual({ kind: 'begin', title: 'begin progress' })
    })
    await client.sendProgress(WorkDoneProgress.type, '4b3a71d0-2b3f-46af-be2c-2827f548579f', { kind: 'begin', title: 'begin progress' })
    await client.start()
    await helper.waitValue(() => called, true)
    let spy = jest.spyOn(client['_connection'] as any, 'sendProgress').mockImplementation(() => {
      throw new Error('error')
    })
    await expect(async () => {
      await client.sendProgress(WorkDoneProgress.type, '', { kind: 'begin', title: '' })
    }).rejects.toThrow(Error)
    spy.mockRestore()
    let p = client.stop()
    await expect(async () => {
      await client._start()
    }).rejects.toThrow(Error)
    await p
    await expect(async () => {
      await client.sendProgress(WorkDoneProgress.type, '', { kind: 'begin', title: '' })
    }).rejects.toThrow(/not running/)
  })

  it('should use custom errorHandler', async () => {
    let throwError = false
    let called = false
    let result: ErrorHandlerResult | ErrorAction = { action: ErrorAction.Shutdown, handled: true }
    let clientOptions: lsclient.LanguageClientOptions = {
      synchronize: {},
      errorHandler: {
        error: () => {
          return result
        },
        closed: () => {
          called = true
          if (throwError) throw new Error('myerror')
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
    disposables.push(client)
    throwError = true
    await assert.rejects(async () => {
      await client.sendRequest('bad', CancellationToken.Cancelled)
    }, /cancelled/)
    await client.sendRequest('doExit')
    await client.start()
    await helper.waitValue(() => {
      return called
    }, true)
    await client.handleConnectionError(new Error('error'), { jsonrpc: '' }, 1)
    result = ErrorAction.Continue
    await client.handleConnectionError(new Error('error'), { jsonrpc: '' }, 1)
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
    expect(client.hasPendingResponse).toBeUndefined()
    disposables.push(client)
    await client.start()
    await client.sendNotification('logMessage')
    await client.sendNotification('showMessage')
    let types = [MessageType.Error, MessageType.Warning, MessageType.Info, MessageType.Log]
    let times = 0
    let result = true
    const mockMessageFunctions = function(): Disposable {
      let names = ['showErrorMessage', 'showWarningMessage', 'showInformationMessage']
      let fns: Function[] = []
      for (let name of names) {
        let spy = jest.spyOn(window as any, name).mockImplementation(() => {
          times++
          return Promise.resolve(result)
        })
        fns.push(() => {
          spy.mockRestore()
        })
      }
      return Disposable.create(() => {
        for (let fn of fns) {
          fn()
        }
      })
    }
    disposables.push(mockMessageFunctions())
    for (const t of types) {
      await client.sendNotification('requestMessage', { type: t })
    }
    await helper.waitValue(() => {
      return times >= 3
    }, true)
    let filename = path.join(os.tmpdir(), uuid())
    let uri = URI.file(filename)
    fs.writeFileSync(filename, 'foo', 'utf8')
    let spy = jest.spyOn(workspace, 'openResource').mockImplementation(() => {
      return Promise.resolve()
    })
    let called = false
    let s = jest.spyOn(window, 'selectRange').mockImplementation(() => {
      called = true
      return Promise.reject(new Error('failed'))
    })
    await client.sendNotification('showDocument', { external: true, uri: 'lsptest:///1' })
    await client.sendNotification('showDocument', { uri: 'lsptest:///1', takeFocus: false })
    await client.sendNotification('showDocument', { uri: uri.toString() })
    await client.sendNotification('showDocument', { uri: uri.toString(), selection: Range.create(0, 0, 1, 0) })
    await helper.waitValue(() => called, true)
    spy.mockRestore()
    s.mockRestore()
    fs.unlinkSync(filename)
    await helper.waitValue(() => {
      return client.hasPendingResponse
    }, false)
  })

  it('should invoke showDocument middleware', async () => {
    let called = false
    let clientOptions: lsclient.LanguageClientOptions = {
      synchronize: {},
      middleware: {
        window: {
          showDocument: async (params, token, next) => {
            called = true
            let res = await next(params, token)
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
    await helper.waitValue(() => called, true)
    await client.restart()
    await client.stop()
  })
})

describe('Client integration', () => {
  it('should initialize from function', async () => {
    async function testServer(serverOptions: lsclient.ServerOptions) {
      let clientOptions: lsclient.LanguageClientOptions = {}
      let client = new lsclient.LanguageClient('HTML', serverOptions, clientOptions)
      await client.start()
      await client.dispose()
      void client.dispose()
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
    helper.updateConfiguration('css.trace.server.verbosity', 'verbose', disposables)
    helper.updateConfiguration('css.trace.server.format', 'json', disposables)
    let uri = URI.file(__filename)
    await workspace.loadFile(uri.toString())
    let serverModule = path.join(__dirname, './server/testInitializeResult.js')
    let serverOptions: lsclient.ServerOptions = {
      run: { module: serverModule, transport: lsclient.TransportKind.ipc },
      debug: { module: serverModule, transport: lsclient.TransportKind.ipc, options: { execArgv: [] } }
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
    let client = new lsclient.LanguageClient('css', 'Test Language Server', serverOptions, clientOptions, true)
    assert.ok(client.isInDebugMode)
    await client.start()
    await helper.waitValue(() => client.diagnostics.has('uri:/test.ts'), true)
    await client.restart()
    assert.deepEqual(client.initializeResult.customResults, { hello: 'world' })
    await client.stop()
    await assert.rejects(async () => {
      let options: any = {}
      let client = new lsclient.LanguageClient('css', 'Test Language Server', options, clientOptions)
      await client.start()
    }, /Unsupported/)
    await assert.rejects(async () => {
      let options: lsclient.ServerOptions = { command: 'node', transport: lsclient.TransportKind.ipc }
      let client = new lsclient.LanguageClient('css', 'Test Language Server', options, clientOptions)
      await client.start()
    }, /not supported/)
    await assert.rejects(async () => {
      let opts: any = { stdio: 'ignore' }
      let options: lsclient.ServerOptions = { module: serverModule, transport: lsclient.TransportKind.ipc, options: opts }
      let client = new lsclient.LanguageClient('css', 'Test Language Server', options, clientOptions)
      await client.start()
    }, /without stdio/)
  })

  it('should initialize use stdio', async () => {
    helper.updateConfiguration('css.trace.server.verbosity', 'verbose', disposables)
    helper.updateConfiguration('css.trace.server.format', 'text', disposables)
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.stdio
    }
    let client = await testLanguageServer(serverOptions, {
      workspaceFolder: { name: 'test', uri: URI.file(__dirname).toString() },
      outputChannel: window.createOutputChannel('test'),
      traceOutputChannel: window.createOutputChannel('test-trace'),
      markdown: {},
      disabledFeatures: ['pullDiagnostic'],
      revealOutputChannelOn: lsclient.RevealOutputChannelOn.Info,
      outputChannelName: 'custom',
      connectionOptions: {
        cancellationStrategy: { sender: {} } as any,
        maxRestartCount: 10,
      },
      stdioEncoding: 'utf8',
      errorHandler: {
        error: () => {
          return lsclient.ErrorAction.Continue
        },
        closed: () => {
          return { action: CloseAction.DoNotRestart, handled: true }
        }
      },
      progressOnInitialization: true,
      disableMarkdown: true,
      disableDiagnostics: true
    })
    assert.deepStrictEqual(client.supportedMarkupKind, [MarkupKind.PlainText])
    assert.strictEqual(client.name, 'Test Language Server')
    assert.strictEqual(client.diagnostics, undefined)
    expect(client.traceOutputChannel).toBeDefined()
    client.traceMessage('message')
    client.traceMessage('message', {})
    client.trace = Trace.Verbose
    let d = client.start()
    let token = CancellationToken.Cancelled
    let sp: ChildProcess = client['_serverProcess']
    expect(sp instanceof ChildProcess).toBe(true)
    sp.stdout.emit('error', new Error('my error'))
    client.handleFailedRequest(DidCreateFilesNotification.type, token, undefined, '')
    await expect(async () => {
      let error = new ResponseError(LSPErrorCodes.RequestCancelled, 'request cancelled')
      client.handleFailedRequest(DidCreateFilesNotification.type, undefined, error, '')
    }).rejects.toThrow(CancellationError)
    await expect(async () => {
      let error = new ResponseError(LSPErrorCodes.RequestCancelled, 'request cancelled', 'cancelled')
      client.handleFailedRequest(DidCreateFilesNotification.type, undefined, error, '')
    }).rejects.toThrow(LSPCancellationError)
    await expect(async () => {
      let error = new Error('failed')
      client.handleFailedRequest(DidCreateFilesNotification.type, undefined, error, '')
    }).rejects.toThrow(Error)
    let error = new ResponseError(LSPErrorCodes.ContentModified, 'content changed')
    client.handleFailedRequest(DidCreateFilesNotification.type, undefined, error, '')
    error = new ResponseError(ErrorCodes.PendingResponseRejected, '')
    client.handleFailedRequest(DidCreateFilesNotification.type, undefined, error, '')
    await expect(async () => {
      let error = new ResponseError(LSPErrorCodes.ContentModified, 'content changed')
      client.handleFailedRequest(InlayHintRequest.type, undefined, error, '')
    }).rejects.toThrow(CancellationError)
    await client.stop()
    client.info('message', new Error('my error'), true)
    client.warn('message', 'error', true)
    client.warn('message', 0, true)
    client.logFailedRequest({ method: 'method' }, new Error('error'))
    let err = new ResponseError(LSPErrorCodes.RequestCancelled, 'response error')
    client.logFailedRequest('', err)
    assert.strictEqual(client.diagnostics, undefined)
    await client.handleConnectionError(new Error('test'), undefined, 0)
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
    await assert.rejects(async () => {
      let option: lsclient.ServerOptions = {
        command: 'foobar',
        transport: lsclient.TransportKind.pipe
      }
      await testLanguageServer(option, {})
    }, /ENOENT/)
  })

  it('should initialize use socket', async () => {
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      options: { env: { NODE_SOCKET_TEST: 1 } },
      transport: {
        kind: lsclient.TransportKind.socket,
        port: 8088
      }
    }
    let client = await testLanguageServer(serverOptions)
    await client.stop()
    let option: lsclient.ServerOptions = {
      command: 'node',
      args: [serverModule],
      transport: {
        kind: lsclient.TransportKind.socket,
        port: 9088
      }
    }
    client = await testLanguageServer(option, {})
    await client.sendNotification('printMessage')
    await helper.waitValue(() => {
      return client.outputChannel.content.match('Stderr') != null
    }, true)
    // avoid pending response error
    await helper.wait(50)
    await client.stop()
    await assert.rejects(async () => {
      let option: lsclient.ServerOptions = {
        command: 'foobar',
        transport: {
          kind: lsclient.TransportKind.socket,
          port: 9998
        }
      }
      await testLanguageServer(option, {})
    }, /ENOENT/)
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

  it('should register features', async () => {
    let features: StaticFeature[] = []
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      command: 'node',
      args: [serverModule, '--stdio']
    }
    let clientOptions: lsclient.LanguageClientOptions = {
      documentSelector: ['css'],
      initializationOptions: {}
    }
    let client = new lsclient.LanguageClient('css', 'Test Language Server', serverOptions, clientOptions)
    let called = false
    class SimpleStaticFeature implements StaticFeature {
      public method = 'method'
      public fillClientCapabilities(capabilities): void {
        // Optionally add capabilities your feature supports
        capabilities.experimental = capabilities.experimental || {}
        capabilities.experimental.simpleStaticFeature = true
      }
      public preInitialize(): void {
        called = true
      }
      public initialize(): void {
      }
      public getState(): FeatureState {
        return { kind: 'static' }
      }
      public dispose(): void {
      }
    }
    features.push(new SimpleStaticFeature())
    client.registerFeatures(features)
    await client.start()
    expect(called).toBe(true)
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
    let client = new lsclient.LanguageClient('css', 'Test Language Server', serverOptions, clientOptions)
    await assert.rejects(async () => {
      await client.start()
    }, /failed/)
    await expect(async () => {
      await client['$start']()
    }).rejects.toThrow(/failed/)
  })

  it('should logMessage', async () => {
    let called = false
    let outputChannel = {
      name: 'empty',
      content: '',
      append: () => {
        called = true
      },
      appendLine: () => {
        called = true
      },
      clear: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {}
    }
    helper.updateConfiguration('css.trace.server.verbosity', 'verbose', disposables)
    let serverOptions: lsclient.ServerOptions = {
      command: 'node',
      args: [path.join(__dirname, './server/eventServer.js'), '--stdio']
    }
    let client = await testLanguageServer(serverOptions, {
      outputChannel,
      initializationOptions: { trace: true }
    })
    expect(called).toBe(true)
    await client.stop()
  })

  it('should use console for messages', async () => {
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      command: 'node',
      args: [serverModule, '--stdio']
    }
    let client = await testLanguageServer(serverOptions)
    let fn = jest.fn()
    let spy = jest.spyOn(console, 'log').mockImplementation(() => {
      fn()
    })
    let s = jest.spyOn(console, 'error').mockImplementation(() => {
      fn()
    })
    client.switchConsole()
    client.info('message', { info: 'info' })
    client.warn('message', { info: 'info' })
    client.error('message', { info: 'info' })
    client.info('message', { info: 'info' })
    client.switchConsole()
    s.mockRestore()
    spy.mockRestore()
    await client.stop()
    expect(fn).toHaveBeenCalled()
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
    let disposable = client.start()
    await disposable
    await client.sendNotification('edits')
    await helper.waitValue(() => {
      return res
    }, { applied: false })
    disposable.dispose()
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
    await helper.waitValue(() => {
      return res != null
    }, true)
    expect(res).toEqual({ applied: true })
    await client.stop()
  })

  it('should handle error on initialize', async () => {
    let client: lsclient.LanguageClient
    let progressOnInitialization = false
    async function startServer(handler: InitializationFailedHandler | undefined, key = 'throwError'): Promise<lsclient.LanguageClient> {
      let clientOptions: lsclient.LanguageClientOptions = {
        initializationFailedHandler: handler,
        progressOnInitialization,
        initializationOptions: {
          [key]: true
        },
        connectionOptions: {
          maxRestartCount: 1
        }
      }
      let serverModule = path.join(__dirname, './server/eventServer.js')
      let serverOptions: lsclient.ServerOptions = {
        module: serverModule,
        transport: lsclient.TransportKind.ipc,
      }
      client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
      await client.start()
      return client
    }
    let messageReturn = {}
    let spy = jest.spyOn(window, 'showErrorMessage').mockImplementation(() => {
      return Promise.resolve(messageReturn as any)
    })
    let n = 0
    await expect(async () => {
      await startServer(() => {
        n++
        return n == 1
      })
    }).rejects.toThrow(Error)
    await helper.waitValue(() => {
      return n
    }, 2)
    await expect(async () => {
      await startServer(undefined)
    }).rejects.toThrow(Error)

    await expect(async () => {
      await startServer(undefined, 'normalThrow')
    }).rejects.toThrow(Error)
    progressOnInitialization = true
    await expect(async () => {
      client = await startServer(undefined, 'utf8')
    }).rejects.toThrow(/Unsupported position encoding/)
    await helper.waitValue(() => client.state, lsclient.State.Stopped)
    await client.stop()
    spy.mockRestore()
  })

  it('should attach extension name', async () => {
    let clientOptions: lsclient.LanguageClientOptions = {}
    let serverModule = path.join(__dirname, './server/eventServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.ipc
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    let registry = Registry.as<extension.IExtensionRegistry>(extension.Extensions.ExtensionContribution)
    let filepath = path.join(os.tmpdir(), 'single')
    registry.registerExtension('single', { name: 'single', directory: os.tmpdir(), filepath })
    client['stack'] = `\n\n${filepath}:1:1`
    let obj = {}
    client.attachExtensionName(obj)
    expect(typeof client.getExtensionName()).toBe('string')
    expect(obj['__extensionName']).toBe('single')
    registry.unregistExtension('single')
    await client.dispose()
  })
})

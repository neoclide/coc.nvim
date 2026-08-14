import fs from 'fs'
import os from 'os'
import path from 'path'
import { createExtensionApi, SHARED_VALUE_EXPORTS, WRAPPED_SINGLETONS } from '../../extension/facade'
import type { ExtensionApiContext } from '../../extension/facade'
import { consoleLogger, createExtensionRuntime } from '../../extension/loader'
import { getExtensionId, prefixExtensionError, setExtensionId, wrapCallbackWithExtension } from '../../util/extensionId'
import { Disposable } from '../../util/protocol'
import * as coreApi from '../../index'

function createContext(id: string): ExtensionApiContext {
  return { extensionId: id, extensionRoot: `/ext/${id}`, subscriptions: [] }
}

function createMockCore(): any {
  let commands = new Map<string, Function>()
  let listeners: Function[] = []
  let providers: any[] = []
  let core: any = {
    workspace: {
      nvim: { connected: false },
      cwd: '/root',
      registerAutocmd: (option: any) => {
        listeners.push(option.callback)
        return Disposable.create(() => {})
      },
      registerTextDocumentContentProvider: (scheme: string, provider: any) => {
        providers.push(provider)
        return Disposable.create(() => {})
      },
      registerKeymap: (modes: any, key: string, fn: Function) => {
        listeners.push(fn)
        return Disposable.create(() => {})
      },
      registerExprKeymap: (mode: any, key: string, fn: Function) => {
        listeners.push(fn)
        return Disposable.create(() => {})
      },
      registerInsertKeymap: (key: string, fn: Function) => {
        listeners.push(fn)
        return Disposable.create(() => {})
      },
      registerLocalKeymap: (bufnr: any, mode: any, key: string, fn: Function) => {
        listeners.push(fn)
        return Disposable.create(() => {})
      },
      createFileSystemWatcher: (pattern: any) => Disposable.create(() => {}),
      getConfiguration: (section: string) => ({ get: () => undefined }),
      onWillSaveTextDocument: (cb: Function) => {
        listeners.push(cb)
        return Disposable.create(() => {})
      },
      onDidChangeConfiguration: (cb: Function) => {
        listeners.push(cb)
        return Disposable.create(() => {})
      }
    },
    window: {
      showMessage: (msg: string) => msg,
      activeTextEditor: { document: {} }
    },
    commands: {
      registerCommand: (id: string, impl: Function) => {
        commands.set(id, impl)
        return Disposable.create(() => {
          commands.delete(id)
        })
      },
      has: (id: string) => commands.has(id),
      executeCommand: (id: string) => {
        let fn = commands.get(id)
        if (!fn) throw new Error(`command ${id} not found`)
        return fn()
      }
    },
    languages: {
      registerHoverProvider: (selector: any, provider: any) => {
        providers.push(provider)
        return Disposable.create(() => {})
      }
    },
    events: {
      on: (event: string, handler: Function) => {
        listeners.push(handler)
        return Disposable.create(() => {})
      },
      once: (event: string, handler: Function) => {
        listeners.push(handler)
        return Disposable.create(() => {})
      }
    },
    sources: {
      addSource: (src: any) => Disposable.create(() => {}),
      removeSource: (name: string) => true
    },
    services: { register: (svc: any) => Disposable.create(() => {}) },
    extensions: { all: [] },
    diagnosticManager: {
      create: () => Disposable.create(() => {}),
      createDiagnosticCollection: () => Disposable.create(() => {})
    },
    listManager: { registerList: (list: any) => Disposable.create(() => {}) },
    snippetManager: {},
    mcp: { status: () => ({}) },
    Position: class Position {},
    Range: class Range {},
    LanguageClient: class LanguageClient {}
  }
  core.__listeners = listeners
  core.__providers = providers
  return core
}

describe('extension api facade', () => {
  it('should give each extension its own facade and subobjects', () => {
    let core = createMockCore()
    let apiA = createExtensionApi(createContext('a'), core)
    let apiB = createExtensionApi(createContext('b'), core)
    assert.notStrictEqual(apiA, apiB)
    assert.strictEqual(apiA, apiA)
    for (let name of WRAPPED_SINGLETONS) {
      assert.notStrictEqual(apiA[name], apiB[name], name)
    }
  })

  it('should not expose raw core singletons', () => {
    let core = createMockCore()
    let api = createExtensionApi(createContext('a'), core)
    for (let name of WRAPPED_SINGLETONS) {
      assert.notStrictEqual(api[name], core[name], name)
    }
  })

  it('should share immutable value exports', () => {
    let core = createMockCore()
    let apiA = createExtensionApi(createContext('a'), core)
    let apiB = createExtensionApi(createContext('b'), core)
    assert.strictEqual(apiA.Position, apiB.Position)
    assert.strictEqual(apiA.Position, core.Position)
    assert.strictEqual(apiA.Range, core.Range)
    assert.strictEqual(apiA.LanguageClient, core.LanguageClient)
  })

  it('should keep nvim and dynamic properties live', () => {
    let core = createMockCore()
    let api = createExtensionApi(createContext('a'), core)
    assert.strictEqual(api.nvim, core.workspace.nvim)
    core.workspace.nvim = { connected: true }
    assert.strictEqual(api.nvim, core.workspace.nvim)
    assert.strictEqual(api.workspace.cwd, '/root')
    core.workspace.cwd = '/new'
    assert.strictEqual(api.workspace.cwd, '/new')
  })

  it('should isolate facade mutation from other extensions and core', () => {
    let core = createMockCore()
    let apiA = createExtensionApi(createContext('a'), core)
    let apiB = createExtensionApi(createContext('b'), core)
    let original = core.commands.executeCommand
    assert.throws(() => {
      ;(apiA.commands as any).executeCommand = () => 'fake'
    })
    assert.strictEqual(core.commands.executeCommand, original)
    assert.strictEqual(typeof apiB.commands.executeCommand, 'function')
    assert.throws(() => {
      ;(apiA.workspace as any).cwd = '/mutated'
    })
    assert.strictEqual(core.workspace.cwd, '/root')
  })

  it('should wrap workspace registration callbacks for error attribution', () => {
    let core = createMockCore()
    let ctx = createContext('plugin-a')
    let api = createExtensionApi(ctx, core)
    let autocmd = { event: 'BufEnter', callback: () => { throw new Error('autocmd boom') } }
    api.workspace.registerAutocmd(autocmd)
    assert.strictEqual(getExtensionId(autocmd.callback), 'plugin-a')
    assert.throws(() => autocmd.callback(), /\[extension: plugin-a\] autocmd boom/)
    let provider = { provideTextDocumentContent: () => { throw new Error('provider boom') } }
    api.workspace.registerTextDocumentContentProvider('test', provider)
    assert.strictEqual(getExtensionId(provider.provideTextDocumentContent), 'plugin-a')
    assert.throws(() => provider.provideTextDocumentContent(), /\[extension: plugin-a\] provider boom/)
    let keymapFn = () => { throw new Error('keymap boom') }
    api.workspace.registerKeymap(['n'], 'x', keymapFn)
    // Function-arg callbacks are replaced by an attributed wrapper passed to
    // the core registration; verify through the stored listener.
    let storedKeymap = core.__listeners[core.__listeners.length - 1]
    assert.strictEqual(getExtensionId(storedKeymap), 'plugin-a')
    assert.throws(() => storedKeymap(), /\[extension: plugin-a\] keymap boom/)
    // Registration disposables are tracked for cleanup.
    assert.ok(ctx.subscriptions.length >= 3)
  })

  it('should tag registration callbacks with the extension id', () => {
    let core = createMockCore()
    let ctx = createContext('plugin-a')
    let api = createExtensionApi(ctx, core)
    let impl = () => {}
    api.commands.registerCommand('a.cmd', impl)
    assert.strictEqual(getExtensionId(impl), 'plugin-a')
    let handler = () => {}
    api.events.on('TextChanged', handler)
    assert.strictEqual(getExtensionId(handler), 'plugin-a')
    let provider = { provideHover() { return null } }
    api.languages.registerHoverProvider(['javascript'], provider)
    assert.strictEqual(getExtensionId(provider), 'plugin-a')
    let configHandler = () => {}
    let disposable = api.workspace.onDidChangeConfiguration(configHandler)
    // workspace registration callbacks are wrapped for error attribution and
    // the returned disposable is tracked for cleanup.
    assert.strictEqual(typeof disposable.dispose, 'function')
    assert.strictEqual(ctx.subscriptions.length > 0, true)
  })

  it('should prefix callback errors with the extension id', () => {
    let err = prefixExtensionError(new Error('boom'), 'plugin-a')
    assert.strictEqual((err as Error).message, '[extension: plugin-a] boom')
    // Already attributed errors stay untouched.
    let err2 = prefixExtensionError(new Error('[extension: plugin-b] nope'), 'plugin-a')
    assert.strictEqual((err2 as Error).message, '[extension: plugin-b] nope')
  })

  it('should wrap callbacks with extension attribution', async () => {
    let wrapped = wrapCallbackWithExtension((x: number) => x + 1, 'plugin-a')
    assert.strictEqual(wrapped(1), 2)
    assert.strictEqual(getExtensionId(wrapped), 'plugin-a')
    let throwing = wrapCallbackWithExtension(() => {
      throw new Error('sync boom')
    }, 'plugin-a')
    assert.throws(() => throwing(), /\[extension: plugin-a\] sync boom/)
    let rejecting = wrapCallbackWithExtension(async () => {
      throw new Error('async boom')
    }, 'plugin-a')
    await assert.rejects(rejecting(), /\[extension: plugin-a\] async boom/)
  })

  it('should tag objects and tolerate frozen targets', () => {
    let obj: any = {}
    setExtensionId(obj, 'plugin-a')
    assert.strictEqual(getExtensionId(obj), 'plugin-a')
    let frozen = Object.freeze({})
    setExtensionId(frozen, 'plugin-b')
    assert.strictEqual(getExtensionId(frozen), undefined)
    assert.strictEqual(getExtensionId('plain string'), undefined)
    assert.strictEqual(prefixExtensionError('not an error', 'plugin-a'), 'not an error')
    // A message getter that throws keeps the original error untouched.
    let hostile = { get message(): string { throw new Error('getter boom') } }
    assert.strictEqual(prefixExtensionError(hostile, 'plugin-a'), hostile)
    // A frozen error falls back to a new attributed Error.
    let frozenError = Object.freeze({ message: 'frozen boom' })
    let prefixed = prefixExtensionError(frozenError, 'plugin-a') as Error
    assert.strictEqual(prefixed.message, '[extension: plugin-a] frozen boom')
  })

  it('should wrap every singleton registration surface', () => {
    let core = createMockCore()
    let api = createExtensionApi(createContext('a'), core)
    api.sources.addSource({ name: 'src' })
    api.services.register({ id: 'svc' })
    api.diagnosticManager.create()
    api.listManager.registerList({ name: 'list' })
    api.window.showMessage('hi')
    api.mcp.status()
    assert.strictEqual(typeof api.extensions.all, 'object')
    // Symbol property access forwards to the wrapped core object.
    let sym = Symbol('test')
    assert.strictEqual((api.workspace as any)[sym], (core.workspace as any)[sym])
  })

  it('should wrap additional registration surfaces', () => {
    let core = createMockCore()
    let api = createExtensionApi(createContext('plugin-a'), core)
    let onceHandler = () => {}
    api.events.once('TextChanged', onceHandler)
    api.sources.removeSource('src')
    api.diagnosticManager.createDiagnosticCollection('diag')
    let expr = () => {}
    api.workspace.registerExprKeymap('n', 'x', expr)
    let insert = () => {}
    api.workspace.registerInsertKeymap('x', insert)
    let local = () => {}
    api.workspace.registerLocalKeymap(1, 'n', 'x', local)
    let willSave = () => {}
    api.workspace.onWillSaveTextDocument(willSave)
    let watcher = api.workspace.createFileSystemWatcher('**/*.ts')
    assert.strictEqual(typeof watcher.dispose, 'function')
    // Non-registration methods bind through without being wrapped.
    assert.strictEqual(typeof api.workspace.getConfiguration('x').get, 'function')
    // All wrapped callbacks carry the extension id (stored by the mock).
    for (let fn of core.__listeners.slice(-5)) {
      assert.strictEqual(getExtensionId(fn), 'plugin-a')
    }
  })

  it('should dispose extension-owned registrations on cleanup', () => {
    let core = createMockCore()
    let ctx = createContext('a')
    let api = createExtensionApi(ctx, core)
    api.commands.registerCommand('a.cmd', () => {})
    let provider = { provideHover() { return null } }
    api.languages.registerHoverProvider(['javascript'], provider)
    let handler = () => {}
    api.events.on('TextChanged', handler)
    api.sources.addSource({ name: 'src' })
    assert.strictEqual(core.commands.has('a.cmd'), true)
    for (let disposable of ctx.subscriptions) {
      disposable.dispose()
    }
    assert.strictEqual(core.commands.has('a.cmd'), false)
    // Disposing twice is a no-op.
    for (let disposable of ctx.subscriptions) {
      disposable.dispose()
    }
  })

  it('should create a new facade per runtime', () => {
    let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-facade-'))
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `module.exports = { activate: () => {} }`)
    let core = { workspace: { nvim: {} } }
    let runtime1 = createExtensionRuntime('facade-reload', entry, core, consoleLogger)
    let runtime2 = createExtensionRuntime('facade-reload', entry, core, consoleLogger)
    assert.notStrictEqual(runtime1.api, runtime2.api)
    assert.notStrictEqual((runtime1.api as any).workspace, (runtime2.api as any).workspace)
    fs.rmSync(folder, { recursive: true, force: true })
  })

  it('should classify every src/index export', () => {
    for (let key of Object.keys(coreApi)) {
      if (key === 'default') continue
      assert.ok(
        (WRAPPED_SINGLETONS as readonly string[]).includes(key) ||
        (SHARED_VALUE_EXPORTS as readonly string[]).includes(key) ||
        key === 'nvim',
        `unclassified export ${key}`
      )
    }
  })

  it('should preserve the top-level API surface', () => {
    let api = createExtensionApi(createContext('a'), coreApi)
    let coreKeys = Object.keys(coreApi).filter(key => key !== 'default').sort()
    assert.deepStrictEqual(Object.keys(api).sort(), coreKeys)
  })
})

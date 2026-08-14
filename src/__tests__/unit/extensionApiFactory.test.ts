import { ExtensionApiFactory } from '../../extension/apiFactory'
import type { ExtensionModuleDescription } from '../../extension/pathIndex'
import { getExtensionId } from '../../util/extensionId'

function description(id: string, root: string): ExtensionModuleDescription {
  return {
    id,
    root,
    realRoot: root,
    entry: `${root}/index.js`,
    moduleType: 'commonjs'
  }
}

describe('ExtensionApiFactory', () => {
  it('should require initialization before use', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let ext = description('a', '/ext/a')
    assert.throws(() => factory.getApi(ext), /has not been initialized/)
    assert.throws(() => factory.getCoreApi(), /has not been initialized/)
  })

  it('should reject double initialization', () => {
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize({ workspace: {} })
    assert.throws(() => factory.initialize({ workspace: {} }), /already initialized/)
  })

  it('should return the same API object for one extension', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let core = { workspace: {}, commands: {} }
    factory.initialize(core)
    let ext = description('a', '/ext/a')
    let api1 = factory.getApi(ext)
    let api2 = factory.getApi(ext)
    assert.strictEqual(api1, api2)
  })

  it('should return different API objects for different extensions', () => {
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize({ workspace: {} })
    let apiA = factory.getApi(description('a', '/ext/a'))
    let apiB = factory.getApi(description('b', '/ext/b'))
    assert.notStrictEqual(apiA, apiB)
  })

  it('should keep shared subobjects identical in phase 1', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let core = { workspace: { doSomething() {} }, commands: {}, events: {}, languages: {} }
    factory.initialize(core)
    let apiA = factory.getApi(description('a', '/ext/a')) as any
    let apiB = factory.getApi(description('b', '/ext/b')) as any
    // Registration surfaces are per-extension facades now.
    assert.notStrictEqual(apiA.workspace, apiB.workspace)
    assert.notStrictEqual(apiA.commands, apiB.commands)
    assert.notStrictEqual(apiA.events, apiB.events)
    assert.notStrictEqual(apiA.languages, apiB.languages)
  })

  it('should copy core API properties onto the extension object', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let core = { workspace: { ready: true } }
    factory.initialize(core)
    let api = factory.getApi(description('a', '/ext/a')) as any
    assert.strictEqual(api.workspace.ready, true)
    assert.deepStrictEqual(Object.keys(api), ['workspace'])
    assert.notStrictEqual(api, core)
  })

  it('should create a fresh API object after delete', () => {
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize({ workspace: {} })
    let ext = description('a', '/ext/a')
    let api1 = factory.getApi(ext)
    factory.delete('a')
    let api2 = factory.getApi(ext)
    assert.notStrictEqual(api1, api2)
  })

  it('should return the initialized core API', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let core = { workspace: {} }
    factory.initialize(core)
    assert.strictEqual(factory.getCoreApi(), core)
  })

  it('should tag command handlers with the extension id', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let core = { commands: { registerCommand(id: string, impl: Function) {} } }
    factory.initialize(core)
    let api = factory.getApi(description('a', '/ext/a')) as any
    let impl = () => {}
    api.commands.registerCommand('a.cmd', impl)
    assert.strictEqual(getExtensionId(impl), 'a')
  })

  it('should tag event handlers with the extension id', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let core = { events: { on(event: string, handler: Function) {} } }
    factory.initialize(core)
    let api = factory.getApi(description('a', '/ext/a')) as any
    let handler = () => {}
    api.events.on('TextChanged', handler)
    assert.strictEqual(getExtensionId(handler), 'a')
  })

  it('should tag language providers with the extension id', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let core = { languages: { registerHoverProvider(selector: string, provider: object) {} } }
    factory.initialize(core)
    let api = factory.getApi(description('a', '/ext/a')) as any
    let provider = { provideHover() {} }
    api.languages.registerHoverProvider('javascript', provider)
    assert.strictEqual(getExtensionId(provider), 'a')
  })

  it('should tag event handlers registered through once', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let core = { events: { once(event: string, handler: Function) {} } }
    factory.initialize(core)
    let api = factory.getApi(description('a', '/ext/a')) as any
    let handler = () => {}
    api.events.once('Ready', handler)
    assert.strictEqual(getExtensionId(handler), 'a')
  })

  it('should tag command objects registered through register', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let core = { commands: { register(command: object) {} } }
    factory.initialize(core)
    let api = factory.getApi(description('a', '/ext/a')) as any
    let command = { id: 'a.cmd', execute() {} }
    api.commands.register(command)
    assert.strictEqual(getExtensionId(command), 'a')
  })

  it('should wrap workspace onDid listeners with the extension id', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let captured: Function | undefined
    let core = {
      workspace: {
        onDidOpenTextDocument(listener: Function) {
          captured = listener
        }
      }
    }
    factory.initialize(core)
    let api = factory.getApi(description('a', '/ext/a')) as any
    let listener = () => {
      throw new Error('workspace boom')
    }
    api.workspace.onDidOpenTextDocument(listener)
    assert.ok(captured)
    assert.throws(() => (captured as Function)(), /\[extension: a\] workspace boom/)
  })

  it('should wrap workspace onWill listeners with the extension id', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let captured: Function | undefined
    let core = {
      workspace: {
        onWillSaveTextDocument(listener: Function) {
          captured = listener
        }
      }
    }
    factory.initialize(core)
    let api = factory.getApi(description('a', '/ext/a')) as any
    let listener = () => {
      throw new Error('onWill boom')
    }
    api.workspace.onWillSaveTextDocument(listener)
    assert.ok(captured)
    assert.throws(() => (captured as Function)(), /\[extension: a\] onWill boom/)
  })

  it('should wrap workspace keymap callbacks with the extension id', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let captured: Function | undefined
    let core = {
      workspace: {
        registerKeymap(modes: string[], key: string, fn: Function) {
          captured = fn
        }
      }
    }
    factory.initialize(core)
    let api = factory.getApi(description('a', '/ext/a')) as any
    let fn = () => {
      throw new Error('keymap boom')
    }
    api.workspace.registerKeymap(['n'], 'k', fn)
    assert.ok(captured)
    assert.throws(() => (captured as Function)(), /\[extension: a\] keymap boom/)
  })

  it('should tolerate non-object registration surfaces', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let core: any = { commands: 1, events: 'text', languages: false, workspace: true }
    factory.initialize(core)
    let api = factory.getApi(description('a', '/ext/a')) as any
    assert.strictEqual(api.commands, 1)
    assert.strictEqual(api.events, 'text')
    assert.strictEqual(api.languages, false)
    assert.strictEqual(api.workspace, true)
  })

  it('should proxy non-string property access to the shared target', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let symbol = Symbol('custom')
    let core: any = { commands: { registerCommand() {}, [symbol]: 42 } }
    factory.initialize(core)
    let api = factory.getApi(description('a', '/ext/a')) as any
    assert.strictEqual(api.commands[symbol], 42)
  })

  it('should bind non-registration methods to the shared target', () => {
    let factory = new ExtensionApiFactory<object, object>()
    let commands = { registerCommand() {}, dispose() { return this } }
    let core: any = { commands }
    factory.initialize(core)
    let api = factory.getApi(description('a', '/ext/a')) as any
    let bound = api.commands.dispose
    assert.strictEqual(bound(), commands)
  })
})

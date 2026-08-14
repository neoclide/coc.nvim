import { ExtensionApiFactory } from '../../extension/apiFactory'
import type { ExtensionModuleDescription } from '../../extension/pathIndex'

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
    let core = { workspace: { doSomething() {} }, commands: {} }
    factory.initialize(core)
    let apiA = factory.getApi(description('a', '/ext/a')) as any
    let apiB = factory.getApi(description('b', '/ext/b')) as any
    assert.strictEqual(apiA.workspace, core.workspace)
    assert.strictEqual(apiA.workspace, apiB.workspace)
    assert.strictEqual(apiA.commands, apiB.commands)
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
})

import Module, { createRequire } from 'node:module'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ExtensionApiFactory } from '../../extension/apiFactory'
import { CocModuleInterceptor } from '../../extension/moduleInterceptor'
import { ExtensionPathIndex, createModuleDescription } from '../../extension/pathIndex'

let folders: string[] = []
const originalLoad = (Module as any)._load
const require = createRequire(import.meta.url)

function createFolder(): string {
  let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-interceptor-'))
  // Resolve symlinked temp roots (e.g. /var -> /private/var on macOS) so
  // module filenames and roots are compared in one consistent domain.
  folder = fs.realpathSync(folder)
  folders.push(folder)
  return folder
}

function writeModule(dir: string, name: string, content: string): string {
  let file = path.join(dir, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

after(() => {
  ;(Module as any)._load = originalLoad
  for (let folder of folders) {
    for (let key of Object.keys(require.cache)) {
      if (key.startsWith(folder)) delete require.cache[key]
    }
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

describe('CocModuleInterceptor', () => {
  it('should be idempotent on install and restore original on dispose', () => {
    let original = (Module as any)._load
    let folder = createFolder()
    let index = new ExtensionPathIndex()
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize({ workspace: {} })
    let interceptor = new CocModuleInterceptor(index, factory, folder)
    interceptor.install()
    interceptor.install()
    assert.notStrictEqual((Module as any)._load, original)
    interceptor.dispose()
    assert.strictEqual((Module as any)._load, original)
    interceptor.dispose()
    assert.strictEqual((Module as any)._load, original)
  })

  it('should resolve api by importing extension', () => {
    let folder = createFolder()
    let extDir = path.join(folder, 'ext')
    let entry = writeModule(extDir, 'index.js', "module.exports = require('coc.nvim')")
    let lib = writeModule(extDir, 'lib.js', "module.exports = require('coc.nvim')")
    fs.writeFileSync(entry, "exports.api = require('coc.nvim')\nexports.libApi = require('./lib')")
    let index = new ExtensionPathIndex()
    index.update([createModuleDescription('ext', extDir, entry)])
    let core = { workspace: { name: 'core-workspace' } }
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize(core)
    let interceptor = new CocModuleInterceptor(index, factory, folder)
    interceptor.install()
    try {
      let mod = require(entry) as any
      assert.strictEqual(mod.api.workspace.name, 'core-workspace')
      assert.notStrictEqual(mod.api, core)
      // Same extension keeps API identity across files.
      assert.strictEqual(mod.libApi, mod.api)
    } finally {
      interceptor.dispose()
      for (let key of Object.keys(require.cache)) {
        if (key.startsWith(folder)) delete require.cache[key]
      }
    }
  })

  it('should give different extensions different api objects', () => {
    let folder = createFolder()
    let extA = path.join(folder, 'ext-a')
    let extB = path.join(folder, 'ext-b')
    let entryA = writeModule(extA, 'index.js', "module.exports = require('coc.nvim')")
    let entryB = writeModule(extB, 'index.js', "module.exports = require('coc.nvim')")
    let index = new ExtensionPathIndex()
    index.update([
      createModuleDescription('a', extA, entryA),
      createModuleDescription('b', extB, entryB)
    ])
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize({ workspace: {} })
    let interceptor = new CocModuleInterceptor(index, factory, folder)
    interceptor.install()
    try {
      let apiA = require(entryA)
      let apiB = require(entryB)
      assert.notStrictEqual(apiA, apiB)
    } finally {
      interceptor.dispose()
      for (let key of Object.keys(require.cache)) {
        if (key.startsWith(folder)) delete require.cache[key]
      }
    }
  })

  it('should resolve dependency under extension node_modules', () => {
    let folder = createFolder()
    let extDir = path.join(folder, 'ext')
    let entry = writeModule(extDir, 'index.js', "module.exports = require('dep')")
    writeModule(path.join(extDir, 'node_modules', 'dep'), 'index.js', "module.exports = require('coc.nvim')")
    let index = new ExtensionPathIndex()
    index.update([createModuleDescription('ext', extDir, entry)])
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize({ workspace: {} })
    let interceptor = new CocModuleInterceptor(index, factory, folder)
    interceptor.install()
    try {
      let api = require(entry) as any
      assert.strictEqual(typeof api.workspace, 'object')
    } finally {
      interceptor.dispose()
      for (let key of Object.keys(require.cache)) {
        if (key.startsWith(folder)) delete require.cache[key]
      }
    }
  })

  it('should return core api for coc.nvim-owned modules', () => {
    let folder = createFolder()
    let coreDir = path.join(folder, 'core')
    let coreFile = writeModule(coreDir, 'core.js', "module.exports = require('coc.nvim')")
    let index = new ExtensionPathIndex()
    let core = { workspace: { name: 'core' } }
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize(core)
    let interceptor = new CocModuleInterceptor(index, factory, coreDir)
    interceptor.install()
    try {
      assert.strictEqual(require(coreFile), core)
    } finally {
      interceptor.dispose()
      for (let key of Object.keys(require.cache)) {
        if (key.startsWith(folder)) delete require.cache[key]
      }
    }
  })

  it('should fail clearly for unknown callers', () => {
    let folder = createFolder()
    let outside = path.join(folder, 'outside')
    let file = writeModule(outside, 'unknown.js', "module.exports = require('coc.nvim')")
    let index = new ExtensionPathIndex()
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize({ workspace: {} })
    let interceptor = new CocModuleInterceptor(index, factory, path.join(folder, 'core'))
    interceptor.install()
    try {
      assert.throws(() => require(file), /Cannot resolve "coc\.nvim" API owner/)
    } finally {
      interceptor.dispose()
      for (let key of Object.keys(require.cache)) {
        if (key.startsWith(folder)) delete require.cache[key]
      }
    }
  })

  it('should fail clearly when parent module is missing', () => {
    let folder = createFolder()
    let index = new ExtensionPathIndex()
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize({ workspace: {} })
    let interceptor = new CocModuleInterceptor(index, factory, folder)
    interceptor.install()
    try {
      assert.throws(() => (Module as any)._load('coc.nvim', undefined, false), /parent module is missing/)
    } finally {
      interceptor.dispose()
    }
  })

  it('should delegate non-coc requests unchanged', () => {
    let folder = createFolder()
    let dep = writeModule(folder, 'dep.js', "module.exports = { ok: true }")
    let entry = writeModule(folder, 'entry.js', "module.exports = require('./dep')")
    let index = new ExtensionPathIndex()
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize({ workspace: {} })
    let interceptor = new CocModuleInterceptor(index, factory, folder)
    interceptor.install()
    try {
      assert.deepStrictEqual(require(entry), { ok: true })
    } finally {
      interceptor.dispose()
      for (let key of Object.keys(require.cache)) {
        if (key.startsWith(folder)) delete require.cache[key]
      }
    }
  })

  it('should not corrupt Module._load after a failed load', () => {
    let folder = createFolder()
    let outside = path.join(folder, 'outside')
    let file = writeModule(outside, 'unknown.js', "module.exports = require('coc.nvim')")
    let dep = writeModule(folder, 'dep.js', "module.exports = 1")
    let index = new ExtensionPathIndex()
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize({ workspace: {} })
    let interceptor = new CocModuleInterceptor(index, factory, path.join(folder, 'core'))
    let original = (Module as any)._load
    interceptor.install()
    try {
      assert.throws(() => require(file), /Cannot resolve/)
      assert.notStrictEqual((Module as any)._load, original)
      assert.strictEqual(require(dep), 1)
    } finally {
      interceptor.dispose()
      for (let key of Object.keys(require.cache)) {
        if (key.startsWith(folder)) delete require.cache[key]
      }
    }
  })

  it('should restore only its own wrapper on dispose', () => {
    let folder = createFolder()
    let index = new ExtensionPathIndex()
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize({ workspace: {} })
    let first = new CocModuleInterceptor(index, factory, folder)
    first.install()
    first.dispose()
    let original = (Module as any)._load
    let fake = function fakeLoad(this: unknown, request: string, parent: NodeModule | undefined, isMain: boolean): unknown {
      return (Module as any)._load.original.apply(this, arguments)
    }
    ;(fake as any).original = original
    ;(Module as any)._load = fake
    let second = new CocModuleInterceptor(index, factory, folder)
    second.install()
    second.dispose()
    assert.strictEqual((Module as any)._load, fake)
    ;(Module as any)._load = original
  })
})

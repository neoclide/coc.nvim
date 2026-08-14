import { createRequire } from 'node:module'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ExtensionLoadError, getModuleType, loadExtensionModule, loadExtensionModuleAsync, normalizeExtensionExports } from '../../extension/moduleLoader'
import { createModuleDescription } from '../../extension/pathIndex'

let folders: string[] = []

function createFolder(): string {
  let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-loader-'))
  folders.push(folder)
  return folder
}

function writeEntry(folder: string, content: string, name = 'index.js'): string {
  let file = path.join(folder, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

after(() => {
  for (let folder of folders) {
    for (let key of Object.keys(require.cache)) {
      if (key.startsWith(folder)) delete require.cache[key]
    }
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

const require = createRequire(import.meta.url)

describe('normalizeExtensionExports', () => {
  it('should treat a function export as activate', () => {
    let fn = () => {}
    assert.deepStrictEqual(normalizeExtensionExports(fn), { activate: fn })
  })

  it('should copy object exports with activate', () => {
    let activate = () => {}
    let deactivate = () => {}
    let res = normalizeExtensionExports({ activate, deactivate, extra: 1 })
    assert.strictEqual(res.activate, activate)
    assert.strictEqual(res.deactivate, deactivate)
    assert.strictEqual(res.extra, 1)
  })

  it('should return no-op activate for empty object', () => {
    let res = normalizeExtensionExports({})
    assert.strictEqual(typeof res.activate, 'function')
    assert.strictEqual(res.activate!(undefined), undefined)
    assert.strictEqual(res.deactivate, undefined)
  })

  it('should return no-op activate for invalid values', () => {
    for (const raw of [42, null, undefined, 'text', true]) {
      let res = normalizeExtensionExports(raw)
      assert.strictEqual(typeof res.activate, 'function')
    }
  })

  it('should return no-op activate when object activate is not a function', () => {
    let res = normalizeExtensionExports({ activate: 42 })
    assert.strictEqual(typeof res.activate, 'function')
    assert.strictEqual(res.deactivate, undefined)
  })

  it('should treat ESM default function export as activate', () => {
    let fn = () => {}
    let ns = { default: fn }
    Object.defineProperty(ns, Symbol.toStringTag, { value: 'Module' })
    let res = normalizeExtensionExports(ns)
    assert.strictEqual(res.activate, fn)
  })

  it('should treat ESM default object export with activate as activate', () => {
    let activate = () => {}
    let deactivate = () => {}
    let ns = { default: { activate, deactivate } }
    Object.defineProperty(ns, Symbol.toStringTag, { value: 'Module' })
    let res = normalizeExtensionExports(ns)
    assert.strictEqual(res.activate, activate)
    assert.strictEqual(res.deactivate, deactivate)
  })

  it('should treat ESM named activate export as activate', () => {
    let activate = () => {}
    let ns = { activate }
    Object.defineProperty(ns, Symbol.toStringTag, { value: 'Module' })
    let res = normalizeExtensionExports(ns)
    assert.strictEqual(res.activate, activate)
  })

  it('should prefer ESM named activate when default export is invalid', () => {
    let activate = () => {}
    let ns = { activate, default: null }
    Object.defineProperty(ns, Symbol.toStringTag, { value: 'Module' })
    let res = normalizeExtensionExports(ns)
    assert.strictEqual(res.activate, activate)
  })

  it('should preserve named deactivate with an ESM default function', () => {
    let activate = () => {}
    let deactivate = () => {}
    let ns = { default: activate, deactivate }
    Object.defineProperty(ns, Symbol.toStringTag, { value: 'Module' })
    let res = normalizeExtensionExports(ns)
    assert.strictEqual(res.activate, activate)
    assert.strictEqual(res.deactivate, deactivate)
  })

  it('should return no-op activate for ESM namespace without activate', () => {
    let ns = { default: {} }
    Object.defineProperty(ns, Symbol.toStringTag, { value: 'Module' })
    let res = normalizeExtensionExports(ns)
    assert.strictEqual(typeof res.activate, 'function')
  })
})

describe('getModuleType', () => {
  it('should detect by file extension', () => {
    assert.strictEqual(getModuleType({}, '/ext/index.mjs'), 'module')
    assert.strictEqual(getModuleType({}, '/ext/index.cjs'), 'commonjs')
    assert.strictEqual(getModuleType({}, '/ext/index.js'), 'commonjs')
  })

  it('should detect by package.json type for .js entries', () => {
    assert.strictEqual(getModuleType({ type: 'module' }, '/ext/index.js'), 'module')
    assert.strictEqual(getModuleType({ type: 'commonjs' }, '/ext/index.js'), 'commonjs')
    assert.strictEqual(getModuleType(undefined, '/ext/index.js'), 'commonjs')
    // explicit extension wins over package type
    assert.strictEqual(getModuleType({ type: 'module' }, '/ext/index.cjs'), 'commonjs')
  })

  it('should use the nearest package.json type for nested entries', async () => {
    let folder = createFolder()
    let nested = path.join(folder, 'dist')
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ type: 'commonjs' }))
    fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({ type: 'module' }))
    let entry = writeEntry(nested, "await Promise.resolve()\nexport function activate() { return 'nested-esm' }")
    let moduleType = getModuleType({ type: 'commonjs' }, entry)
    assert.strictEqual(moduleType, 'module')
    let ext = await loadExtensionModuleAsync(createModuleDescription('nested-esm', folder, entry, moduleType))
    assert.strictEqual(ext.activate(undefined), 'nested-esm')
  })
})

describe('loadExtensionModule', () => {
  it('should load a function export entry', () => {
    let folder = createFolder()
    let entry = writeEntry(folder, "module.exports = function activate() { return 'ok' }")
    let desc = createModuleDescription('fn', folder, entry)
    let ext = loadExtensionModule(desc)
    assert.strictEqual(typeof ext.activate, 'function')
    assert.strictEqual(ext.activate!(undefined), 'ok')
  })

  it('should load named activate and deactivate exports', () => {
    let folder = createFolder()
    let entry = writeEntry(folder, "exports.activate = () => 1\nexports.deactivate = () => 2")
    let desc = createModuleDescription('named', folder, entry)
    let ext = loadExtensionModule(desc)
    assert.strictEqual(typeof ext.activate, 'function')
    assert.strictEqual(typeof ext.deactivate, 'function')
  })

  it('should preserve extra exports', () => {
    let folder = createFolder()
    let entry = writeEntry(folder, "exports.activate = () => {}\nexports.helper = () => 'h'")
    let desc = createModuleDescription('extra', folder, entry)
    let ext = loadExtensionModule(desc)
    assert.strictEqual(ext.helper(), 'h')
  })

  it('should wrap missing entry errors with cause', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'missing.js')
    let desc = createModuleDescription('missing', folder, entry)
    assert.throws(() => loadExtensionModule(desc), (err: Error) => {
      assert.ok(err instanceof ExtensionLoadError)
      assert.strictEqual((err as ExtensionLoadError).extensionId, 'missing')
      assert.ok((err as any).cause instanceof Error)
      return true
    })
  })

  it('should preserve original error as cause when entry throws', () => {
    let folder = createFolder()
    let entry = writeEntry(folder, "throw new Error('entry boom')")
    let desc = createModuleDescription('throw', folder, entry)
    assert.throws(() => loadExtensionModule(desc), (err: Error) => {
      assert.ok(err instanceof ExtensionLoadError)
      assert.match(String((err as any).cause), /entry boom/)
      return true
    })
  })

  it('should preserve dependency error as cause', () => {
    let folder = createFolder()
    writeEntry(folder, "throw new Error('dep boom')", 'dep.js')
    let entry = writeEntry(folder, "require('./dep')")
    let desc = createModuleDescription('dep-throw', folder, entry)
    assert.throws(() => loadExtensionModule(desc), (err: Error) => {
      assert.ok(err instanceof ExtensionLoadError)
      assert.match(String((err as any).cause), /dep boom/)
      return true
    })
  })

  it('should load circular dependencies like node', () => {
    let folder = createFolder()
    writeEntry(folder, "exports.loaded = 'a'\nlet b = require('./b')\nexports.activate = () => b.value", 'a.js')
    writeEntry(folder, "let a = require('./a')\nexports.value = a.loaded", 'b.js')
    let entry = path.join(folder, 'a.js')
    let desc = createModuleDescription('circular', folder, entry)
    let ext = loadExtensionModule(desc)
    assert.strictEqual(ext.activate!(undefined), 'a')
  })

  it('should load a valid extension after a failed one', () => {
    let folder = createFolder()
    let bad = writeEntry(folder, "throw new Error('boom')", 'bad.js')
    let good = writeEntry(folder, "exports.activate = () => ({ hello: 'world' })", 'good.js')
    let badDesc = createModuleDescription('bad', folder, bad)
    let goodDesc = createModuleDescription('good', folder, good)
    assert.throws(() => loadExtensionModule(badDesc), (err: Error) => {
      assert.match(String((err as any).cause), /boom/)
      return true
    })
    let ext = loadExtensionModule(goodDesc)
    assert.deepStrictEqual(ext.activate!(undefined), { hello: 'world' })
  })

  it('should load an extension that requires JSON', () => {
    let folder = createFolder()
    writeEntry(folder, '{ "answer": 42 }', 'data.json')
    let entry = writeEntry(folder, "let data = require('./data.json')\nexports.activate = () => data")
    let desc = createModuleDescription('json', folder, entry)
    let ext = loadExtensionModule(desc)
    assert.deepStrictEqual(ext.activate!(undefined), { answer: 42 })
  })

  it('should load an extension entry through a symlinked root', () => {
    let folder = createFolder()
    let real = path.join(folder, 'real')
    let linked = path.join(folder, 'linked')
    fs.mkdirSync(real, { recursive: true })
    let entry = writeEntry(real, "exports.activate = () => ({ symlink: true })")
    try {
      fs.symlinkSync(real, linked, 'dir')
    } catch (e) {
      return
    }
    let desc = createModuleDescription('sym', linked, path.join(linked, 'index.js'))
    let ext = loadExtensionModule(desc)
    assert.deepStrictEqual(ext.activate!(undefined), { symlink: true })
  })

  it('should load an ESM entry through native import', async () => {
    let folder = createFolder()
    let entry = writeEntry(folder, "export function activate() { return { esm: true } }", 'index.mjs')
    let desc = createModuleDescription('esm', folder, entry, 'module')
    let ext = await loadExtensionModuleAsync(desc)
    assert.deepStrictEqual(ext.activate!(undefined), { esm: true })
  })

  it('should load an ESM default function entry', async () => {
    let folder = createFolder()
    let entry = writeEntry(folder, "export default function activate() { return { esm: true } }", 'index.mjs')
    let desc = createModuleDescription('esm-default', folder, entry, 'module')
    let ext = await loadExtensionModuleAsync(desc)
    assert.deepStrictEqual(ext.activate!(undefined), { esm: true })
  })

  it('should preserve ESM entry error as cause', async () => {
    let folder = createFolder()
    let entry = writeEntry(folder, "throw new Error('esm boom')", 'index.mjs')
    let desc = createModuleDescription('esm-throw', folder, entry, 'module')
    await assert.rejects(() => loadExtensionModuleAsync(desc), (err: Error) => {
      assert.ok(err instanceof ExtensionLoadError)
      assert.match(String((err as any).cause), /esm boom/)
      return true
    })
  })
})

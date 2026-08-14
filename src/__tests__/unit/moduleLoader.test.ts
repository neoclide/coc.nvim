import { createRequire } from 'node:module'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ExtensionLoadError, loadExtensionModule, normalizeExtensionExports } from '../../extension/moduleLoader'
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
})

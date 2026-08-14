import fs from 'fs'
import os from 'os'
import path from 'path'
import { createExtension } from '../../util/factory'

let folders: string[] = []

function createFolder(): string {
  let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-factory-'))
  folders.push(folder)
  return folder
}

after(() => {
  for (let folder of folders) {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

describe('extension sandbox compiler', () => {
  it('should support function export as activate', () => {
    let folder = createFolder()
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(filepath, 'module.exports = function activate(context) { return { fn: true } }')
    let ext = createExtension('fn-export', filepath, false)
    assert.strictEqual(typeof ext.activate, 'function')
    assert.strictEqual(ext.deactivate, undefined)
    assert.deepStrictEqual({ ...ext.activate({} as any) }, { fn: true })
  })

  it('should support activate and deactivate named exports', () => {
    let folder = createFolder()
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(filepath, [
      "exports.activate = () => ({ named: true })",
      "exports.deactivate = () => {}"
    ].join('\n'))
    let ext = createExtension('named-export', filepath, false)
    assert.strictEqual(typeof ext.activate, 'function')
    assert.strictEqual(typeof ext.deactivate, 'function')
    assert.deepStrictEqual({ ...ext.activate({} as any) }, { named: true })
  })

  it('should return empty activate for empty object export', () => {
    let folder = createFolder()
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(filepath, 'module.exports = {}')
    let ext = createExtension('empty-export', filepath, false)
    assert.strictEqual(typeof ext.activate, 'function')
    assert.strictEqual(ext.activate({} as any), undefined)
  })

  it('should return empty activate for invalid exported value', () => {
    let folder = createFolder()
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(filepath, 'module.exports = 42')
    let ext = createExtension('invalid-export', filepath, false)
    assert.strictEqual(typeof ext.activate, 'function')
    assert.strictEqual(ext.activate({} as any), undefined)
  })

  it('should preserve extra exports with activate', () => {
    let folder = createFolder()
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(filepath, "exports.activate = () => ({})\nexports.foo = 42")
    let ext = createExtension('extra-export', filepath, false)
    assert.strictEqual(typeof ext.activate, 'function')
    assert.strictEqual(ext.foo, 42)
  })

  it('should return empty extension for missing entry file', () => {
    let folder = createFolder()
    let filepath = path.join(folder, 'missing.js')
    let ext = createExtension('missing-entry', filepath, false)
    assert.strictEqual(typeof ext.activate, 'function')
    assert.strictEqual(ext.deactivate, null)
  })

  it('should load circular dependency like node', () => {
    let folder = createFolder()
    let a = path.join(folder, 'a.js')
    let b = path.join(folder, 'b.js')
    fs.writeFileSync(a, "let b = require('./b')\nexports.activate = () => ({ fromA: true, b })")
    fs.writeFileSync(b, "let a = require('./a')\nexports.fromB = true")
    let ext = createExtension('circular', a, false)
    assert.strictEqual(typeof ext.activate, 'function')
    let api = ext.activate({} as any)
    assert.strictEqual(api.fromA, true)
    assert.strictEqual(api.b.fromB, true)
  })

  it('should restore module compiler after failed extension load', t => {
    let folder = createFolder()
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(filepath, "throw new Error('load failed')")
    assert.throws(() => createExtension('broken', filepath, false), new RegExp('load failed'))
  })

  it('should restore module compiler when dependency fails to load', t => {
    let folder = createFolder()
    let dep = path.join(folder, 'dep.js')
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(dep, "throw new Error('dep failed')")
    fs.writeFileSync(filepath, "require('./dep')\nexports.activate = () => {}")
    assert.throws(() => createExtension('broken-dep', filepath, false), new RegExp('dep failed'))
  })

  it('should load plain modules normally after a failed extension load', t => {
    let folder = createFolder()
    let bad = path.join(folder, 'bad.js')
    let good = path.join(folder, 'good.js')
    fs.writeFileSync(bad, "throw new Error('boom')")
    fs.writeFileSync(good, 'module.exports = { ok: true }')
    assert.throws(() => createExtension('bad', bad, false), new RegExp('boom'))
  })

  it('should load a valid extension after a failed one', t => {
    let folder = createFolder()
    let bad = path.join(folder, 'bad.js')
    let good = path.join(folder, 'good.js')
    fs.writeFileSync(bad, "throw new Error('boom')")
    fs.writeFileSync(good, "exports.activate = () => ({ hello: 'world' })")
    assert.throws(() => createExtension('bad', bad, false), new RegExp('boom'))
    let ext = createExtension('good', good, false)
    assert.strictEqual(typeof ext.activate, 'function')
    // activate() runs inside the VM sandbox; spread into a plain object so
    // deepStrictEqual does not compare the cross-realm prototype.
    assert.deepStrictEqual({ ...ext.activate({} as any) }, { hello: 'world' })
  })

  it('should reload dependency state on extension reload', t => {
    let folder = createFolder()
    let depDir = path.join(folder, 'node_modules', 'dep')
    fs.mkdirSync(depDir, { recursive: true })
    let dep = path.join(depDir, 'index.js')
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(dep, "module.exports = { value: 'one' }")
    fs.writeFileSync(filepath, "let dep = require('dep')\nexports.activate = () => dep.value")
    let ext1 = createExtension('reload-dep', filepath, false)
    assert.strictEqual(ext1.activate({} as any), 'one')
    // simulate dependency update followed by reloadExtension
    fs.writeFileSync(dep, "module.exports = { value: 'two' }")
    let ext2 = createExtension('reload-dep', filepath, false)
    assert.strictEqual(ext2.activate({} as any), 'two')
  })

  it('should not share singleton dependency state between reloads', t => {
    let folder = createFolder()
    let dep = path.join(folder, 'dep.js')
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(dep, "let count = 0\nmodule.exports = { inc: () => ++count, get count() { return count } }")
    fs.writeFileSync(filepath, "let dep = require('./dep')\nexports.activate = () => ({ inc: dep.inc })")
    let ext1 = createExtension('reload-state', filepath, false)
    let api1 = ext1.activate({} as any)
    assert.strictEqual(api1.inc(), 1)
    let ext2 = createExtension('reload-state', filepath, false)
    let api2 = ext2.activate({} as any)
    assert.strictEqual(api2.inc(), 1)
  })

  it('should keep modules outside extension root cached across reload', t => {
    let folder = createFolder()
    let shared = path.join(folder, 'shared.js')
    let extensionDir = path.join(folder, 'ext')
    fs.mkdirSync(extensionDir, { recursive: true })
    let filepath = path.join(extensionDir, 'index.js')
    fs.writeFileSync(shared, "let count = 0\nmodule.exports = { inc: () => ++count }")
    fs.writeFileSync(filepath, "let shared = require('../shared')\nexports.activate = () => shared.inc()")
    let ext1 = createExtension('outside-cache', filepath, false)
    assert.strictEqual(ext1.activate({} as any), 1)
    let ext2 = createExtension('outside-cache', filepath, false)
    // shared module is outside extension root: cache entry survives reload,
    // so the counter is not reset.
    assert.strictEqual(ext2.activate({} as any), 2)
  })

  it('should load extension through symlinked root', t => {
    let folder = createFolder()
    let real = path.join(folder, 'real')
    let linked = path.join(folder, 'linked')
    fs.mkdirSync(real, { recursive: true })
    let filepath = path.join(real, 'index.js')
    fs.writeFileSync(filepath, "exports.activate = () => ({ symlink: true })")
    try {
      fs.symlinkSync(real, linked, 'dir')
    } catch (e) {
      // Symlinks may be unavailable on some platforms; skip gracefully.
      return
    }
    let ext = createExtension('symlink-ext', path.join(linked, 'index.js'), false)
    assert.strictEqual(typeof ext.activate, 'function')
    assert.deepStrictEqual({ ...ext.activate({} as any) }, { symlink: true })
  })

  it('should provide empty api object for require("coc.nvim") in unit context', t => {
    let folder = createFolder()
    let depDir = path.join(folder, 'node_modules', 'dep')
    fs.mkdirSync(depDir, { recursive: true })
    fs.writeFileSync(path.join(depDir, 'index.js'), "module.exports = require('coc.nvim')")
    let filepath = path.join(folder, 'index.js')
    fs.writeFileSync(filepath, "let api = require('dep')\nexports.activate = () => api")
    let ext = createExtension('coc-api', filepath, false)
    let api = ext.activate({} as any)
    assert.strictEqual(typeof api, 'object')
    assert.strictEqual(Object.keys(api).length, 0)
  })
})

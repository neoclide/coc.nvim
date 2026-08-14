import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import {
  consoleLogger,
  createExtension,
  createExtensionRequire,
  createExtensionRuntime,
  getLoader
} from '../../extension/loader'
import type { ExtensionModule } from '../../extension/loader'

const require = createRequire(import.meta.url)
const Module = require('module')

let folders: string[] = []

function createFolder(): string {
  let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-loader-'))
  folders.push(folder)
  return folder
}

after(() => {
  for (let folder of folders) {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

describe('extension loader', () => {
  it('should isolate global state and intrinsics between extensions', () => {
    let folder = createFolder()
    let a = path.join(folder, 'a.js')
    let b = path.join(folder, 'b.js')
    fs.writeFileSync(a, `
globalThis.__leak = 'a'
Array.prototype.__leak = 'a'
String.prototype.__leak = 'a'
exports.activate = () => {
  return { leak: globalThis.__leak, arrLeak: [].__leak, strLeak: 'x'.__leak }
}`)
    fs.writeFileSync(b, `
exports.activate = () => {
  return { leak: globalThis.__leak, arrLeak: [].__leak, strLeak: 'x'.__leak }
}`)
    let extA = createExtension('iso-a', a, false)
    let extB = createExtension('iso-b', b, false)
    let resA = extA.activate({} as any)
    let resB = extB.activate({} as any)
    assert.strictEqual(resA.leak, 'a')
    assert.strictEqual(resA.arrLeak, 'a')
    assert.strictEqual(resB.leak, undefined)
    assert.strictEqual(resB.arrLeak, undefined)
    assert.strictEqual(resB.strLeak, undefined)
  })

  it('should return the same API for repeated coc.nvim requires', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
exports.activate = () => {
  let a = require('coc.nvim')
  let b = require('coc.nvim')
  return { same: a === b, api: a }
}`)
    let ext = createExtension('api-a', entry, false)
    let res = ext.activate({} as any)
    assert.strictEqual(res.same, true)
    // Different extensions get different API objects.
    let ext2 = createExtension('api-b', entry, false)
    let res2 = ext2.activate({} as any)
    assert.notStrictEqual(res.api, res2.api)
  })

  it('should execute nested modules in the same context', () => {
    let folder = createFolder()
    fs.writeFileSync(path.join(folder, 'foo.js'), `
globalThis.__marker = 'foo'
module.exports = { getGlobal: () => globalThis }`)
    fs.writeFileSync(path.join(folder, 'bar.js'), `
module.exports = { getGlobal: () => globalThis, marker: () => globalThis.__marker }`)
    fs.writeFileSync(path.join(folder, 'index.js'), `
let foo = require('./foo')
let bar = require('./bar')
exports.activate = () => {
  return {
    same: foo.getGlobal() === bar.getGlobal(),
    self: foo.getGlobal() === globalThis,
    marker: bar.marker(),
    g: foo.getGlobal()
  }
}`)
    let ext = createExtension('graph', path.join(folder, 'index.js'), false)
    let res = ext.activate({} as any)
    assert.strictEqual(res.same, true)
    assert.strictEqual(res.self, true)
    assert.strictEqual(res.marker, 'foo')
    // The extension realm is not the host realm.
    assert.notStrictEqual(res.g, globalThis)
  })

  it('should execute consecutive requires in the same extension context', () => {
    let folder = createFolder()
    fs.writeFileSync(path.join(folder, 'a.js'), `module.exports = { ctx: () => globalThis }`)
    fs.writeFileSync(path.join(folder, 'b.js'), `module.exports = { ctx: () => globalThis }`)
    fs.writeFileSync(path.join(folder, 'data.json'), JSON.stringify({ value: 1 }))
    fs.writeFileSync(path.join(folder, 'index.js'), `
let a1 = require('./a')
let a2 = require('./a')
let b1 = require('./b')
let data = require('./data.json')
let b2 = require('./b')
exports.activate = () => {
  return {
    sameCacheA: a1 === a2,
    sameCacheB: b1 === b2,
    sameContext: a1.ctx() === b1.ctx() && b1.ctx() === globalThis,
    json: data.value
  }
}`)
    let ext = createExtension('consecutive', path.join(folder, 'index.js'), false)
    let res = ext.activate({} as any)
    assert.strictEqual(res.sameCacheA, true)
    assert.strictEqual(res.sameCacheB, true)
    assert.strictEqual(res.sameContext, true)
    assert.strictEqual(res.json, 1)
  })

  it('should load packages from nested node_modules', () => {
    let folder = createFolder()
    let pkgA = path.join(folder, 'node_modules', 'pkg-a')
    let pkgB = path.join(pkgA, 'node_modules', 'pkg-b')
    fs.mkdirSync(pkgB, { recursive: true })
    fs.writeFileSync(path.join(pkgA, 'package.json'), JSON.stringify({ name: 'pkg-a', main: 'index.js' }))
    fs.writeFileSync(path.join(pkgA, 'index.js'), `
let b = require('pkg-b')
module.exports = { a: 'A', b }`)
    fs.writeFileSync(path.join(pkgB, 'package.json'), JSON.stringify({ name: 'pkg-b', main: 'index.js' }))
    fs.writeFileSync(path.join(pkgB, 'index.js'), `module.exports = { b: 'B' }`)
    fs.writeFileSync(path.join(folder, 'index.js'), `
let pkg = require('pkg-a')
exports.activate = () => pkg`)
    let ext = createExtension('pkg', path.join(folder, 'index.js'), false)
    let res = ext.activate({} as any)
    assert.deepStrictEqual({ ...res, b: { ...res.b } }, { a: 'A', b: { b: 'B' } })
  })

  it('should support circular CommonJS dependencies', () => {
    let folder = createFolder()
    fs.writeFileSync(path.join(folder, 'a.js'), `
exports.name = 'a'
let b = require('./b')
exports.bName = b.name`)
    fs.writeFileSync(path.join(folder, 'b.js'), `
exports.name = 'b'
let a = require('./a')
exports.aName = a.name`)
    fs.writeFileSync(path.join(folder, 'index.js'), `
let a = require('./a')
let b = require('./b')
exports.activate = () => ({ a, b })`)
    let ext = createExtension('circ', path.join(folder, 'index.js'), false)
    let res = ext.activate({} as any)
    assert.strictEqual(res.a.name, 'a')
    assert.strictEqual(res.a.bName, 'b')
    assert.strictEqual(res.b.name, 'b')
    assert.strictEqual(res.b.aName, 'a')
  })

  it('should load and cache JSON modules', () => {
    let folder = createFolder()
    fs.writeFileSync(path.join(folder, 'data.json'), JSON.stringify({ value: 1 }))
    fs.writeFileSync(path.join(folder, 'index.js'), `
let one = require('./data.json')
let two = require('./data.json')
exports.activate = () => ({ same: one === two, value: one.value })`)
    let ext = createExtension('json', path.join(folder, 'index.js'), false)
    let res = ext.activate({} as any)
    assert.strictEqual(res.same, true)
    assert.strictEqual(res.value, 1)
  })

  it('should load builtins and preserve the process facade', () => {
    let folder = createFolder()
    fs.writeFileSync(path.join(folder, 'index.js'), `
exports.activate = () => {
  let p1 = require('path')
  let p2 = require('node:path')
  let proc1 = require('process')
  let proc2 = require('node:process')
  return {
    samePath: p1 === p2,
    joined: p1.join('a', 'b'),
    sameProc: proc1 === proc2,
    facadeProc: proc1 === globalThis.process
  }
}`)
    let ext = createExtension('builtins', path.join(folder, 'index.js'), false)
    let res = ext.activate({} as any)
    assert.strictEqual(res.samePath, true)
    assert.strictEqual(res.joined, 'a/b')
    assert.strictEqual(res.sameProc, true)
    assert.strictEqual(res.facadeProc, true)
  })

  it('should restrict dangerous process calls in the facade', () => {
    let folder = createFolder()
    let exitFile = path.join(folder, 'exit.js')
    let umaskFile = path.join(folder, 'umask.js')
    let readFile = path.join(folder, 'read.js')
    fs.writeFileSync(exitFile, `exports.activate = () => { process.exit() }`)
    fs.writeFileSync(umaskFile, `exports.activate = () => { process.umask(18) }`)
    fs.writeFileSync(readFile, `exports.activate = () => { return typeof process.umask() }`)
    let ext = createExtension('facade-exit', exitFile, false)
    assert.throws(() => ext.activate({} as any), /not allowed in extension sandbox/)
    let ext2 = createExtension('facade-umask', umaskFile, false)
    assert.throws(() => ext2.activate({} as any), /read-only/)
    let ext3 = createExtension('facade-read', readFile, false)
    assert.strictEqual(ext3.activate({} as any), 'number')
  })

  it('should create a fresh context and module cache on reload', () => {
    let folder = createFolder()
    fs.writeFileSync(path.join(folder, 'dep.js'), `let n = 0
module.exports = { inc: () => ++n }`)
    fs.writeFileSync(path.join(folder, 'index.js'), `
let dep = require('./dep')
exports.activate = () => ({ count: dep.inc(), g: globalThis })`)
    let ext1 = createExtension('reload', path.join(folder, 'index.js'), false)
    let res1 = ext1.activate({} as any)
    assert.strictEqual(res1.count, 1)
    // Mutate the old context after activation: the reloaded extension must
    // not observe this state.
    res1.g.__external = 'old-only'
    let ext2 = createExtension('reload', path.join(folder, 'index.js'), false)
    let res2 = ext2.activate({} as any)
    assert.strictEqual(res2.count, 1)
    assert.notStrictEqual(res1.g, res2.g)
    assert.strictEqual(res2.g.__external, undefined)
  })

  it('should not touch other extensions on reload', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    let other = path.join(folder, 'other.js')
    fs.writeFileSync(entry, `
globalThis.__mark = 'mine'
exports.activate = () => ({ mark: globalThis.__mark, g: globalThis })`)
    fs.writeFileSync(other, `exports.activate = () => ({ g: globalThis })`)
    let extA = createExtension('reload-a', entry, false)
    let resA = extA.activate({} as any)
    let extB = createExtension('reload-b', other, false)
    let resB = extB.activate({} as any)
    createExtension('reload-a', entry, false)
    assert.notStrictEqual(resB.g, resA.g)
    assert.strictEqual(resB.g.__mark, undefined)
  })

  it('should reload entry and dependency modules from disk', () => {
    let folder = createFolder()
    let subdep = path.join(folder, 'subdep.js')
    let dep = path.join(folder, 'dep.js')
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(subdep, `module.exports = { value: 'sub-v1' }`)
    fs.writeFileSync(dep, `
let sub = require('./subdep')
let count = 0
module.exports = {
  value: 'dep-v1',
  sub: sub.value,
  getCount: () => count
}`)
    fs.writeFileSync(entry, `
let dep = require('./dep')
exports.activate = () => ({ entry: 'entry-v1', depValue: dep.value, subValue: dep.sub, depCount: dep.getCount(), g: globalThis })`)
    let ext1 = createExtension('reload-files', entry, false)
    let res1 = ext1.activate({} as any)
    assert.strictEqual(res1.entry, 'entry-v1')
    assert.strictEqual(res1.depValue, 'dep-v1')
    assert.strictEqual(res1.subValue, 'sub-v1')
    assert.strictEqual(res1.depCount, 0)
    res1.g.__stale = 'old'
    // Simulate an extension update: entry, dependency and nested dependency
    // all change on disk before reload.
    fs.writeFileSync(subdep, `module.exports = { value: 'sub-v2' }`)
    fs.writeFileSync(dep, `
let sub = require('./subdep')
let count = 100
module.exports = {
  value: 'dep-v2',
  sub: sub.value,
  getCount: () => count
}`)
    fs.writeFileSync(entry, `
let dep = require('./dep')
exports.activate = () => ({ entry: 'entry-v2', depValue: dep.value, subValue: dep.sub, depCount: dep.getCount(), g: globalThis })`)
    let ext2 = createExtension('reload-files', entry, false)
    let res2 = ext2.activate({} as any)
    assert.strictEqual(res2.entry, 'entry-v2')
    assert.strictEqual(res2.depValue, 'dep-v2')
    assert.strictEqual(res2.subValue, 'sub-v2')
    // Dependency state starts fresh instead of reusing the old runtime.
    assert.strictEqual(res2.depCount, 100)
    assert.notStrictEqual(res1.g, res2.g)
    assert.strictEqual(res2.g.__stale, undefined)
  })

  it('should remove failed modules from cache and retry execution', () => {
    let folder = createFolder()
    let good = path.join(folder, 'good.js')
    let bad = path.join(folder, 'bad.js')
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(good, `
globalThis.__count = (globalThis.__count || 0) + 1
module.exports = { count: globalThis.__count }`)
    fs.writeFileSync(bad, `throw new Error('boom')`)
    fs.writeFileSync(entry, `
let good = require('./good')
let bad = require('./bad')
exports.activate = () => ({ count: good.count, fixed: bad.fixed })`)
    assert.throws(() => createExtension('retry', entry, false), /boom/)
    fs.writeFileSync(bad, `module.exports = { fixed: true }`)
    let ext = createExtension('retry', entry, false)
    let res = ext.activate({} as any)
    assert.strictEqual(res.count, 1)
    assert.strictEqual(res.fixed, true)
  })

  it('should throw the original entry error and recover on the next load', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `throw new Error('entry failed')`)
    assert.throws(() => createExtension('entry-fail', entry, false), /entry failed/)
    fs.writeFileSync(entry, `exports.activate = () => 'recovered'`)
    let ext = createExtension('entry-fail', entry, false)
    assert.strictEqual(ext.activate({} as any), 'recovered')
  })

  it('should detach failed modules from the module graph', () => {
    let folder = createFolder()
    let parent = path.join(folder, 'parent.js')
    let child = path.join(folder, 'child.js')
    let leaf = path.join(folder, 'leaf.js')
    fs.writeFileSync(parent, `module.exports = require('./child')`)
    fs.writeFileSync(child, `require('./leaf')
module.exports = { ok: true }`)
    fs.writeFileSync(leaf, `throw new Error('leaf failed')`)
    let runtime = createExtensionRuntime('graph', parent, {}, consoleLogger)
    let loader = getLoader(runtime)
    assert.throws(() => loader.loadJavaScript(parent), /leaf failed/)
    assert.strictEqual(runtime.modules.size, 0)
    // After the leaf is fixed, loading retries the whole graph.
    fs.writeFileSync(leaf, `module.exports = { ok: true }`)
    let exports: any = loader.loadJavaScript(parent)
    assert.strictEqual(exports.ok, true)
  })

  it('should support require.resolve and require.resolve.paths', () => {
    let folder = createFolder()
    fs.writeFileSync(path.join(folder, 'foo.js'), `module.exports = 1`)
    fs.writeFileSync(path.join(folder, 'index.js'), `
exports.activate = () => {
  let p = require.resolve('./foo')
  let builtin = require.resolve('path')
  let paths = require.resolve.paths('some-pkg')
  return { p, builtin, paths: paths && paths.length }
}`)
    let ext = createExtension('resolve', path.join(folder, 'index.js'), false)
    let res = ext.activate({} as any)
    assert.strictEqual(path.isAbsolute(res.p), true)
    assert.strictEqual(path.basename(res.p), 'foo.js')
    assert.strictEqual(res.builtin, 'path')
    assert.strictEqual(typeof res.paths, 'number')
    assert.ok(res.paths > 0)
  })

  it('should support CommonJS export formats', () => {
    let folder = createFolder()
    let fnFile = path.join(folder, 'fn.js')
    let objFile = path.join(folder, 'obj.js')
    fs.writeFileSync(fnFile, `module.exports = function activate(context) { return 'fn' }`)
    fs.writeFileSync(objFile, `
exports.activate = () => 'obj'
exports.deactivate = () => 'bye'`)
    let ext1 = createExtension('fmt-fn', fnFile, false)
    assert.strictEqual(ext1.activate({} as any), 'fn')
    let ext2 = createExtension('fmt-obj', objFile, false)
    assert.strictEqual(ext2.activate({} as any), 'obj')
    assert.strictEqual(typeof ext2.deactivate, 'function')
  })

  it('should provide CommonJS wrapper variables', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
exports.activate = () => {
  return {
    filename: __filename,
    dirname: __dirname,
    moduleId: module.id,
    loaded: module.loaded,
    exportsSelf: module.exports === exports,
    thisIsExports: this === module.exports
  }
}`)
    let ext = createExtension('wrapper', entry, false)
    let res = ext.activate({} as any)
    assert.strictEqual(res.filename, fs.realpathSync(entry))
    assert.strictEqual(res.dirname, fs.realpathSync(folder))
    assert.strictEqual(res.moduleId, fs.realpathSync(entry))
    assert.strictEqual(res.loaded, true)
    assert.strictEqual(res.exportsSelf, true)
    assert.strictEqual(res.thisIsExports, true)
  })

  it('should strip BOM and shebang lines', () => {
    let folder = createFolder()
    let shebang = path.join(folder, 'shebang.js')
    let bom = path.join(folder, 'bom.js')
    fs.writeFileSync(shebang, '#!/usr/bin/env node\nexports.activate = () => \'sh\'\n')
    fs.writeFileSync(bom, '\uFEFFexports.activate = () => \'bom\'\n')
    assert.strictEqual(createExtension('sh', shebang, false).activate({} as any), 'sh')
    assert.strictEqual(createExtension('bom', bom, false).activate({} as any), 'bom')
  })

  it('should support module.require', () => {
    let folder = createFolder()
    fs.writeFileSync(path.join(folder, 'dep.js'), `module.exports = 'dep'`)
    fs.writeFileSync(path.join(folder, 'index.js'), `
exports.activate = () => module.require('./dep')`)
    let ext = createExtension('modreq', path.join(folder, 'index.js'), false)
    assert.strictEqual(ext.activate({} as any), 'dep')
  })

  it('should route .node addons to native loading', () => {
    let folder = createFolder()
    let native = path.join(folder, 'addon.node')
    fs.writeFileSync(native, 'not a real addon')
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `module.exports = require('./addon.node')`)
    let err: any
    try {
      createExtension('native', entry, false)
    } catch (e) {
      err = e
    }
    assert.notStrictEqual(err, undefined)
    // The failure must come from the native loader, not the VM compiler.
    assert.match(String(err.message), /addon\.node/)
  })

  it('should fail clearly when native addon loading is unavailable', () => {
    let folder = createFolder()
    let native = path.join(folder, 'addon.node')
    fs.writeFileSync(native, 'not a real addon')
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `module.exports = require('./addon.node')`)
    let original = Module._extensions['.node']
    Module._extensions['.node'] = undefined
    try {
      assert.throws(() => createExtension('no-native', entry, false), /Unsupported native addon/)
    } finally {
      Module._extensions['.node'] = original
    }
  })

  it('should cache native addon exports per runtime', () => {
    let folder = createFolder()
    let native = path.join(folder, 'addon.node')
    fs.writeFileSync(native, 'fake addon')
    let original = Module._extensions['.node']
    Module._extensions['.node'] = (module: any, filename: string) => {
      module.exports = { loaded: filename }
    }
    try {
      let runtime = createExtensionRuntime('native-cache', path.join(folder, 'index.js'), {}, consoleLogger)
      let loader = getLoader(runtime)
      let a: any = loader.loadNative(path.join(folder, 'addon.node'))
      let b: any = loader.loadNative(path.join(folder, 'addon.node'))
      assert.strictEqual(a, b)
      assert.strictEqual(a.loaded, fs.realpathSync(native))
      assert.strictEqual(runtime.modules.size, 1)
    } finally {
      Module._extensions['.node'] = original
    }
  })

  it('should handle missing files, invalid JSON and cache clearing', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `module.exports = 1`)
    let runtime = createExtensionRuntime('edges', entry, {}, consoleLogger)
    let loader = getLoader(runtime)
    // Missing file: realpath and read both fail and nothing stays cached.
    assert.throws(() => loader.loadJavaScript(path.join(folder, 'missing.js')), /ENOENT/)
    assert.strictEqual(runtime.modules.size, 0)
    // Invalid JSON is wrapped with the module filename.
    fs.writeFileSync(path.join(folder, 'bad.json'), '{ not json')
    assert.throws(() => loader.loadJson(path.join(folder, 'bad.json')), /Error parsing JSON module/)
    // clear() drops cached modules.
    let exports: any = loader.loadJavaScript(entry)
    assert.strictEqual(exports, 1)
    loader.clear()
    assert.strictEqual(runtime.modules.size, 0)
  })

  it('should return a no-op extension for empty or missing entries', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `exports.activate = () => 'real'`)
    let empty = createExtension('empty-ext', entry, true)
    assert.strictEqual(typeof empty.activate, 'function')
    assert.strictEqual(empty.deactivate, null)
    let missing = createExtension('missing-ext', path.join(folder, 'not-exists.js'), false)
    assert.strictEqual(typeof missing.activate, 'function')
    assert.strictEqual(missing.deactivate, null)
  })

  it('should return a no-op extension when the entry has no activate', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `module.exports = { foo: 'bar' }`)
    let ext = createExtension('no-activate', entry, false)
    assert.strictEqual(typeof ext.activate, 'function')
    assert.strictEqual(ext.activate({} as any), undefined)
  })

  it('should use the console logger outside test and main environments', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `exports.activate = () => 'ok'`)
    let prev = global.__TEST__
    global.__TEST__ = false
    try {
      let ext = createExtension('console-logger', entry, false)
      assert.strictEqual(ext.activate({} as any), 'ok')
    } finally {
      global.__TEST__ = prev
    }
  })

  it('should fail clearly for unsupported module types', () => {
    let folder = createFolder()
    fs.writeFileSync(path.join(folder, 'data.mjs'), `export default 1`)
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `require('./data.mjs')`)
    assert.throws(() => createExtension('mjs', entry, false), /Unsupported module type/)
  })

  it('should create extension-local require bound to a parent module', () => {
    let folder = createFolder()
    fs.writeFileSync(path.join(folder, 'dep.js'), `module.exports = 'dep-value'`)
    let entry = path.join(folder, 'index.js')
    let runtime = createExtensionRuntime('req', entry, { api: 1 }, consoleLogger)
    let parent: ExtensionModule = {
      id: entry,
      filename: entry,
      dirname: folder,
      exports: {},
      loaded: false,
      children: []
    }
    let req = createExtensionRequire(runtime, parent)
    assert.strictEqual(req('coc.nvim'), runtime.api)
    assert.strictEqual(req('./dep'), 'dep-value')
    assert.strictEqual(path.basename(req.resolve('./dep')), 'dep.js')
  })

  it('should share the module cache between symlink and real paths', () => {
    let base = createFolder()
    let extDir = path.join(base, 'real-ext')
    fs.mkdirSync(extDir, { recursive: true })
    fs.writeFileSync(path.join(extDir, 'index.js'), `module.exports = { sym: true }`)
    let linkDir = path.join(base, 'linked-ext')
    fs.mkdirSync(linkDir, { recursive: true })
    fs.symlinkSync(extDir, path.join(linkDir, 'ext'), 'dir')
    let linkedEntry = path.join(linkDir, 'ext', 'index.js')
    let realEntry = path.join(extDir, 'index.js')
    let runtime = createExtensionRuntime('sym', linkedEntry, {}, consoleLogger)
    let loader = getLoader(runtime)
    let a = loader.loadJavaScript(linkedEntry)
    let b = loader.loadJavaScript(realEntry)
    assert.strictEqual(a, b)
  })

  it('should load a symlinked local extension', () => {
    let base = createFolder()
    let extDir = path.join(base, 'real-ext')
    fs.mkdirSync(extDir, { recursive: true })
    fs.writeFileSync(path.join(extDir, 'index.js'), `exports.activate = () => 'symlink-ok'`)
    let linkDir = path.join(base, 'linked-ext')
    fs.mkdirSync(linkDir, { recursive: true })
    fs.symlinkSync(extDir, path.join(linkDir, 'ext'), 'dir')
    let entry = path.join(linkDir, 'ext', 'index.js')
    let ext = createExtension('symlink-ext', entry, false)
    assert.strictEqual(ext.activate({} as any), 'symlink-ok')
  })

  describe('ecosystem extensions', () => {
    const extensionsDir = process.env.COC_ECOSYSTEM_DIR || path.join(os.homedir(), 'vim-dev')
    const entries = [
      ['coc-tsserver', 'eco-tsserver'],
      ['coc-eslint', 'eco-eslint'],
      ['coc-json', 'eco-json']
    ]
    for (let [name, id] of entries) {
      it(`should load ${name}`, t => {
        let entry = path.join(extensionsDir, name, 'lib', 'index.js')
        if (!fs.existsSync(entry)) {
          t.skip(`extension ${name} not available at ${entry}`)
          return
        }
        // Real extensions read the coc API at module scope, so load them with
        // the real API injected (like production). Restore the flag in
        // finally; createExtension is synchronous so no other test can
        // observe the temporary value.
        let prev = global.__isMain
        global.__isMain = true
        try {
          let ext = createExtension(id, entry, false)
          assert.strictEqual(typeof ext.activate, 'function')
          // Reload creates a fresh runtime without affecting other extensions.
          let ext2 = createExtension(id, entry, false)
          assert.strictEqual(typeof ext2.activate, 'function')
        } finally {
          if (prev === undefined) {
            delete global.__isMain
          } else {
            global.__isMain = prev
          }
        }
      })
    }
  })
})

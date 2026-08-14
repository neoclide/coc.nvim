import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { consoleLogger, createExtensionAsync, createExtensionRuntime, getLoader } from '../../extension/loader'
import type { ILogger } from '../../extension/loader'
import { loadESMEntry, resolveModuleFormat } from '../../extension/esm'

let folders: string[] = []

function createFolder(): string {
  let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-esm-'))
  folders.push(folder)
  return folder
}

after(() => {
  for (let folder of folders) {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

function write(folder: string, name: string, content: string): void {
  fs.writeFileSync(path.join(folder, name), content)
}

function makeLogger(): { logger: ILogger; calls: string[] } {
  let calls: string[] = []
  let record = (level: string) => (...args: any[]) => {
    calls.push(`${level}:${args.map(a => typeof a === 'string' ? a : String(a)).join(' ')}`)
  }
  let logger = {
    category: 'extension:esm-console',
    log: record('log'),
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    mark: record('mark')
  }
  return { logger, calls }
}

describe('esm extension loader', () => {
  it('should load a .mjs extension entry', async () => {
    let folder = createFolder()
    write(folder, 'index.mjs', `
let count = 0
export function activate() { return { n: ++count } }
export function deactivate() {}`)
    let ext = await createExtensionAsync('esm-entry', path.join(folder, 'index.mjs'), false)
    assert.deepStrictEqual({ ...ext.activate({}) }, { n: 1 })
    assert.strictEqual(typeof ext.deactivate, 'function')
  })

  it('should treat .js files under type=module as ESM', async () => {
    let folder = createFolder()
    write(folder, 'package.json', JSON.stringify({ type: 'module' }))
    write(folder, 'index.js', `export function activate() { return 'esm-js' }`)
    let ext = await createExtensionAsync('esm-js', path.join(folder, 'index.js'), false)
    assert.strictEqual(ext.activate({}), 'esm-js')
  })

  it('should load relative ESM imports', async () => {
    let folder = createFolder()
    write(folder, 'dep.mjs', `export const value = 'dep'`)
    write(folder, 'index.mjs', `
import { value } from './dep.mjs'
export function activate() { return value }`)
    let ext = await createExtensionAsync('esm-rel', path.join(folder, 'index.mjs'), false)
    assert.strictEqual(ext.activate({}), 'dep')
  })

  it('should import packages with ESM exports', async () => {
    let folder = createFolder()
    let pkg = path.join(folder, 'node_modules', 'esm-pkg')
    fs.mkdirSync(pkg, { recursive: true })
    write(pkg, 'package.json', JSON.stringify({ name: 'esm-pkg', type: 'module', exports: { '.': './main.mjs' } }))
    write(pkg, 'main.mjs', `export const name = 'pkg'`)
    write(folder, 'index.mjs', `
import { name } from 'esm-pkg'
export function activate() { return name }`)
    let ext = await createExtensionAsync('esm-pkg', path.join(folder, 'index.mjs'), false)
    assert.strictEqual(ext.activate({}), 'pkg')
  })

  it('should support ESM cycles', async () => {
    let folder = createFolder()
    write(folder, 'a.mjs', `
import { bName } from './b.mjs'
export const aName = 'a'
export function activate() { return { a: aName, b: bName } }`)
    write(folder, 'b.mjs', `
import { aName } from './a.mjs'
export const bName = 'b'
export function readA() { return aName }`)
    let ext = await createExtensionAsync('esm-cycle', path.join(folder, 'a.mjs'), false)
    assert.deepStrictEqual({ ...ext.activate({}) }, { a: 'a', b: 'b' })
  })

  it('should support top-level await', async () => {
    let folder = createFolder()
    write(folder, 'index.mjs', `
const value = await Promise.resolve('tla')
export function activate() { return value }`)
    let ext = await createExtensionAsync('esm-tla', path.join(folder, 'index.mjs'), false)
    assert.strictEqual(ext.activate({}), 'tla')
  })

  it('should support dynamic import from CommonJS', async () => {
    let folder = createFolder()
    write(folder, 'dep.mjs', `export default 'dynamic'`)
    write(folder, 'index.cjs', `
exports.activate = async () => {
  const mod = await import('./dep.mjs')
  return mod.default
}`)
    let ext = await createExtensionAsync('cjs-dyn', path.join(folder, 'index.cjs'), false)
    assert.strictEqual(await ext.activate({}), 'dynamic')
  })

  it('should support dynamic import from ESM', async () => {
    let folder = createFolder()
    write(folder, 'dep.mjs', `export const value = 'dyn-esm'`)
    write(folder, 'index.mjs', `
export async function activate() {
  const mod = await import('./dep.mjs')
  return mod.value
}`)
    let ext = await createExtensionAsync('esm-dyn', path.join(folder, 'index.mjs'), false)
    assert.strictEqual(await ext.activate({}), 'dyn-esm')
  })

  it('should set import.meta.url and route import.meta.resolve', async () => {
    let folder = createFolder()
    write(folder, 'dep.mjs', `export default 1`)
    write(folder, 'index.mjs', `
export function activate() {
  return { url: import.meta.url, dep: import.meta.resolve('./dep.mjs') }
}`)
    let ext = await createExtensionAsync('meta-url', path.join(folder, 'index.mjs'), false)
    let res = ext.activate({})
    assert.strictEqual(res.url, pathToFileURL(fs.realpathSync(path.join(folder, 'index.mjs'))).href)
    assert.strictEqual(res.dep, pathToFileURL(fs.realpathSync(path.join(folder, 'dep.mjs'))).href)
  })

  it('should clean up the ESM cache on parse and link errors', async () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.mjs')
    write(folder, 'index.mjs', `export const = broken`)
    let runtime = createExtensionRuntime('esm-syntax', entry, {}, consoleLogger)
    await assert.rejects(loadESMEntry(runtime, entry))
    assert.strictEqual(runtime.esmModules.size, 0)
    write(folder, 'index.mjs', `import './missing.mjs'`)
    await assert.rejects(loadESMEntry(runtime, entry))
    assert.strictEqual(runtime.esmModules.size, 0)
  })

  it('should re-execute an ESM entry after an evaluation failure', async () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.mjs')
    write(folder, 'index.mjs', `throw new Error('eval boom')`)
    let runtime = createExtensionRuntime('esm-eval', entry, {}, consoleLogger)
    await assert.rejects(loadESMEntry(runtime, entry), /eval boom/)
    assert.strictEqual(runtime.esmModules.size, 0)
    write(folder, 'index.mjs', `export function activate() { return 'fixed' }`)
    let ns = await loadESMEntry(runtime, entry)
    assert.strictEqual(ns.activate(), 'fixed')
  })

  it('should keep extension filenames in ESM error stacks', async () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.mjs')
    write(folder, 'index.mjs', `throw new Error('stack check')`)
    let runtime = createExtensionRuntime('esm-stack', entry, {}, consoleLogger)
    let err: any
    try {
      await loadESMEntry(runtime, entry)
    } catch (e) {
      err = e
    }
    assert.notStrictEqual(err, undefined)
    assert.match(String(err.stack || err.message), /index\.mjs/)
  })

  it('should import CommonJS from ESM without double execution', async () => {
    let folder = createFolder()
    write(folder, 'cjs.cjs', `
globalThis.__cjsCount = (globalThis.__cjsCount || 0) + 1
module.exports = { name: 'cjs', count: globalThis.__cjsCount }`)
    write(folder, 'index.mjs', `
import cjs from './cjs.cjs'
import * as ns from './cjs.cjs'
export function activate() {
  return { defaultName: cjs.name, nsName: ns.default.name, count: cjs.count }
}`)
    let ext = await createExtensionAsync('cjs-bridge', path.join(folder, 'index.mjs'), false)
    let res = ext.activate({})
    assert.strictEqual(res.defaultName, 'cjs')
    assert.strictEqual(res.nsName, 'cjs')
    assert.strictEqual(res.count, 1)
  })

  it('should import JSON from ESM', async () => {
    let folder = createFolder()
    write(folder, 'data.json', JSON.stringify({ value: 42 }))
    write(folder, 'index.mjs', `
import data from './data.json'
export function activate() { return data.value }`)
    let ext = await createExtensionAsync('json-import', path.join(folder, 'index.mjs'), false)
    assert.strictEqual(ext.activate({}), 42)
  })

  it('should import Node builtins from ESM', async () => {
    let folder = createFolder()
    write(folder, 'index.mjs', `
import fs from 'node:fs'
import * as path from 'node:path'
export function activate() {
  return { sep: path.sep, hasRead: typeof fs.readFileSync === 'function' }
}`)
    let ext = await createExtensionAsync('builtin-import', path.join(folder, 'index.mjs'), false)
    let res = ext.activate({})
    assert.strictEqual(res.sep, path.sep)
    assert.strictEqual(res.hasRead, true)
  })

  it('should expose the same API values to CJS and ESM', async () => {
    let folder = createFolder()
    let api = { workspace: { nvim: {} }, commands: {} }
    write(folder, 'check.cjs', `module.exports = { api: require('coc.nvim').workspace }`)
    write(folder, 'index.mjs', `
import { workspace } from 'coc.nvim'
import check from './check.cjs'
export function activate() {
  return { same: workspace === check.api }
}`)
    let runtime = createExtensionRuntime('api-same', path.join(folder, 'index.mjs'), api, consoleLogger)
    let ns = await loadESMEntry(runtime, path.join(folder, 'index.mjs'))
    assert.strictEqual(ns.activate().same, true)
  })

  it('should isolate ESM runtimes', async () => {
    let folder = createFolder()
    write(folder, 'a.mjs', `
globalThis.__esmFoo = 1
Object.prototype.__esmIntrinsic = 1
export function activate() { return globalThis.__esmFoo }`)
    write(folder, 'b.mjs', `
export function activate() {
  return { foo: globalThis.__esmFoo, intrinsic: ({}).__esmIntrinsic }
}`)
    let ra = createExtensionRuntime('esm-iso-a', path.join(folder, 'a.mjs'), {}, consoleLogger)
    await loadESMEntry(ra, path.join(folder, 'a.mjs'))
    let rb = createExtensionRuntime('esm-iso-b', path.join(folder, 'b.mjs'), {}, consoleLogger)
    let nsb = await loadESMEntry(rb, path.join(folder, 'b.mjs'))
    let res = nsb.activate()
    assert.strictEqual(res.foo, undefined)
    assert.strictEqual(res.intrinsic, undefined)
    assert.notStrictEqual(ra.context, rb.context)
    assert.notStrictEqual(ra.esmModules, rb.esmModules)
    assert.notStrictEqual(ra.cjsModules, rb.cjsModules)
  })

  it('should reload ESM extensions with a fresh namespace', async () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.mjs')
    write(folder, 'index.mjs', `
globalThis.__esmReload = 1
export let count = 1
export function activate() { return { count: count++, g: globalThis } }`)
    let ext1 = await createExtensionAsync('esm-reload', entry, false)
    let r1 = ext1.activate({})
    assert.strictEqual(ext1.activate({}).count, 2)
    r1.g.__stale = 'old'
    let ext2 = await createExtensionAsync('esm-reload', entry, false)
    let r2 = ext2.activate({})
    assert.strictEqual(r2.count, 1)
    assert.notStrictEqual(r1.g, r2.g)
    assert.strictEqual(r2.g.__stale, undefined)
  })

  it('should route ESM process imports through the facade', async () => {
    let folder = createFolder()
    write(folder, 'exit.mjs', `
import process from 'node:process'
export function activate() { process.exit() }`)
    write(folder, 'same.mjs', `
import { env } from 'process'
export function activate() { return { same: env === globalThis.process.env } }`)
    let ext = await createExtensionAsync('esm-facade', path.join(folder, 'exit.mjs'), false)
    assert.throws(() => ext.activate({}), /not allowed in extension sandbox/)
    let ext2 = await createExtensionAsync('esm-facade2', path.join(folder, 'same.mjs'), false)
    assert.strictEqual(ext2.activate({}).same, true)
  })

  it('should route ESM console imports through the extension console', async () => {
    let folder = createFolder()
    write(folder, 'index.mjs', `
import * as console from 'node:console'
console.log('esm-log')
export function activate() { return typeof console.Console }`)
    let { logger, calls } = makeLogger()
    let runtime = createExtensionRuntime('esm-console', path.join(folder, 'index.mjs'), {}, logger)
    let ns = await loadESMEntry(runtime, path.join(folder, 'index.mjs'))
    assert.strictEqual(ns.activate(), 'function')
    assert.deepStrictEqual(calls, ['info:esm-log'])
  })

  it('should support default function exports for ESM entries', async () => {
    let folder = createFolder()
    write(folder, 'index.mjs', `export default function activate() { return 'default-activate' }`)
    let ext = await createExtensionAsync('esm-default', path.join(folder, 'index.mjs'), false)
    assert.strictEqual(ext.activate({}), 'default-activate')
  })

  it('should load a mixed CJS/ESM extension', async () => {
    let folder = createFolder()
    write(folder, 'cjs-dep.cjs', `module.exports = { value: 'cjs' }`)
    write(folder, 'esm-dep.mjs', `export const value = 'mixed'`)
    write(folder, 'index.cjs', `
const dep = require('./cjs-dep.cjs')
exports.activate = async () => {
  const esm = await import('./esm-dep.mjs')
  return { cjs: dep.value, esm: esm.value }
}`)
    let ext = await createExtensionAsync('mixed', path.join(folder, 'index.cjs'), false)
    assert.deepStrictEqual({ ...await ext.activate({}) }, { cjs: 'cjs', esm: 'mixed' })
  })

  it('should detect module formats', () => {
    let folder = createFolder()
    write(folder, 'plain.js', '')
    assert.strictEqual(resolveModuleFormat('/tmp/x.mjs'), 'module')
    assert.strictEqual(resolveModuleFormat('/tmp/x.cjs'), 'commonjs')
    assert.strictEqual(resolveModuleFormat('/tmp/x.json'), 'json')
    assert.strictEqual(resolveModuleFormat('/tmp/x.node'), 'native')
    assert.strictEqual(resolveModuleFormat('/tmp/x'), 'commonjs')
    assert.strictEqual(resolveModuleFormat(path.join(folder, 'plain.js')), 'commonjs')
    write(folder, 'package.json', JSON.stringify({ type: 'module' }))
    assert.strictEqual(resolveModuleFormat(path.join(folder, 'plain.js')), 'module')
  })

  it('should cache package type and fall back on invalid package.json', () => {
    let folder = createFolder()
    write(folder, 'package.json', JSON.stringify({ type: 'commonjs' }))
    write(folder, 'a.js', '')
    assert.strictEqual(resolveModuleFormat(path.join(folder, 'a.js')), 'commonjs')
    // Second call hits the cached package metadata.
    assert.strictEqual(resolveModuleFormat(path.join(folder, 'a.js')), 'commonjs')
    let broken = createFolder()
    write(broken, 'package.json', '{ broken json')
    write(broken, 'b.js', '')
    assert.strictEqual(resolveModuleFormat(path.join(broken, 'b.js')), 'commonjs')
  })

  it('should reject ESM imports of native addons', async () => {
    let folder = createFolder()
    write(folder, 'addon.node', 'fake addon')
    let entry = path.join(folder, 'index.mjs')
    write(folder, 'index.mjs', `import x from './addon.node'`)
    let runtime = createExtensionRuntime('native-import', entry, {}, consoleLogger)
    await assert.rejects(loadESMEntry(runtime, entry), /ESM import of native addon/)
  })

  it('should resolve coc.nvim through import.meta.resolve', async () => {
    let folder = createFolder()
    write(folder, 'index.mjs', `export function activate() { return import.meta.resolve('coc.nvim') }`)
    let ext = await createExtensionAsync('meta-coc', path.join(folder, 'index.mjs'), false)
    assert.strictEqual(ext.activate({}), 'coc.nvim')
  })

  it('should cache synthetic bridges per runtime', async () => {
    let folder = createFolder()
    let api = { workspace: { nvim: {} } }
    write(folder, 'a.mjs', `import { workspace } from 'coc.nvim'; export const ws = workspace`)
    write(folder, 'b.mjs', `import { workspace } from 'coc.nvim'; export const ws = workspace`)
    write(folder, 'index.mjs', `
import { ws as a } from './a.mjs'
import { ws as b } from './b.mjs'
export function activate() { return a === b }`)
    let runtime = createExtensionRuntime('synth-cache', path.join(folder, 'index.mjs'), api, consoleLogger)
    let ns = await loadESMEntry(runtime, path.join(folder, 'index.mjs'))
    assert.strictEqual(ns.activate(), true)
  })

  it('should handle dangling symlink module paths', async () => {
    let folder = createFolder()
    fs.symlinkSync(path.join(folder, 'nonexistent-target.mjs'), path.join(folder, 'dangling.mjs'))
    let runtime = createExtensionRuntime('dangling', path.join(folder, 'dangling.mjs'), {}, consoleLogger)
    await assert.rejects(loadESMEntry(runtime, path.join(folder, 'dangling.mjs')), /ENOENT|no such file/i)
  })
})

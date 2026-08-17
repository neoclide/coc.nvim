import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { vm } from '../../util/node'
import { consoleLogger, createExtensionAsync, createExtensionRuntime, getLoader } from '../../extension/loader'
import type { ILogger } from '../../extension/loader'
import { ensureVMModules, loadESMEntry, resolveExtensionModule, resolveModuleFormat } from '../../extension/esm'

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

  it('should load ESM sourceCode with its source filename', async () => {
    let folder = createFolder()
    write(folder, 'dep.cjs', `module.exports = { value: 'from-cjs' }`)
    let sourceFilename = path.join(folder, 'virtual-entry.mjs')
    let ext = await createExtensionAsync('esm-source', path.join(folder, 'index.js'), false, {
      sourceCode: `
import { value } from './dep.cjs'
export function activate() { return { value, url: import.meta.url } }`,
      sourceFormat: 'module',
      sourceFilename,
      extensionRoot: folder
    })
    let res = ext.activate({})
    assert.strictEqual(res.value, 'from-cjs')
    assert.strictEqual(res.url, pathToFileURL(sourceFilename).href)
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
import { name, count as namedCount } from './cjs.cjs'
import * as ns from './cjs.cjs'
export function activate() {
  return { defaultName: cjs.name, namedName: name, nsName: ns.default.name, count: cjs.count, namedCount }
}`)
    let ext = await createExtensionAsync('cjs-bridge', path.join(folder, 'index.mjs'), false)
    let res = ext.activate({})
    assert.strictEqual(res.defaultName, 'cjs')
    assert.strictEqual(res.namedName, 'cjs')
    assert.strictEqual(res.nsName, 'cjs')
    assert.strictEqual(res.count, 1)
    assert.strictEqual(res.namedCount, 1)
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

  it('should throw when VM modules are not available', () => {
    let source = (vm as any).SourceTextModule
    try {
      (vm as any).SourceTextModule = undefined
      assert.throws(() => ensureVMModules(), /VM modules support/)
    } finally {
      (vm as any).SourceTextModule = source
    }
  })

  it('should prefer the coc.nvim export condition over require and import', async () => {
    let folder = createFolder()
    let pkg = path.join(folder, 'node_modules', 'cond-pkg')
    fs.mkdirSync(pkg, { recursive: true })
    write(pkg, 'package.json', JSON.stringify({
      name: 'cond-pkg',
      exports: {
        types: './types.d.ts',
        import: './esm.mjs',
        require: './cjs.js',
        'coc.nvim': './coc.cjs'
      }
    }))
    write(pkg, 'cjs.js', `module.exports = { build: 'cjs' }`)
    write(pkg, 'esm.mjs', `export const build = 'esm'`)
    write(pkg, 'coc.cjs', `module.exports = { build: 'coc' }`)
    write(pkg, 'types.d.ts', `export {}`)
    // CJS require resolves the coc.nvim build even though `require` appears
    // earlier in the exports map.
    write(folder, 'cjs-entry.cjs', `
const pkg = require('cond-pkg')
exports.activate = () => pkg.build`)
    let ext = await createExtensionAsync('coc-exports-cjs', path.join(folder, 'cjs-entry.cjs'), false)
    assert.strictEqual(ext.activate({}), 'coc')
    // ESM import resolves the same coc.nvim build through the CJS bridge.
    write(folder, 'esm-entry.mjs', `
import pkg from 'cond-pkg'
export function activate() { return pkg.build }`)
    let ext2 = await createExtensionAsync('coc-exports-esm', path.join(folder, 'esm-entry.mjs'), false)
    assert.strictEqual(ext2.activate({}), 'coc')
  })

  it('should resolve nested coc.nvim export conditions with node priority', () => {
    let folder = createFolder()
    let pkg = path.join(folder, 'node_modules', 'cond-pkg')
    fs.mkdirSync(pkg, { recursive: true })
    write(pkg, 'package.json', JSON.stringify({
      name: 'cond-pkg',
      exports: {
        require: './cjs.js',
        'coc.nvim': {
          node: './coc-node.cjs',
          default: './coc-default.cjs'
        }
      }
    }))
    write(pkg, 'cjs.js', `module.exports = {}`)
    write(pkg, 'coc-node.cjs', `module.exports = {}`)
    write(pkg, 'coc-default.cjs', `module.exports = {}`)
    let runtime = createExtensionRuntime('coc-nested', path.join(folder, 'index.js'), {}, consoleLogger)
    let resolved = resolveExtensionModule(runtime, 'cond-pkg', path.join(folder, 'index.js'), 'require')
    assert.strictEqual(resolved.type, 'file')
    assert.strictEqual((resolved as any).filename, fs.realpathSync(path.join(pkg, 'coc-node.cjs')))
  })

  it('should prefer coc.nvim for subpath exports', () => {
    let folder = createFolder()
    let pkg = path.join(folder, 'node_modules', 'cond-pkg')
    fs.mkdirSync(pkg, { recursive: true })
    write(pkg, 'package.json', JSON.stringify({
      name: 'cond-pkg',
      exports: {
        '.': { require: './cjs.js' },
        './sub': {
          'coc.nvim': './sub-coc.cjs',
          require: './sub-cjs.js'
        }
      }
    }))
    write(pkg, 'cjs.js', `module.exports = {}`)
    write(pkg, 'sub-coc.cjs', `module.exports = {}`)
    write(pkg, 'sub-cjs.js', `module.exports = {}`)
    let runtime = createExtensionRuntime('coc-subpath', path.join(folder, 'index.js'), {}, consoleLogger)
    let resolved = resolveExtensionModule(runtime, 'cond-pkg/sub', path.join(folder, 'index.js'), 'require')
    assert.strictEqual(resolved.type, 'file')
    assert.strictEqual((resolved as any).filename, fs.realpathSync(path.join(pkg, 'sub-coc.cjs')))
  })

  it('should handle scoped packages and array export targets', () => {
    let folder = createFolder()
    let pkg = path.join(folder, 'node_modules', '@scope', 'cond-pkg')
    fs.mkdirSync(pkg, { recursive: true })
    write(pkg, 'package.json', JSON.stringify({
      name: '@scope/cond-pkg',
      exports: {
        'coc.nvim': ['./first.cjs', './second.cjs'],
        require: './cjs.js'
      }
    }))
    write(pkg, 'first.cjs', `module.exports = {}`)
    write(pkg, 'second.cjs', `module.exports = {}`)
    write(pkg, 'cjs.js', `module.exports = {}`)
    let runtime = createExtensionRuntime('coc-scoped', path.join(folder, 'index.js'), {}, consoleLogger)
    let resolved = resolveExtensionModule(runtime, '@scope/cond-pkg', path.join(folder, 'index.js'), 'require')
    assert.strictEqual(resolved.type, 'file')
    assert.strictEqual((resolved as any).filename, fs.realpathSync(path.join(pkg, 'first.cjs')))
    // Nested arrays inside the coc.nvim branch resolve through the first item.
    write(pkg, 'package.json', JSON.stringify({
      name: '@scope/cond-pkg',
      exports: {
        'coc.nvim': { node: ['./first.cjs', './second.cjs'] },
        require: './cjs.js'
      }
    }))
    let nested = resolveExtensionModule(runtime, '@scope/cond-pkg', path.join(folder, 'index.js'), 'require')
    assert.strictEqual((nested as any).filename, fs.realpathSync(path.join(pkg, 'first.cjs')))
    // An array with no resolvable coc.nvim item falls back to require.
    write(pkg, 'package.json', JSON.stringify({
      name: '@scope/cond-pkg',
      exports: {
        'coc.nvim': [{ browser: './browser.cjs' }],
        require: './cjs.js'
      }
    }))
    write(pkg, 'browser.cjs', `module.exports = {}`)
    let fallback = resolveExtensionModule(runtime, '@scope/cond-pkg', path.join(folder, 'index.js'), 'require')
    assert.strictEqual((fallback as any).filename, fs.realpathSync(path.join(pkg, 'cjs.js')))
    // A top-level array target resolves through the item exposing coc.nvim.
    write(pkg, 'package.json', JSON.stringify({
      name: '@scope/cond-pkg',
      exports: {
        '.': [{ 'coc.nvim': './first.cjs' }, './fallback.js']
      }
    }))
    write(pkg, 'fallback.js', `module.exports = {}`)
    let arrayTarget = resolveExtensionModule(runtime, '@scope/cond-pkg', path.join(folder, 'index.js'), 'require')
    assert.strictEqual((arrayTarget as any).filename, fs.realpathSync(path.join(pkg, 'first.cjs')))
    // An array with no coc.nvim item falls back to its string item.
    write(pkg, 'package.json', JSON.stringify({
      name: '@scope/cond-pkg',
      exports: {
        '.': [{ browser: './browser.cjs' }, './fallback.js'],
        require: './cjs.js'
      }
    }))
    let noCoc = resolveExtensionModule(runtime, '@scope/cond-pkg', path.join(folder, 'index.js'), 'require')
    assert.strictEqual((noCoc as any).filename, fs.realpathSync(path.join(pkg, 'fallback.js')))
  })

  it('should bail out of the coc.nvim pre-check without a resolvable target', () => {
    let folder = createFolder()
    let pkg = path.join(folder, 'node_modules', '@scope', 'cond-pkg')
    fs.mkdirSync(pkg, { recursive: true })
    write(pkg, 'package.json', JSON.stringify({
      name: '@scope/cond-pkg',
      exports: {
        '.': [{ browser: './browser.cjs' }, { other: './other.js' }]
      }
    }))
    write(pkg, 'browser.cjs', `module.exports = {}`)
    write(pkg, 'other.js', `module.exports = {}`)
    let runtime = createExtensionRuntime('coc-no-target', path.join(folder, 'index.js'), {}, consoleLogger)
    // No item exposes coc.nvim, so the pre-check bails out and Node's own
    // exports resolution rejects the package.
    assert.throws(() => resolveExtensionModule(runtime, '@scope/cond-pkg', path.join(folder, 'index.js'), 'require'))
  })

  it('should fall back to Node resolution without a coc.nvim export', () => {
    let folder = createFolder()
    let pkg = path.join(folder, 'node_modules', 'cond-pkg')
    fs.mkdirSync(pkg, { recursive: true })
    write(pkg, 'package.json', JSON.stringify({
      name: 'cond-pkg',
      exports: {
        '.': { require: './cjs.js', import: './esm.mjs' }
      }
    }))
    write(pkg, 'cjs.js', `module.exports = { build: 'cjs' }`)
    write(pkg, 'esm.mjs', `export const build = 'esm'`)
    let runtime = createExtensionRuntime('coc-fallback', path.join(folder, 'index.js'), {}, consoleLogger)
    let resolved = resolveExtensionModule(runtime, 'cond-pkg', path.join(folder, 'index.js'), 'require')
    assert.strictEqual((resolved as any).filename, fs.realpathSync(path.join(pkg, 'cjs.js')))
  })

  it('should fall back when coc.nvim branches have no resolvable target', () => {
    let folder = createFolder()
    let pkg = path.join(folder, 'node_modules', 'cond-pkg')
    fs.mkdirSync(pkg, { recursive: true })
    write(pkg, 'package.json', JSON.stringify({
      name: 'cond-pkg',
      exports: {
        'coc.nvim': { browser: './browser.cjs' },
        require: './cjs.js'
      }
    }))
    write(pkg, 'browser.cjs', `module.exports = {}`)
    write(pkg, 'cjs.js', `module.exports = {}`)
    let runtime = createExtensionRuntime('coc-nested-none', path.join(folder, 'index.js'), {}, consoleLogger)
    let resolved = resolveExtensionModule(runtime, 'cond-pkg', path.join(folder, 'index.js'), 'require')
    assert.strictEqual((resolved as any).filename, fs.realpathSync(path.join(pkg, 'cjs.js')))
    // A subpath missing from exports falls through to Node and fails.
    write(pkg, 'other.js', `module.exports = {}`)
    assert.throws(() => resolveExtensionModule(runtime, 'cond-pkg/other', path.join(folder, 'index.js'), 'require'))
  })

  it('should handle string exports and malformed package.json', () => {
    let folder = createFolder()
    let pkg = path.join(folder, 'node_modules', 'cond-pkg')
    fs.mkdirSync(pkg, { recursive: true })
    write(pkg, 'package.json', JSON.stringify({ name: 'cond-pkg', exports: './index.js' }))
    write(pkg, 'index.js', `module.exports = { build: 'string' }`)
    let runtime = createExtensionRuntime('coc-string-exports', path.join(folder, 'index.js'), {}, consoleLogger)
    let resolved = resolveExtensionModule(runtime, 'cond-pkg', path.join(folder, 'index.js'), 'require')
    assert.strictEqual((resolved as any).filename, fs.realpathSync(path.join(pkg, 'index.js')))
    // Malformed package.json makes the pre-check bail out and Node resolves
    // through the regular package entry.
    write(pkg, 'package.json', '{ broken json')
    let fallback = resolveExtensionModule(runtime, 'cond-pkg', path.join(folder, 'index.js'), 'require')
    assert.strictEqual(fallback.type, 'file')
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

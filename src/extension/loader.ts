'use strict'
import { createLogger } from '../logger'
import { fs, path, vm } from '../util/node'
import type { Context, Module as VMModule } from 'vm'
import { createExtensionConsole, getConsoleFacade } from './console'
import type { ExtensionConsoleState } from './console'
import { createExtensionApi } from './facade'
import type { ExtensionApiContext } from './facade'
import {
  loadESMEntry,
  dynamicImportModule,
  requireESMError,
  resolveExtensionModule,
  resolveModuleFormat
} from './esm'

/**
 * Extension loader based on `vm.createContext` + `vm.compileFunction`.
 *
 * Every extension owns one `vm.Context` and one module cache, so extensions
 * cannot observe each other's globals and reload always starts from a fresh
 * realm. CommonJS modules are compiled with `vm.compileFunction` and executed
 * with an extension-local `require` instead of patching Node's module
 * compiler, wrapping sources, or using `vm.runInContext`.
 */

export interface ExtensionExport {
  activate: (context: unknown) => any
  deactivate?: () => any
  [key: string]: any
}

export interface ILogger {
  category?: string
  log(...args: any[]): void
  trace(...args: any[]): void
  debug(...args: any[]): void
  info(...args: any[]): void
  warn(...args: any[]): void
  error(...args: any[]): void
  fatal(...args: any[]): void
  mark(...args: any[]): void
}

export interface ExtensionCommonJSModule {
  id: string
  filename: string
  dirname: string
  exports: unknown
  loaded: boolean
  parent?: ExtensionCommonJSModule
  children: ExtensionCommonJSModule[]
}

export interface ExtensionRuntime {
  id: string
  root: string
  realRoot: string
  entry: string
  context: Context
  api: unknown
  console: Console
  consoleState: ExtensionConsoleState
  cjsModules: Map<string, ExtensionCommonJSModule>
  esmModules: Map<string, VMModule>
}

const Module: any = require('module')
const mainModule = require.main
const REMOVED_GLOBALS = [
  'reallyExit',
  'abort',
  'umask',
  'setuid',
  'setgid',
  'setgroups',
  '_fatalException',
  'exit',
  'kill',
]

export const consoleLogger: ILogger = {
  category: '',
  log: console.log.bind(console),
  debug: console.debug.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  trace: console.log.bind(console),
  fatal: console.error.bind(console),
  mark: console.log.bind(console),
}

function removedGlobalStub(name: string) {
  return () => {
    throw new Error(`process.${name}() is not allowed in extension sandbox`)
  }
}

/**
 * Process facade exposed to extensions as the `process` global and returned
 * by `require('process')` / `require('node:process')`.
 */
export function createProcessFacade(): NodeJS.Process {
  const facade: any = new (process as any).constructor()
  for (let key of Reflect.ownKeys(process)) {
    if (typeof key === 'string' && key.startsWith('_')) continue
    facade[key] = process[key]
  }
  REMOVED_GLOBALS.forEach(name => {
    facade[name] = removedGlobalStub(name)
  })
  facade['chdir'] = () => {}
  facade['umask'] = (mask?: number) => {
    if (typeof mask !== 'undefined') {
      throw new Error('Cannot use process.umask() to change mask (read-only)')
    }
    return process.umask()
  }
  return facade
}

export function copyGlobalProperties(sandbox: Record<string, unknown>, globalObj: any): Record<string, unknown> {
  // Use Object.keys so `instanceof Error` and `instanceof TypeError` keep
  // working inside the extension realm.
  for (const key of Object.keys(globalObj)) {
    const value = sandbox[key]
    if (value === undefined) {
      sandbox[key] = globalObj[key]
    }
  }
  return sandbox
}

/**
 * Create the contextified sandbox shared by all modules of one extension.
 * Preserves the previous sandbox surface: console forwarding, timers, Buffer,
 * URL APIs, text encoders/decoders, and the process facade.
 */
export function createExtensionContext(id: string, console: Console): Context {
  const sandbox: Record<string, unknown> = vm.createContext({
    console,
    Buffer,
    URL: globalThis.URL,
    WebAssembly: globalThis.WebAssembly,
  }, { name: id }) as unknown as Record<string, unknown>
  copyGlobalProperties(sandbox, global)
  sandbox['process'] = createProcessFacade()
  return sandbox as unknown as Context
}

function stripBOM(content: string): string {
  if (content.charCodeAt(0) === 0xFEFF) return content.slice(1)
  return content
}

function stripShebang(content: string): string {
  // Replace the shebang with an empty line so line numbers are preserved.
  return content.startsWith('#!') ? content.replace(/^#![^\n]*/, '') : content
}

/**
 * Loads CommonJS modules for a single extension runtime. All modules of one
 * runtime execute in the same `vm.Context` and share the runtime module cache.
 */
export class ExtensionLoader {
  constructor(public readonly runtime: ExtensionRuntime) {}

  private parents = new WeakMap<ExtensionCommonJSModule, Set<ExtensionCommonJSModule>>()

  private isBuiltin(request: string): boolean {
    if (request.startsWith('node:')) return true
    return Module.isBuiltin(request) === true
  }

  private normalizeFilename(filename: string): string {
    try {
      return fs.realpathSync(filename)
    } catch (e) {
      return path.resolve(filename)
    }
  }

  private parentModule(parent: ExtensionCommonJSModule): any {
    const record = new Module(parent.filename)
    record.filename = parent.filename
    record.id = parent.filename
    record.paths = Module._nodeModulePaths(parent.dirname)
    return record
  }

  /**
   * Resolve a request against the parent module using Node's resolver.
   */
  public resolve(request: string, parent: ExtensionCommonJSModule, options?: any): string {
    if (this.isBuiltin(request)) return request
    return Module._resolveFilename(request, this.parentModule(parent), false, options)
  }

  /**
   * Node-compatible `require.resolve.paths` for a request from a parent
   * module. Returns null for builtins, like Node does.
   */
  public resolvePaths(request: string, parent: ExtensionCommonJSModule): string[] | null {
    return Module._resolveLookupPaths(request, this.parentModule(parent))
  }

  /**
   * Extension-local require: API injection, builtins, then modules in this
   * runtime.
   */
  public require(request: string, parent: ExtensionCommonJSModule): unknown {
    if (request === 'coc.nvim') return this.runtime.api
    if (this.isBuiltin(request)) return this.loadBuiltin(request)
    let resolved = resolveExtensionModule(this.runtime, request, parent.filename, 'require')
    if (resolved.type === 'file') {
      if (resolved.format === 'module') throw requireESMError(resolved.filename)
      return this.load(resolved.filename, parent)
    }
    throw new Error(`Unable to require ${request}`)
  }

  public load(filename: string, parent?: ExtensionCommonJSModule, isMain = false): unknown {
    const cacheKey = this.normalizeFilename(filename)
    const ext = path.extname(cacheKey).toLowerCase()
    if (ext === '.json') return this.loadJson(cacheKey, parent)
    if (ext === '.node') return this.loadNative(cacheKey, parent)
    if (ext === '.js' || ext === '.cjs' || ext === '') return this.loadJavaScript(cacheKey, parent)
    if (ext === '.mjs') throw requireESMError(cacheKey)
    throw new Error(`Unsupported module type "${ext}" for ${cacheKey}`)
  }

  /**
   * Load a native addon outside the VM. The addon is dlopen'd by Node and its
   * exports are cached in the runtime module cache.
   */
  public loadNative(filename: string, parent?: ExtensionCommonJSModule): unknown {
    const cacheKey = this.normalizeFilename(filename)
    const cached = this.runtime.cjsModules.get(cacheKey)
    if (cached) return cached.exports
    const nodeModule = new Module(cacheKey)
    nodeModule.filename = cacheKey
    nodeModule.paths = Module._nodeModulePaths(path.dirname(cacheKey))
    const nativeLoad = Module._extensions && Module._extensions['.node']
    if (typeof nativeLoad !== 'function') {
      throw new Error(`Unsupported native addon: ${cacheKey}`)
    }
    nativeLoad(nodeModule, cacheKey)
    const module = this.createModule(cacheKey, parent)
    module.exports = nodeModule.exports
    module.loaded = true
    return module.exports
  }

  /**
   * Load a JSON module synchronously and cache the parsed value per runtime.
   */
  public loadJson(filename: string, parent?: ExtensionCommonJSModule): unknown {
    const cacheKey = this.normalizeFilename(filename)
    const cached = this.runtime.cjsModules.get(cacheKey)
    if (cached) return cached.exports
    const source = fs.readFileSync(cacheKey, 'utf8')
    let value: unknown
    try {
      value = JSON.parse(stripBOM(source))
    } catch (e) {
      throw new Error(`Error parsing JSON module ${cacheKey}: ${(e as Error).message}`, { cause: e })
    }
    const module = this.createModule(cacheKey, parent)
    module.exports = value
    module.loaded = true
    return module.exports
  }

  public loadBuiltin(request: string): unknown {
    if (request === 'process' || request === 'node:process') {
      return (this.runtime.context as any).process
    }
    if (request === 'console' || request === 'node:console') {
      return getConsoleFacade(this.runtime)
    }
    return require(request)
  }

  /**
   * Load a CommonJS JavaScript module. The module record is cached before
   * execution so circular dependencies observe partial exports; failed
   * modules are removed from the cache and the module graph.
   */
  public loadJavaScript(filename: string, parent?: ExtensionCommonJSModule): unknown {
    const cacheKey = this.normalizeFilename(filename)
    const cached = this.runtime.cjsModules.get(cacheKey)
    if (cached) return cached.exports
    const module = this.createModule(cacheKey, parent)
    let source: string
    try {
      source = fs.readFileSync(cacheKey, 'utf8')
    } catch (e) {
      this.failModule(module)
      throw e
    }
    try {
      this.compileCommonJS(module, source)
      module.loaded = true
    } catch (e) {
      this.failModule(module)
      throw e
    }
    return module.exports
  }

  /**
   * Compile and execute one CommonJS module with `vm.compileFunction` inside
   * the extension context.
   */
  public compileCommonJS(module: ExtensionCommonJSModule, source: string): void {
    const code = stripShebang(stripBOM(source))
    const fn = vm.compileFunction(
      code,
      ['exports', 'require', 'module', '__filename', '__dirname'],
      {
        filename: module.filename,
        parsingContext: this.runtime.context,
        importModuleDynamically: (specifier: string) => {
          return dynamicImportModule(this.runtime, specifier, module.filename)
        }
      }
    )
    const localRequire = createExtensionRequire(this.runtime, module)
    module['require'] = localRequire
    fn.call(module.exports as any, module.exports, localRequire, module, module.filename, module.dirname)
  }

  /**
   * Drop all cached modules of this runtime.
   */
  public clear(): void {
    this.runtime.cjsModules.clear()
  }

  private createModule(filename: string, parent?: ExtensionCommonJSModule): ExtensionCommonJSModule {
    const module: ExtensionCommonJSModule = {
      id: filename,
      filename,
      dirname: path.dirname(filename),
      exports: {},
      loaded: false,
      parent,
      children: []
    }
    this.runtime.cjsModules.set(filename, module)
    if (parent) {
      parent.children.push(module)
      let parents = this.parents.get(module)
      if (!parents) {
        parents = new Set()
        this.parents.set(module, parents)
      }
      parents.add(parent)
    }
    return module
  }

  private failModule(module: ExtensionCommonJSModule): void {
    this.runtime.cjsModules.delete(module.filename)
    const parents = this.parents.get(module)
    if (parents) {
      for (const parent of parents) {
        let idx = parent.children.indexOf(module)
        if (idx !== -1) parent.children.splice(idx, 1)
      }
      this.parents.delete(module)
    }
    for (const child of module.children) {
      if (child.parent === module) child.parent = undefined
      const childParents = this.parents.get(child)
      if (childParents) childParents.delete(module)
    }
    module.children = []
  }
}

export function getLoader(runtime: ExtensionRuntime): ExtensionLoader {
  let loader = (runtime as any).loader
  if (!loader) {
    loader = new ExtensionLoader(runtime)
    Object.defineProperty(runtime, 'loader', {
      value: loader,
      enumerable: false,
      configurable: true,
      writable: true
    })
  }
  return loader
}

/**
 * Create the synchronous extension-local require function for one parent
 * module. Repeated `require('coc.nvim')` calls return the same API object.
 */
export function createExtensionRequire(runtime: ExtensionRuntime, parent: ExtensionCommonJSModule): any {
  const loader = getLoader(runtime)
  const req: any = (request: string) => {
    return loader.require(request, parent)
  }
  req.resolve = (request: string, options?: any) => {
    return loader.resolve(request, parent, options)
  }
  req.resolve.paths = (request: string) => {
    return loader.resolvePaths(request, parent)
  }
  req.main = mainModule
  return req
}

/**
 * Create an extension runtime: one vm.Context, one CJS cache and one ESM
 * cache.
 */
export function createExtensionRuntime(id: string, filename: string, core: unknown, logger: ILogger): ExtensionRuntime {
  const { console, state } = createExtensionConsole(id, logger)
  const root = path.dirname(filename)
  let realRoot = root
  try {
    realRoot = fs.realpathSync(root)
  } catch (e) {
    // Best effort, keep the resolved path when realpath fails.
  }
  const apiContext: ExtensionApiContext = {
    extensionId: id,
    extensionRoot: realRoot,
    subscriptions: []
  }
  const runtime: ExtensionRuntime = {
    id,
    root,
    realRoot,
    entry: filename,
    context: createExtensionContext(id, console),
    api: createExtensionApi(apiContext, core),
    console,
    consoleState: state,
    cjsModules: new Map(),
    esmModules: new Map()
  }
  Object.defineProperty(runtime, 'apiContext', {
    value: apiContext,
    enumerable: false,
    configurable: true,
    writable: true
  })
  return runtime
}

const runtimes = new Map<string, ExtensionRuntime>()

/**
 * Dispose the runtime registered for an extension id, dropping its module
 * cache and strong references to the context.
 */
export function disposeExtension(id: string): void {
  let runtime = runtimes.get(id)
  if (runtime) {
    runtime.cjsModules.clear()
    runtime.esmModules.clear()
    runtime.consoleState.timers.clear()
    runtime.consoleState.counters.clear()
    runtime.consoleState.groupDepth = 0
    let apiContext = (runtime as any).apiContext as ExtensionApiContext | undefined
    if (apiContext) {
      for (let disposable of apiContext.subscriptions) {
        disposable.dispose()
      }
      apiContext.subscriptions.length = 0
    }
    runtimes.delete(id)
  }
}

function getLogger(useConsole: boolean, id: string): ILogger {
  if (useConsole) {
    return consoleLogger
  }
  return createLogger(`extension:${id}`)
}

function finalizeExports(id: string, defaultImport: any): ExtensionExport {
  const activate = (defaultImport && defaultImport['activate']) || defaultImport
  if (typeof activate !== 'function') {
    disposeExtension(id)
    return { activate: () => {} }
  }
  return typeof defaultImport === 'function' ? { activate } : Object.assign({}, defaultImport)
}

/**
 * Synchronously load a CommonJS extension entry. Each call creates a fresh
 * runtime: a new `vm.Context`, new module caches, and re-executed
 * entry/dependencies, which is what reload depends on. ESM entries must use
 * `createExtensionAsync`.
 */
export function createExtension(id: string, filename: string, isEmpty: boolean): ExtensionExport {
  if (isEmpty || !fs.existsSync(filename)) {
    return { activate: () => {}, deactivate: null }
  }
  if (resolveModuleFormat(filename) === 'module') throw requireESMError(filename)
  disposeExtension(id)
  const logger = getLogger(!global.__isMain && !global.__TEST__, id)
  const api: unknown = global.__isMain === undefined ? {} : require('../index')
  const runtime = createExtensionRuntime(id, filename, api, logger)
  runtimes.set(id, runtime)
  const loader = getLoader(runtime)
  try {
    return finalizeExports(id, loader.loadJavaScript(runtime.entry))
  } catch (e) {
    disposeExtension(id)
    throw e
  }
}

/**
 * Load an extension entry of either format. ESM entries are loaded and
 * evaluated through the VM ESM pipeline.
 */
export async function createExtensionAsync(id: string, filename: string, isEmpty: boolean): Promise<ExtensionExport> {
  if (isEmpty || !fs.existsSync(filename)) return { activate: () => {}, deactivate: null }
  disposeExtension(id)
  const logger = getLogger(!global.__isMain && !global.__TEST__, id)
  let api: unknown
  if (global.__isMain === undefined) {
    api = {}
  } else {
    api = require('../index')
  }
  const runtime = createExtensionRuntime(id, filename, api, logger)
  runtimes.set(id, runtime)
  const loader = getLoader(runtime)
  let defaultImport: any
  try {
    if (resolveModuleFormat(filename) === 'module') {
      defaultImport = await loadESMEntry(runtime, filename)
    } else {
      defaultImport = loader.loadJavaScript(filename)
    }
    if (typeof defaultImport === 'object' && defaultImport !== null &&
        typeof defaultImport['default'] === 'function' &&
        typeof defaultImport['activate'] !== 'function') {
      defaultImport = defaultImport['default']
    }
    return finalizeExports(id, defaultImport)
  } catch (e) {
    disposeExtension(id)
    throw e
  }
}

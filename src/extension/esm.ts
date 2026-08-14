'use strict'
import { fs, path, vm } from '../util/node'
import type { Module as VMModule, SourceTextModule, SyntheticModule } from 'vm'
import { fileURLToPath, pathToFileURL } from 'url'
import { getConsoleFacade } from './console'
import { getLoader } from './loader'
import type { ExtensionRuntime } from './loader'

/**
 * ESM support for the per-extension VM loader.
 *
 * ESM modules execute through `vm.SourceTextModule` inside the owning
 * extension context; `coc.nvim`, Node builtins, CommonJS modules and JSON are
 * bridged with `vm.SyntheticModule`. Node must start with
 * `--experimental-vm-modules` for the VM module API to be available.
 */

export type ExtensionModuleFormat = 'commonjs' | 'module' | 'json' | 'native'

export type ResolvedExtensionModule =
  | { type: 'builtin'; id: string }
  | { type: 'coc-api'; id: 'coc.nvim' }
  | { type: 'file'; filename: string; format: ExtensionModuleFormat }

const Module: any = require('module')

/**
 * Fail only when ESM VM support is actually required.
 */
export function ensureVMModules(): void {
  if (typeof vm.SourceTextModule !== 'function' || typeof vm.SyntheticModule !== 'function') {
    throw new Error(
      'coc.nvim requires Node.js VM modules support for ESM extensions; ' +
      'start Node with --experimental-vm-modules'
    )
  }
}

const packageTypeCache = new Map<string, 'module' | 'commonjs' | undefined>()

function getPackageType(dirname: string): 'module' | 'commonjs' | undefined {
  let dir = dirname
  while (true) {
    let pkgFile = path.join(dir, 'package.json')
    if (fs.existsSync(pkgFile)) {
      let key = pkgFile
      if (packageTypeCache.has(key)) return packageTypeCache.get(key)
      let type: 'module' | 'commonjs' | undefined
      try {
        let obj = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
        if (obj.type === 'module') {
          type = 'module'
        } else if (obj.type === 'commonjs') {
          type = 'commonjs'
        } else {
          type = undefined
        }
      } catch (e) {
        type = undefined
      }
      packageTypeCache.set(key, type)
      return type
    }
    let parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * Detect the module format of a file, honoring the nearest package.json
 * `type` field for `.js` files like Node does.
 */
export function resolveModuleFormat(filename: string, packageType?: 'module' | 'commonjs'): ExtensionModuleFormat {
  let ext = path.extname(filename).toLowerCase()
  if (ext === '.mjs') return 'module'
  if (ext === '.cjs') return 'commonjs'
  if (ext === '.json') return 'json'
  if (ext === '.node') return 'native'
  if (ext === '.js') {
    let type = packageType ?? getPackageType(path.dirname(filename))
    return type === 'module' ? 'module' : 'commonjs'
  }
  return 'commonjs'
}

function isBuiltin(request: string): boolean {
  if (request.startsWith('node:')) return true
  return Module.isBuiltin(request) === true
}

/**
 * Locate the node_modules package directory for a bare package request by
 * walking up from the parent module.
 */
function findPackageDir(parentFile: string, request: string): string | undefined {
  let name = request.startsWith('@') ? request.split('/').slice(0, 2).join('/') : request.split('/')[0]
  let dir = path.dirname(parentFile)
  while (true) {
    let candidate = path.join(dir, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate
    }
    let parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function pickCocNvimTarget(target: any): string | undefined {
  if (typeof target === 'string') return target
  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i++) {
      let res = pickCocNvimTarget(target[i])
      if (res) {
        return res
      }
    }
    return undefined
  }
  if (target !== null && typeof target === 'object') {
    if (target['coc.nvim'] !== undefined) {
      // The coc.nvim branch can itself be a nested conditions object; prefer
      // the node / require conditions like the surrounding resolver.
      return pickNestedTarget(target['coc.nvim'])
    }
  }
  return undefined
}

function pickNestedTarget(target: any): string | undefined {
  if (typeof target === 'string') return target
  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i++) {
      let res = pickNestedTarget(target[i])
      if (res) return res
    }
    return undefined
  }
  if (target !== null && typeof target === 'object') {
    for (let key of ['node', 'require', 'import', 'default']) {
      if (target[key] !== undefined) {
        let res = pickNestedTarget(target[key])
        if (res) return res
      }
    }
  }
  return undefined
}

/**
 * If the package's `exports` map exposes a `coc.nvim` condition, return that
 * target before Node's own condition matching runs. Node matches exports keys
 * in object order, so a plain conditions-set entry cannot outrank an earlier
 * `require` / `import` key; this pre-check makes the coc-specific build win.
 */
function resolveCocNvimExport(packageDir: string, subpath: string): string | undefined {
  let pkg: any
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
  } catch (e) {
    return undefined
  }
  let exportsField = pkg.exports
  if (exportsField === null || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    return undefined
  }
  // A flat conditions object (keys like import/require/coc.nvim) is the
  // package-root target itself; subpath-keyed maps use their own entry.
  let target = subpath === '.'
    ? exportsField['.'] ?? exportsField['./'] ?? exportsField
    : exportsField[subpath]
  if (target === undefined) return undefined
  return pickCocNvimTarget(target)
}

/**
 * One shared resolver for both `require` and `import` modes, backed by Node's
 * own resolution primitives. `import` mode uses the `import` export condition,
 * `require` mode uses the `require` condition.
 */
export function resolveExtensionModule(
  runtime: ExtensionRuntime,
  request: string,
  parentIdentifier: string,
  mode: 'require' | 'import'
): ResolvedExtensionModule {
  if (request === 'coc.nvim') return { type: 'coc-api', id: 'coc.nvim' }
  if (isBuiltin(request)) return { type: 'builtin', id: request }
  let parentFile = parentIdentifier.startsWith('file://') ? fileURLToPath(parentIdentifier) : parentIdentifier
  // A `coc.nvim` export condition wins over every other exports key.
  let packageDir = findPackageDir(parentFile, request)
  if (packageDir) {
    let name = request.startsWith('@') ? request.split('/').slice(0, 2).join('/') : request.split('/')[0]
    let subpath = request === name ? '.' : './' + request.slice(name.length + 1)
    let cocTarget = resolveCocNvimExport(packageDir, subpath)
    if (cocTarget) {
      let filename = tryRealpath(path.join(packageDir, cocTarget))
      if (fs.existsSync(filename)) {
        return { type: 'file', filename, format: resolveModuleFormat(filename) }
      }
    }
  }
  let record = new Module(parentFile)
  record.filename = parentFile
  record.id = parentFile
  record.paths = Module._nodeModulePaths(path.dirname(parentFile))
  let conditions = mode === 'import' ? new Set(['coc.nvim', 'node', 'import']) : new Set(['coc.nvim', 'node', 'require'])
  let filename = Module._resolveFilename(request, record, false, { conditions })
  let normalized = tryRealpath(filename)
  return { type: 'file', filename: normalized, format: resolveModuleFormat(normalized) }
}

function tryRealpath(filename: string): string {
  try {
    return fs.realpathSync(filename)
  } catch (e) {
    return filename
  }
}

export function canonicalFileURL(filename: string): string {
  return pathToFileURL(tryRealpath(filename)).href
}

/**
 * Load (and link) one ESM module in the extension runtime.
 */
export async function loadESMModule(runtime: ExtensionRuntime, request: string, parentIdentifier: string): Promise<VMModule> {
  let resolved = resolveExtensionModule(runtime, request, parentIdentifier, 'import')
  if (resolved.type === 'coc-api') return createCocApiModule(runtime)
  if (resolved.type === 'builtin') return createBuiltinModule(runtime, resolved.id)
  switch (resolved.format) {
    case 'module':
      return loadSourceTextModule(runtime, resolved.filename)
    case 'commonjs':
      return createCommonJSBridgeModule(runtime, resolved.filename)
    case 'json':
      return createJsonModule(runtime, resolved.filename)
    case 'native':
      throw new Error(`ESM import of native addon ${resolved.filename} is not supported`)
  }
}

/**
 * Dynamic `import()` path: load, link and evaluate the target module so its
 * namespace is fully initialized.
 */
export async function dynamicImportModule(runtime: ExtensionRuntime, request: string, parentIdentifier: string): Promise<VMModule> {
  let module = await loadESMModule(runtime, request, parentIdentifier)
  instantiateModule(module)
  await module.evaluate()
  return module
}

/**
 * Load an ESM file with `vm.SourceTextModule`, caching it before linking so
 * ESM cycles see the partially initialized module.
 */
export async function loadSourceTextModule(runtime: ExtensionRuntime, filename: string): Promise<SourceTextModule> {
  ensureVMModules()
  let identifier = canonicalFileURL(filename)
  let cached = runtime.esmModules.get(identifier)
  if (cached) return cached as SourceTextModule
  let source = fs.readFileSync(filename, 'utf8')
  let module = new vm.SourceTextModule(source, {
    context: runtime.context,
    identifier,
    initializeImportMeta(meta: any) {
      meta.url = identifier
      meta.resolve = (specifier: string) => {
        let resolved = resolveExtensionModule(runtime, specifier, identifier, 'import')
        if (resolved.type === 'file') return pathToFileURL(resolved.filename).href
        return resolved.id
      }
    },
    importModuleDynamically(specifier: string, referencingModule: SourceTextModule) {
      return dynamicImportModule(runtime, specifier, referencingModule.identifier)
    }
  })
  runtime.esmModules.set(identifier, module)
  try {
    let deps: VMModule[] = []
    for (let request of module.moduleRequests) {
      deps.push(await loadESMModule(runtime, request.specifier, identifier))
    }
    module.linkRequests(deps)
  } catch (e) {
    runtime.esmModules.delete(identifier)
    throw e
  }
  return module
}

/**
 * `instantiate()` must run after the whole dependency graph is linked (it
 * instantiates the complete subgraph), and only once per module.
 */
export function instantiateModule(module: VMModule): void {
  if (module.status === 'unlinked' && typeof (module as SourceTextModule).instantiate === 'function') {
    ;(module as SourceTextModule).instantiate()
  }
}

async function createSyntheticModule(
  runtime: ExtensionRuntime,
  identifier: string,
  names: string[],
  evaluator: (this: any) => void
): Promise<SyntheticModule> {
  ensureVMModules()
  let cached = runtime.esmModules.get(identifier)
  if (cached) return cached as SyntheticModule
  let module = new vm.SyntheticModule(names, evaluator, {
    context: runtime.context,
    identifier
  })
  runtime.esmModules.set(identifier, module)
  return module
}

/**
 * `import ... from 'coc.nvim'` bridge backed by the runtime API object.
 */
export function createCocApiModule(runtime: ExtensionRuntime): Promise<SyntheticModule> {
  let names = Object.keys(runtime.api as object)
  return createSyntheticModule(runtime, 'coc:nvim-api', names, function (this: any) {
    for (let name of names) {
      this.setExport(name, (runtime.api as any)[name])
    }
  })
}

/**
 * ESM import of Node builtins. `process`/`node:process` and
 * `console`/`node:console` resolve to the sandbox facades, everything else to
 * native Node values.
 */
export function createBuiltinModule(runtime: ExtensionRuntime, specifier: string): Promise<SyntheticModule> {
  let identifier = `builtin:${specifier}`
  let value: any
  if (specifier === 'process' || specifier === 'node:process') {
    value = (runtime.context as any).process
  } else if (specifier === 'console' || specifier === 'node:console') {
    value = getConsoleFacade(runtime)
  } else {
    value = require(specifier)
  }
  let names = ['default', ...Object.keys(value)]
  return createSyntheticModule(runtime, identifier, names, function (this: any) {
    this.setExport('default', value)
    for (let name of Object.keys(value)) {
      this.setExport(name, value[name])
    }
  })
}

/**
 * ESM import of CommonJS modules. The CJS module is loaded through the
 * runtime CJS cache so it never executes twice.
 */
export function createCommonJSBridgeModule(runtime: ExtensionRuntime, filename: string): Promise<SyntheticModule> {
  let identifier = `cjs-bridge:${canonicalFileURL(filename)}`
  let exports = getLoader(runtime).loadJavaScript(filename)
  return createSyntheticModule(runtime, identifier, ['default', 'module.exports'], function (this: any) {
    this.setExport('default', exports)
    this.setExport('module.exports', exports)
  })
}

/**
 * ESM import of JSON modules, cached per runtime.
 */
export function createJsonModule(runtime: ExtensionRuntime, filename: string): Promise<SyntheticModule> {
  let identifier = `json:${canonicalFileURL(filename)}`
  let value = getLoader(runtime).loadJson(filename)
  return createSyntheticModule(runtime, identifier, ['default'], function (this: any) {
    this.setExport('default', value)
  })
}

/**
 * Load and evaluate an ESM extension entry, returning its namespace.
 */
export async function loadESMEntry(runtime: ExtensionRuntime, filename: string): Promise<any> {
  ensureVMModules()
  let identifier = canonicalFileURL(filename)
  let module = await loadSourceTextModule(runtime, filename)
  try {
    instantiateModule(module)
    await module.evaluate()
  } catch (e) {
    runtime.esmModules.delete(identifier)
    throw e
  }
  return module.namespace
}

/**
 * `require()` of an ES module is rejected like Node does.
 */
export function requireESMError(filename: string): Error {
  let url = pathToFileURL(filename).href
  let err: any = new Error(`require() of ES Module ${url} not supported. Use dynamic import() instead.`)
  err.code = 'ERR_REQUIRE_ESM'
  return err
}

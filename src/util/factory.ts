'use strict'
import { createLogger } from '../logger'
import { fs, path, vm } from '../util/node'
import { defaults } from './lodash'
import { hasOwnProperty, toObject } from './object'

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

export interface IModule {
  new(name: string, parent?: boolean): any
  _resolveFilename: (file: string, context: any) => string
  _extensions: {}
  _cache: { [file: string]: any }
  _compile: (content: string, filename: string) => any
  wrap: (content: string) => string
  require: (file: string) => NodeModule
  _nodeModulePaths: (filename: string) => string[]
  createRequire: (filename: string) => (file: string) => any
}

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

const Module: IModule = require('module')
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

function removedGlobalStub(name: string) {
  return () => {
    throw new Error(`process.${name}() is not allowed in extension sandbox`)
  }
}

// @see node/lib/internal/module.js
function makeRequireFunction(this: any, cocExports: any): any {
  const req: any = (p: string) => {
    if (p === 'coc.nvim') {
      return toObject(cocExports)
    }
    return this.require(p)
  }
  req.resolve = request => Module._resolveFilename(request, this)
  req.main = mainModule
  // Enable support to add extra extension types
  req.extensions = Module._extensions
  req.cache = Module._cache
  return req
}

// @see node/lib/module.js
export function compileInSandbox(sandbox: ISandbox, cocExports?: any): (content: string, filename: string) => any {
  return function(this: any, content: string, filename: string): any {
    const require = makeRequireFunction.call(this, cocExports)
    const dirname = path.dirname(filename)
    const newContent = content.startsWith('#!') ? content.replace(/^#!.*/, '') : content
    const wrapper = Module.wrap(newContent)
    const compiledWrapper = vm.runInContext(wrapper, sandbox, { filename })
    const args = [this.exports, require, this, filename, dirname]
    return compiledWrapper.apply(this.exports, args)
  }
}

export interface ISandbox {
  process: NodeJS.Process
  module: NodeModule
  require: (p: string) => any
  console: { [key in keyof Console]?: Function }
  Buffer: any
  Reflect: any
  // eslint-disable-next-line id-blacklist
  String: any
  Promise: any
}

// find correct Module since jest use a fake Module object that extends Module
export function getProtoWithCompile(mod: Function): IModule {
  if (hasOwnProperty(mod.prototype, '_compile')) return mod.prototype
  if (hasOwnProperty(mod.prototype.__proto__, '_compile')) return mod.prototype.__proto__
  throw new Error('_compile not found')
}

const ModuleProto = getProtoWithCompile(Module)

export function createSandbox(filename: string, logger: ILogger, name?: string, noExport = global.__TEST__): ISandbox {
  const module = new Module(filename)
  module.paths = Module._nodeModulePaths(filename)

  const sandbox = vm.createContext({
    module,
    Buffer,
    URL: globalThis.URL,
    console: {
      debug: (...args: any[]) => {
        logger.debug.apply(logger, args)
      },
      log: (...args: any[]) => {
        logger.info.apply(logger, args)
      },
      error: (...args: any[]) => {
        logger.error.apply(logger, args)
      },
      info: (...args: any[]) => {
        logger.info.apply(logger, args)
      },
      warn: (...args: any[]) => {
        logger.warn.apply(logger, args)
      }
    }
  }, { name }) as ISandbox

  defaults(sandbox, global)
  sandbox.Reflect = Reflect
  let cocExports = noExport ? undefined : require('../index')
  sandbox.require = function sandboxRequire(p): any {
    const oldCompile = ModuleProto._compile
    ModuleProto._compile = compileInSandbox(sandbox, cocExports)
    const moduleExports = sandbox.module.require(p)
    ModuleProto._compile = oldCompile
    return moduleExports
  }

  // patch `require` in sandbox to run loaded module in sandbox context
  // if you need any of these, it might be worth discussing spawning separate processes
  sandbox.process = new (process as any).constructor()
  for (let key of Object.keys(process)) {
    sandbox.process[key] = process[key]
  }

  REMOVED_GLOBALS.forEach(name => {
    sandbox.process[name] = removedGlobalStub(name)
  })
  sandbox.process['chdir'] = () => {}

  // read-only umask
  sandbox.process.umask = (mask?: number) => {
    if (typeof mask !== 'undefined') {
      throw new Error('Cannot use process.umask() to change mask (read-only)')
    }
    return process.umask()
  }

  return sandbox
}

function getLogger(useConsole: boolean, id: string): ILogger {
  return useConsole ? consoleLogger : createLogger(`extension:${id}`)
}

// inspiration drawn from Module
export function createExtension(id: string, filename: string, isEmpty: boolean): ExtensionExport {
  if (isEmpty || !fs.existsSync(filename)) return {
    activate: () => {},
    deactivate: null
  }
  const logger = getLogger(!global.__isMain && !global.__TEST__, id)
  const sandbox = createSandbox(filename, logger, id)

  delete Module._cache[require.resolve(filename)]

  // attempt to import plugin
  // Require plugin to export activate & deactivate
  const defaultImport = sandbox.require(filename)
  const activate = (defaultImport && defaultImport.activate) || defaultImport
  if (typeof activate !== 'function') return { activate: () => {} }
  return typeof defaultImport === 'function' ? { activate } : Object.assign({}, defaultImport)
}

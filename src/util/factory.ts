import fs from 'fs'
import { Logger } from 'log4js'
import * as path from 'path'
import * as vm from 'vm'
import { ExtensionContext } from '../types'
import { defaults } from './lodash'
const createLogger = require('./logger')
const logger = createLogger('util-factoroy')

declare var __webpack_require__: any
declare var __non_webpack_require__: any
const requireFunc = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require

export interface ExtensionExport {
  activate: (context: ExtensionContext) => any
  deactivate: () => any | null
}

export interface IModule {
  new(name: string): any
  _resolveFilename: (file: string, context: any) => string
  _extensions: {}
  _cache: { [file: string]: any }
  _compile: () => void
  wrap: (content: string) => string
  require: (file: string) => NodeModule
  _nodeModulePaths: (filename: string) => string[]
}

const Module: IModule = require('module')

const REMOVED_GLOBALS = [
  'reallyExit',
  'abort',
  'chdir',
  'umask',
  'setuid',
  'setgid',
  'setgroups',
  '_fatalException',
  'exit',
  'kill',
]

function removedGlobalStub(name: string): Function {
  return () => {
    throw new Error(`process.${name}() is not allowed in extension sandbox`)
  }
}

// @see node/lib/internal/module.js
function makeRequireFunction(this: any): any {
  const req: any = (p: string) => {
    if (p === 'coc.nvim') {
      return require('../index')
    }
    return this.require(p)
  }
  req.resolve = (request: string) => Module._resolveFilename(request, this)
  req.main = process.mainModule
  // Enable support to add extra extension types
  req.extensions = Module._extensions
  req.cache = Module._cache
  return req
}

// @see node/lib/module.js
function compileInSandbox(sandbox: ISandbox): Function {
  // eslint-disable-next-line
  return function(this: any, content: string, filename: string): any {
    const require = makeRequireFunction.call(this)
    const dirname = path.dirname(filename)
    // remove shebang
    // eslint-disable-next-line
    const newContent = content.replace(/^\#\!.*/, '')
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
  String: any
  Promise: any
}

function createSandbox(filename: string, logger: Logger): ISandbox {
  const module = new Module(filename)
  module.paths = Module._nodeModulePaths(filename)

  const sandbox = vm.createContext({
    module,
    Buffer,
    console: {
      debug: (...args: any[]) => {
        logger.debug.apply(logger, args)
      },
      log: (...args: any[]) => {
        logger.debug.apply(logger, args)
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
  }) as ISandbox

  defaults(sandbox, global)
  sandbox.Reflect = Reflect

  sandbox.require = function sandboxRequire(p): any {
    const oldCompile = Module.prototype._compile
    Module.prototype._compile = compileInSandbox(sandbox)
    const moduleExports = sandbox.module.require(p)
    Module.prototype._compile = oldCompile
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

  // read-only umask
  sandbox.process.umask = (mask: number) => {
    if (typeof mask !== 'undefined') {
      throw new Error('Cannot use process.umask() to change mask (read-only)')
    }
    return process.umask()
  }

  return sandbox
}

// inspiration drawn from Module
export function createExtension(id: string, filename: string): ExtensionExport {
  if (!fs.existsSync(filename)) {
    // tslint:disable-next-line:no-empty
    return { activate: () => { }, deactivate: null }
  }
  const sandbox = createSandbox(filename, createLogger(`extension-${id}`))

  delete Module._cache[requireFunc.resolve(filename)]

  // attempt to import plugin
  // Require plugin to export activate & deactivate
  const defaultImport = sandbox.require(filename)
  const activate = (defaultImport && defaultImport.activate) || defaultImport

  if (typeof activate !== 'function') {
    // tslint:disable-next-line:no-empty
    return { activate: () => { }, deactivate: null }
  }
  return {
    activate,
    deactivate: typeof defaultImport.deactivate === 'function' ? defaultImport.deactivate : null
  }
}

import * as path from 'path'
import * as vm from 'vm'
import { omit, defaults } from './lodash'
import { DevNull } from './devnull'
import workspace from '../workspace'
import { ExtensionContext } from '../types'
const logger = require('./logger')('util-factoroy')

export type Active = (context: ExtensionContext) => any

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

const coc = require('../')

const Module: IModule = require('module')

const REMOVED_GLOBALS = [
  'reallyExit',
  'abort',
  'chdir',
  'umask',
  'setuid',
  'setgid',
  'setgroups',
  '_kill',
  'EventEmitter',
  '_maxListeners',
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
  const require: any = (p: string) => {
    if (p === 'coc.nvim') {
      return coc
    }
    return this.require(p)
  }
  require.resolve = (request: string) => Module._resolveFilename(request, this)
  require.main = process.mainModule
  // Enable support to add extra extension types
  require.extensions = Module._extensions
  require.cache = Module._cache
  return require
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
}

function createSandbox(filename: string): ISandbox {
  const module = new Module(filename)
  module.paths = Module._nodeModulePaths(filename)

  const sandbox = vm.createContext({
    module,
    console
  }) as ISandbox

  defaults(sandbox, global)

  sandbox.require = function sandboxRequire(p): any {
    const oldCompile = Module.prototype._compile
    Module.prototype._compile = compileInSandbox(sandbox)
    const moduleExports = sandbox.module.require(p)
    Module.prototype._compile = oldCompile
    return moduleExports
  }

  // patch `require` in sandbox to run loaded module in sandbox context
  // if you need any of these, it might be worth discussing spawning separate processes
  // sandbox.process = omit(process, REMOVED_GLOBALS) as NodeJS.Process

  REMOVED_GLOBALS.forEach(name => {
    sandbox.process[name] = removedGlobalStub(name)
  })

  const devNull = new DevNull()

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
export function createExtension(filename: string): Active {
  try {
    const sandbox = createSandbox(filename)

    delete Module._cache[require.resolve(filename)]

    // attempt to import plugin
    // Require plugin to export a class
    const defaultImport = sandbox.require(filename)
    const active = (defaultImport && defaultImport.activate) || defaultImport

    if (typeof active !== 'function') {
      workspace.showMessage(`activate method not found in ${filename}`, 'error')
      return
    }
    return active
  } catch (err) {
    logger.error(`Error loading child ChildPlugin ${filename}`)
    logger.error(err.stack)
  }

  // There may have been an error, but maybe not
  return null
}

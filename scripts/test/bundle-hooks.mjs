'use strict'
import {builtinModules, createRequire, registerHooks} from 'node:module'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {threadId} from 'node:worker_threads'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import {bundleFile, projectRoot} from './paths.mjs'

const require = createRequire(import.meta.url)

const TEST_TS_RE = new RegExp(
  `^file://${projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/src/__tests__/.*\\.ts$`
)
const sessionKey = 'coc-test/edit_session'
const nodeTestKey = 'coc-test/node-test'
const compiled = new Map()
let initialized = false

/**
 * node:test's run({files, isolation: 'none'}) ignores testNamePatterns, so
 * when a -t pattern is given we intercept `node:test` imports and wrap
 * describe/it/test to skip non-matching names (matched against the full
 * hierarchical name, same as the CLI's --test-name-pattern).
 */
function filteredNodeTestSource(pattern) {
  return `
const pattern = new RegExp(${JSON.stringify(pattern)})
const nodeTest = process.getBuiltinModule('node:test')
const stack = []
function fullName(name) {
  return stack.length === 0 ? name : stack.join(' > ') + ' > ' + name
}
function wrappedTest(fn) {
  return function (...args) {
    const name = typeof args[0] === 'string' ? args[0] : typeof args[1] === 'string' ? args[1] : ''
    if (name && !pattern.test(fullName(name))) return
    return fn.apply(this, args)
  }
}
function wrappedDescribe(fn) {
  return function (...args) {
    const name = typeof args[0] === 'string' ? args[0] : typeof args[1] === 'string' ? args[1] : ''
    if (name) stack.push(name)
    try {
      return fn.apply(this, args)
    } finally {
      if (name) stack.pop()
    }
  }
}
export const test = wrappedTest(nodeTest.test)
export const it = wrappedTest(nodeTest.it)
export const describe = wrappedDescribe(nodeTest.describe)
export const before = nodeTest.before
export const after = nodeTest.after
export const beforeEach = nodeTest.beforeEach
export const afterEach = nodeTest.afterEach
export const skip = nodeTest.skip
export const todo = nodeTest.todo
export const mock = nodeTest.mock
export const run = nodeTest.run
export default nodeTest
`
}

function setupTestEnvironment(editor) {
  if (globalThis.__TEST__ !== undefined) return
  globalThis.__TEST__ = true
  if (editor === 'vim') process.env.VIM_NODE_RPC = '1'
  else delete process.env.VIM_NODE_RPC
  // Worker threads share a PID, so threadId keeps their data homes isolated.
  // Unit tests use os.tmpdir()/coc-test for scratch files; runner state stays
  // under the separate coc-test-native base.
  const dataHome = path.join(os.tmpdir(), 'coc-test-native', editor ?? 'unit', `${process.pid}-${threadId}`)
  fs.mkdirSync(path.join(dataHome, 'mcp'), {recursive: true})
  fs.mkdirSync(path.join(dataHome, 'vimconfig'), {recursive: true})
  process.env.NODE_ENV = 'test'
  process.env.COC_NVIM = '1'
  process.env.VIMRUNTIME = ''
  process.env.COC_DATA_HOME = dataHome
  process.env.XDG_RUNTIME_DIR = dataHome
  process.env.COC_MCP_DIR = path.join(dataHome, 'mcp')
  process.env.COC_VIMCONFIG = path.join(dataHome, 'vimconfig')
  process.env.NVIM_LOG_FILE = path.join(dataHome, 'nvim.log')
}

let bundleObj = globalThis.__cocBundle = require(bundleFile)

function srcKeyFor(resolved) {
  const rel = path.relative(projectRoot, resolved)
  if (!rel || rel.startsWith('..')) return undefined
  if (!rel.startsWith('src')) return undefined
  if (rel.startsWith('src' + path.sep + '__tests__')) return undefined
  const withoutExt = rel.endsWith('.ts') ? rel.slice(0, -3) : rel
  for (const candidate of [withoutExt, path.join(withoutExt, 'index')]) {
    if (fs.existsSync(path.join(projectRoot, candidate + '.ts'))) {
      return candidate.split(path.sep).join('/')
    }
  }
  return undefined
}

/**
 * Initializes the test runtime exactly once, before node:test loads any test
 * entry or dependency. Records are passed directly by the execution endpoint;
 * no process-global handoff is used.
 */
export function initializeTestHooks(records, editor, sessionSource, namePattern) {
  if (initialized) throw new Error('coc-test: test hooks already initialized')
  initialized = true
  for (const record of records) compiled.set(record.url, record)
  setupTestEnvironment(editor)
  registerTestHooks(sessionSource, namePattern)
}

function registerTestHooks(sessionSource, namePattern) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === sessionKey) {
        return {url: 'coc-test:edit_session', shortCircuit: true}
      }
      if (namePattern && specifier === 'node:test') {
        return {url: nodeTestKey, shortCircuit: true}
      }
      if (specifier.startsWith('coc-bundle:')) {
        return {url: specifier, shortCircuit: true}
      }
      if (compiled.has(specifier) || TEST_TS_RE.test(specifier)) {
        return {url: specifier, shortCircuit: true}
      }
      if (context.parentURL && (specifier.startsWith('./') || specifier.startsWith('../'))) {
        const parent = fileURLToPath(context.parentURL)
        const resolved = path.resolve(path.dirname(parent), specifier)
        const key = srcKeyFor(resolved)
        if (key) {
          return {url: `coc-bundle:${key}`, shortCircuit: true}
        }
        // src/__tests__ infra (testUtils, ...) is compiled in memory too;
        // resolve the extensionless import to its .ts file.
        const rel = path.relative(projectRoot, resolved)
        if (rel.startsWith('src' + path.sep + '__tests__')) {
          const ts = resolved.endsWith('.ts') ? resolved : resolved + '.ts'
          const url = pathToFileURL(ts).href
          if (compiled.has(url)) {
            return {url, shortCircuit: true}
          }
        }
        return nextResolve(specifier, context)
      }
      // Third-party packages imported by in-memory test modules:
      // packages bundled into the runtime are routed to the bundle's `pkg:<spec>`
      // export so tests reference the exact instance the bundle uses instead of
      // loading node_modules again. Anything not in the bundle (test-only deps)
      // falls back to the repository node_modules.
      if (context.parentURL &&
        !specifier.startsWith('node:') && !builtinModules.includes(specifier) &&
        !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:')) {
        const parentIsTest = compiled.has(context.parentURL) || TEST_TS_RE.test(context.parentURL)
        if (parentIsTest) {
          if (bundleObj[`pkg:${specifier}`] !== undefined) {
            return {url: `coc-bundle:pkg:${specifier}`, shortCircuit: true}
          }
          try {
            const resolved = require.resolve(specifier, {paths: [projectRoot]})
            if (resolved !== specifier) {
              return {url: 'coc-pkg:' + resolved, shortCircuit: true}
            }
          } catch {
            // fall through to default resolution
          }
        }
      }
      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (url === 'coc-test:edit_session') {
        return {
          format: 'module',
          source: sessionSource ?? '',
          shortCircuit: true,
        }
      }
      if (url === nodeTestKey) {
        return {
          format: 'module',
          source: filteredNodeTestSource(namePattern),
          shortCircuit: true,
        }
      }
      if (url.startsWith('coc-bundle:')) {
        const key = url.slice('coc-bundle:'.length)
        const ns = bundleObj[key]
        if (!ns) {
          throw new Error(`coc-test: bundle module not found: ${key}`)
        }
        // ESM static named imports need statically declared exports, so emit
        // explicit `export const` bindings from the (CJS) bundle namespace
        // instead of returning a CJS module (which cjs-module-lexer cannot
        // introspect for this dynamic assignment).
        const lines = [`const __cocNs = globalThis.__cocBundle[${JSON.stringify(key)}]`]
        for (const name of Object.keys(ns)) {
          if (name === 'default') continue
          lines.push(`export const ${name} = __cocNs[${JSON.stringify(name)}]`)
        }
        // CJS packages whose module.exports is a callable (e.g. `which`) have
        // no `default` key on the namespace; fall back to the namespace itself.
        lines.push('export default __cocNs.default !== undefined ? __cocNs.default : __cocNs')
        return {
          format: 'module',
          source: lines.join('\n'),
          shortCircuit: true,
        }
      }
      const compiledRecord = compiled.get(url)
      if (compiledRecord) {
        return {
          format: 'module',
          source: compiledRecord.source,
          shortCircuit: true,
        }
      }
      if (url.startsWith('coc-pkg:')) {
        const pkgPath = url.slice('coc-pkg:'.length)
        const cjs = require(pkgPath)
        const lines = [
          "import { createRequire } from 'node:module'",
          `const require = createRequire(${JSON.stringify(pkgPath)})`,
          `const __cjs = require(${JSON.stringify(pkgPath)})`,
          'export default __cjs.default !== undefined ? __cjs.default : __cjs',
        ]
        for (const name of Object.keys(cjs)) {
          if (name === 'default' || name === '__esModule') continue
          lines.push(`export const ${name} = __cjs[${JSON.stringify(name)}]`)
        }
        return {
          format: 'module',
          source: lines.join('\n'),
          shortCircuit: true,
        }
      }
      return nextLoad(url, context)
    },
  })
}

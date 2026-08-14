import fs from 'fs'
import os from 'os'
import path from 'path'
import { createExtensionRuntime, getLoader } from '../../extension/loader'
import type { ILogger } from '../../extension/loader'

let folders: string[] = []

function createFolder(): string {
  let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-console-'))
  folders.push(folder)
  return folder
}

after(() => {
  for (let folder of folders) {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

function makeLogger(): { logger: ILogger; calls: string[] } {
  let calls: string[] = []
  let record = (level: string) => (...args: any[]) => {
    calls.push(`${level}:${args.map(a => typeof a === 'string' ? a : String(a)).join(' ')}`)
  }
  let logger = {
    category: 'extension:console-test',
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

function load(entry: string, logger: ILogger): { runtime: ReturnType<typeof createExtensionRuntime>; exports: any } {
  let runtime = createExtensionRuntime('console-test', entry, {}, logger)
  let loader = getLoader(runtime)
  return { runtime, exports: loader.loadJavaScript(entry) }
}

describe('extension console', () => {
  it('should route console methods to the extension logger', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.log('log-message')
console.info('info-message')
console.warn('warn-message')
console.error('error-message')
console.debug('debug-message')
module.exports = 1`)
    let { logger, calls } = makeLogger()
    load(entry, logger)
    assert.deepStrictEqual(calls, [
      'info:log-message',
      'info:info-message',
      'warn:warn-message',
      'error:error-message',
      'debug:debug-message'
    ])
  })

  it('should isolate console and state between extensions', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.log('from-a')
module.exports = { same: console === globalThis.console }`)
    let hostLog = global.console.log
    let a = makeLogger()
    let b = makeLogger()
    let ra = load(entry, a.logger)
    let rb = load(entry, b.logger)
    assert.notStrictEqual(ra.runtime.console, rb.runtime.console)
    assert.notStrictEqual(ra.runtime.consoleState, rb.runtime.consoleState)
    assert.strictEqual(a.calls.length, 1)
    assert.strictEqual(b.calls.length, 1)
    // The process-global console is never modified.
    assert.strictEqual(global.console.log, hostLog)
    assert.strictEqual(ra.exports.same, true)
  })

  it('should keep extension identity for detached methods', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
let log = console.log
log('detached')
module.exports = 1`)
    let { logger, calls } = makeLogger()
    load(entry, logger)
    assert.deepStrictEqual(calls, ['info:detached'])
  })

  it('should format output like Node', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.log('%s %d', 'value', 1)
console.log({ foo: 'bar' })
console.error(new Error('test'))
console.dir({ a: 1, b: [1, 2] })
module.exports = 1`)
    let { logger, calls } = makeLogger()
    load(entry, logger)
    assert.strictEqual(calls[0], 'info:value 1')
    assert.match(calls[1], /foo/)
    assert.match(calls[2], /Error: test/)
    assert.match(calls[3], /\{ a: 1, b: \[ 1, 2 \] \}/)
  })

  it('should allow two extensions to use the same timer label', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.time('load')
module.exports = { end: () => console.timeEnd('load') }`)
    let a = makeLogger()
    let b = makeLogger()
    let ra = load(entry, a.logger)
    let rb = load(entry, b.logger)
    assert.strictEqual(ra.runtime.consoleState.timers.size, 1)
    assert.strictEqual(rb.runtime.consoleState.timers.size, 1)
    ;(ra.exports as any).end()
    ;(rb.exports as any).end()
    assert.match(a.calls[0], /^info:load: .*ms$/)
    assert.match(b.calls[0], /^info:load: .*ms$/)
    assert.strictEqual(ra.runtime.consoleState.timers.size, 0)
    assert.strictEqual(rb.runtime.consoleState.timers.size, 0)
  })

  it('should warn on duplicate or missing timer labels', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.time('load')
console.time('load')
console.timeEnd('load')
console.timeEnd('missing')
console.timeLog('missing')
module.exports = 1`)
    let { logger, calls } = makeLogger()
    let { runtime } = load(entry, logger)
    assert.strictEqual(runtime.consoleState.timers.size, 0)
    assert.strictEqual(calls.length, 4)
    assert.match(calls[0], /Warning: Label 'load' already exists/)
    assert.match(calls[1], /^info:load: .*ms$/)
    assert.match(calls[2], /Warning: No such label 'missing' for console.timeEnd/)
    assert.match(calls[3], /Warning: No such label 'missing' for console.timeLog/)
  })

  it('should keep counters isolated per extension', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.count()
console.count()
console.count('x')
console.countReset('x')
console.count('x')
module.exports = 1`)
    let a = makeLogger()
    let b = makeLogger()
    let ra = load(entry, a.logger)
    let rb = load(entry, b.logger)
    assert.deepStrictEqual(a.calls, ['info:default: 1', 'info:default: 2', 'info:x: 1', 'info:x: 1'])
    assert.deepStrictEqual(b.calls, ['info:default: 1', 'info:default: 2', 'info:x: 1', 'info:x: 1'])
    assert.strictEqual(ra.runtime.consoleState.counters.size, 2)
    assert.strictEqual(rb.runtime.consoleState.counters.size, 2)
  })

  it('should indent groups and never go below zero depth', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.group('outer')
console.log('inside')
console.group('inner')
console.log('deeper')
console.groupEnd()
console.log('middle')
console.groupEnd()
console.log('flat')
console.groupEnd()
module.exports = 1`)
    let { logger, calls } = makeLogger()
    let { runtime } = load(entry, logger)
    assert.strictEqual(runtime.consoleState.groupDepth, 0)
    assert.deepStrictEqual(calls, [
      'info:outer',
      'info:  inside',
      'info:  inner',
      'info:    deeper',
      'info:  middle',
      'info:flat'
    ])
  })

  it('should log failed assertions without throwing', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.assert(true, 'never')
console.assert(false, 'boom', 1)
module.exports = 1`)
    let { logger, calls } = makeLogger()
    let exports = load(entry, logger).exports
    assert.strictEqual(exports, 1)
    assert.deepStrictEqual(calls, ['error:Assertion failed: boom 1'])
  })

  it('should trace with the extension source file in the stack', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'trace.js')
    fs.writeFileSync(entry, `
function inner() {
  console.trace('marker')
}
inner()
module.exports = 1`)
    let { logger, calls } = makeLogger()
    load(entry, logger)
    assert.strictEqual(calls.length, 1)
    assert.match(calls[0], /marker/)
    assert.match(calls[0], /trace\.js/)
  })

  it('should produce table output for common values', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.table([{ a: 1, b: 2 }, { a: 3 }])
console.table(new Map([['k', 1]]))
console.table(new Set([1, 2]))
console.table('unsupported')
module.exports = 1`)
    let { logger, calls } = makeLogger()
    load(entry, logger)
    assert.match(calls[0], /\(index\).*a.*b/s)
    assert.match(calls[0], /0\t1\t2/)
    assert.match(calls[1], /Key\tValue/)
    assert.match(calls[1], /k\t1/)
    assert.match(calls[2], /1/)
    assert.match(calls[3], /unsupported/)
  })

  it('should route require("console") through the owning extension console', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
const c1 = require('console')
const c2 = require('node:console')
const { Console } = require('node:console')
const { Writable } = require('node:stream')
const chunks = []
const out = new Writable({
  write(chunk, enc, cb) {
    chunks.push(String(chunk))
    cb()
  }
})
const own = new Console({ stdout: out, stderr: out })
own.log('native-console')
console.log('facade-log')
c1.log('module-log')
exports.activate = () => ({
  sameFacade: c1 === c2,
  routes: c1.log === console.log,
  consoleClass: typeof Console,
  native: chunks.join('')
})`)
    let { logger, calls } = makeLogger()
    let { exports } = load(entry, logger)
    let res = exports.activate({})
    assert.strictEqual(res.sameFacade, true)
    assert.strictEqual(res.routes, true)
    assert.strictEqual(res.consoleClass, 'function')
    assert.strictEqual(res.native, 'native-console\n')
    assert.deepStrictEqual(calls, ['info:facade-log', 'info:module-log'])
  })

  it('should reset console state and identity on reload', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.time('load')
console.count('c')
console.group('g')
exports.activate = () => ({
  facade: require('node:console'),
  count: () => console.count('c')
})`)
    let a = makeLogger()
    let ra = load(entry, a.logger)
    assert.strictEqual(ra.runtime.consoleState.timers.size, 1)
    assert.strictEqual(ra.runtime.consoleState.counters.get('c'), 1)
    assert.strictEqual(ra.runtime.consoleState.groupDepth, 1)
    let facadeA = ra.exports.activate({}).facade
    ra.exports.activate({}).count()
    assert.match(a.calls[a.calls.length - 1], /c: 2/)
    // Reload: a fresh runtime must not reuse console, state or facade.
    let b = makeLogger()
    let rb = load(entry, b.logger)
    assert.notStrictEqual(ra.runtime.console, rb.runtime.console)
    assert.notStrictEqual(ra.runtime.consoleState, rb.runtime.consoleState)
    assert.strictEqual(rb.runtime.consoleState.timers.size, 1)
    assert.strictEqual(rb.runtime.consoleState.counters.get('c'), 1)
    assert.strictEqual(rb.runtime.consoleState.groupDepth, 1)
    let facadeB = rb.exports.activate({}).facade
    assert.notStrictEqual(facadeA, facadeB)
  })

  it('should not crash when the extension logger fails', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.log('boom')
console.time('x')
console.timeEnd('missing')
console.assert(false, 'bad')
console.table({ a: 1 })
module.exports = 1`)
    let throwing: ILogger = {
      log: () => { throw new Error('log failed') },
      trace: () => { throw new Error('trace failed') },
      debug: () => { throw new Error('debug failed') },
      info: () => { throw new Error('info failed') },
      warn: () => { throw new Error('warn failed') },
      error: () => { throw new Error('error failed') },
      fatal: () => { throw new Error('fatal failed') },
      mark: () => { throw new Error('mark failed') }
    }
    let exports = load(entry, throwing).exports
    assert.strictEqual(exports, 1)
  })

  it('should make clear and profile methods safe no-ops', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.clear()
console.profile('x')
console.profileEnd()
console.timeStamp('t')
module.exports = 1`)
    let { logger, calls } = makeLogger()
    let exports = load(entry, logger).exports
    assert.strictEqual(exports, 1)
    assert.strictEqual(calls.length, 0)
  })

  it('should prefix output with the extension id when the logger has no category', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.log('hello')
console.warn('careful')
module.exports = 1`)
    let calls: string[] = []
    let logger = {
      log: (...args: any[]) => calls.push('log:' + args.join(' ')),
      trace: (...args: any[]) => calls.push('trace:' + args.join(' ')),
      debug: (...args: any[]) => calls.push('debug:' + args.join(' ')),
      info: (...args: any[]) => calls.push('info:' + args.join(' ')),
      warn: (...args: any[]) => calls.push('warn:' + args.join(' ')),
      error: (...args: any[]) => calls.push('error:' + args.join(' ')),
      fatal: (...args: any[]) => calls.push('fatal:' + args.join(' ')),
      mark: (...args: any[]) => calls.push('mark:' + args.join(' '))
    }
    load(entry, logger)
    assert.deepStrictEqual(calls, [
      'info:extension:console-test hello',
      'warn:extension:console-test careful'
    ])
  })

  it('should support console edge behaviors', () => {
    let folder = createFolder()
    let entry = path.join(folder, 'index.js')
    fs.writeFileSync(entry, `
console.log()
console.trace()
console.assert(false)
console.dir({ a: 1 }, { depth: 0 })
console.dirxml({ b: 2 })
console.groupCollapsed('collapsed')
console.log('inside')
console.groupEnd()
console.time('t')
console.timeLog('t', 'arg')
console.timeEnd('t')
console.table([1, 2])
module.exports = 1`)
    let { logger, calls } = makeLogger()
    let exports = load(entry, logger).exports
    assert.strictEqual(exports, 1)
    assert.strictEqual(calls.length, 10)
    assert.strictEqual(calls[0], 'info:')
    assert.match(calls[1], /^trace:Trace/)
    assert.match(calls[2], /error:Assertion failed$/)
    assert.match(calls[4], /\{ b: 2 \}/)
    assert.match(calls[5], /collapsed/)
    assert.match(calls[6], / {2}inside/)
    assert.match(calls[7], /^info:t: .*ms arg$/)
    assert.match(calls[8], /^info:t: .*ms$/)
    assert.match(calls[9], /\(index\).*Value/)
  })
})

'use strict'
import { format, inspect } from '../util/node'
import type { ExtensionRuntime, ILogger } from './loader'

/**
 * Per-extension enhanced console.
 *
 * Every extension owns one console object and one console state (timers,
 * counters, group depth). Methods are closures over the owning logger and
 * state, so detached methods keep their extension identity and timers or
 * counters never cross extension boundaries. The process-global console is
 * never modified.
 */

export interface ExtensionConsoleState {
  timers: Map<string, bigint>
  counters: Map<string, number>
  groupDepth: number
}

const CONSOLE_METHODS = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'assert',
  'dir',
  'dirxml',
  'table',
  'time',
  'timeLog',
  'timeEnd',
  'count',
  'countReset',
  'group',
  'groupCollapsed',
  'groupEnd',
  'clear',
  'profile',
  'profileEnd',
  'timeStamp',
] as const

function formatDuration(diff: bigint): string {
  let ms = Number(diff) / 1e6
  let text = ms.toFixed(3).replace(/\.?0+$/, '')
  return `${text}ms`
}

function formatCell(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value
  if (typeof value === 'object') return inspect(value, { depth: 1, colors: false })
  return String(value)
}

/**
 * Deterministic text table for common console.table inputs. Unsupported
 * values fall back to util.inspect and never throw.
 */
export function formatTable(data: unknown): string {
  try {
    if (Array.isArray(data)) {
      if (data.length === 0) return '(empty table)'
      let rows = data as unknown[]
      if (rows.every(item => item !== null && typeof item === 'object')) {
        let keys: string[] = []
        let objects = rows as Record<string, unknown>[]
        for (let row of objects) {
          for (let key of Object.keys(row)) {
            if (!keys.includes(key)) keys.push(key)
          }
        }
        if (keys.length === 0) return '(empty table)'
        let lines = [`(index)\t${keys.join('\t')}`]
        objects.forEach((row, i) => {
          lines.push(`${i}\t${keys.map(k => formatCell(row[k])).join('\t')}`)
        })
        return lines.join('\n')
      }
      let lines = ['(index)\tValue']
      rows.forEach((value, i) => lines.push(`${i}\t${formatCell(value)}`))
      return lines.join('\n')
    }
    let tag = Object.prototype.toString.call(data)
    if (tag === '[object Map]') {
      let lines = ['Key\tValue']
      for (let [key, value] of data as Map<unknown, unknown>) {
        lines.push(`${formatCell(key)}\t${formatCell(value)}`)
      }
      return lines.join('\n')
    }
    if (tag === '[object Set]') {
      let lines = ['Value']
      for (let value of data as Set<unknown>) lines.push(formatCell(value))
      return lines.join('\n')
    }
    if (data !== null && typeof data === 'object') {
      let entries = Object.entries(data as Record<string, unknown>)
      if (entries.length === 0) return '(empty table)'
      let lines = ['Key\tValue']
      for (let [key, value] of entries) lines.push(`${key}\t${formatCell(value)}`)
      return lines.join('\n')
    }
    return inspect(data, { colors: false })
  } catch (e) {
    try {
      return inspect(data, { colors: false })
    } catch (err) {
      return String(data)
    }
  }
}

/**
 * Create the per-extension console and its isolated state.
 */
export function createExtensionConsole(extensionId: string, logger: ILogger): { console: Console; state: ExtensionConsoleState } {
  let state: ExtensionConsoleState = {
    timers: new Map(),
    counters: new Map(),
    groupDepth: 0
  }

  const indent = (): string => '  '.repeat(state.groupDepth)

  // Attribute every line to the owning extension. The coc.nvim extension
  // logger already carries the `extension:<id>` category, so its output keeps
  // the historical format; loggers without that category get an explicit
  // `extension:<id>` prefix.
  const attributed = typeof logger.category === 'string' && logger.category.includes(extensionId)
  const attribution = attributed ? '' : `extension:${extensionId} `
  const emit = (level: 'info' | 'warn' | 'error' | 'debug' | 'trace', text: string): void => {
    logger[level](`${indent()}${attribution}${text}`)
  }

  // Internal console failures must not recurse into the extension console;
  // fall back to the coc.nvim internal logger and swallow final failures.
  const fallback = (method: string, error: unknown): void => {
    let message = String(error)
    if (error instanceof Error) message = error.message
    try {
      logger.error(`extension:${extensionId} console.${method} internal error: ${message}`)
    } catch (e) {
      // Never let console failures escape into extension code.
    }
  }

  const safe = (method: string, fn: () => void): void => {
    try {
      fn()
    } catch (e) {
      fallback(method, e)
    }
  }

  const write = (level: 'info' | 'warn' | 'error' | 'debug', args: unknown[]): void => {
    let message = args.length === 0 ? '' : format(...args)
    emit(level, message)
  }

  let consoleObj: Record<string, unknown> = {
    log: (...args: unknown[]) => safe('log', () => write('info', args)),
    info: (...args: unknown[]) => safe('info', () => write('info', args)),
    warn: (...args: unknown[]) => safe('warn', () => write('warn', args)),
    error: (...args: unknown[]) => safe('error', () => write('error', args)),
    debug: (...args: unknown[]) => safe('debug', () => write('debug', args)),
    trace: function trace(...args: unknown[]): void {
      safe('trace', () => {
        let message = args.length === 0 ? 'Trace' : format(...args)
        let err = new Error()
        Error.captureStackTrace(err, trace)
        let stack = ''
        if (err.stack) stack = err.stack.split('\n').slice(1).join('\n')
        emit('trace', `${message}\n${stack}`)
      })
    },
    assert: (condition: unknown, ...args: unknown[]): void => {
      safe('assert', () => {
        if (condition) return
        emit('error', `Assertion failed${args.length ? `: ${format(...args)}` : ''}`)
      })
    },
    dir: (...args: unknown[]): void => {
      safe('dir', () => {
        let value = args[0]
        let options = args.length > 1 && args[1] !== null && typeof args[1] === 'object' ? args[1] as Record<string, unknown> : {}
        emit('info', inspect(value, { colors: false, showHidden: false, depth: 2, ...options }))
      })
    },
    dirxml: (...args: unknown[]): void => {
      safe('dirxml', () => {
        let value = args[0]
        emit('info', inspect(value, { colors: false, showHidden: false, depth: 2 }))
      })
    },
    table: (...args: unknown[]): void => {
      safe('table', () => {
        emit('info', formatTable(args[0]))
      })
    },
    time: (label = 'default'): void => {
      safe('time', () => {
        if (state.timers.has(label)) {
          emit('warn', `Warning: Label '${label}' already exists for console.time()`)
          return
        }
        state.timers.set(label, process.hrtime.bigint())
      })
    },
    timeLog: (label = 'default', ...args: unknown[]): void => {
      safe('timeLog', () => {
        let start = state.timers.get(label)
        if (start === undefined) {
          emit('warn', `Warning: No such label '${label}' for console.timeLog()`)
          return
        }
        let suffix = ''
        if (args.length) suffix = ` ${format(...args)}`
        emit('info', `${label}: ${formatDuration(process.hrtime.bigint() - start)}${suffix}`)
      })
    },
    timeEnd: (label = 'default'): void => {
      safe('timeEnd', () => {
        let start = state.timers.get(label)
        if (start === undefined) {
          emit('warn', `Warning: No such label '${label}' for console.timeEnd()`)
          return
        }
        state.timers.delete(label)
        emit('info', `${label}: ${formatDuration(process.hrtime.bigint() - start)}`)
      })
    },
    count: (label = 'default'): void => {
      safe('count', () => {
        let n = (state.counters.get(label) ?? 0) + 1
        state.counters.set(label, n)
        emit('info', `${label}: ${n}`)
      })
    },
    countReset: (label = 'default'): void => {
      safe('countReset', () => {
        state.counters.delete(label)
      })
    },
    group: (...args: unknown[]): void => {
      safe('group', () => {
        if (args.length) emit('info', format(...args))
        state.groupDepth++
      })
    },
    groupCollapsed: (...args: unknown[]): void => {
      safe('groupCollapsed', () => {
        if (args.length) emit('info', format(...args))
        state.groupDepth++
      })
    },
    groupEnd: (): void => {
      safe('groupEnd', () => {
        if (state.groupDepth > 0) state.groupDepth--
      })
    },
    clear: (): void => {},
    profile: (): void => {},
    profileEnd: (): void => {},
    timeStamp: (): void => {}
  }
  return { console: consoleObj as unknown as Console, state }
}

const NATIVE_CONSOLE: Record<string, unknown> = require('console')

/**
 * Per-runtime facade for `require('console')` / `require('node:console')`.
 * Top-level methods route through the owning extension console while the
 * native `Console` class stays untouched.
 */
export function getConsoleFacade(runtime: ExtensionRuntime): Record<string, unknown> {
  let facade = (runtime as any).consoleFacade
  if (!facade) {
    facade = Object.assign({}, NATIVE_CONSOLE)
    for (let method of CONSOLE_METHODS) {
      let fn = (runtime.console as any)[method]
      if (typeof fn === 'function') facade[method] = fn
    }
    Object.defineProperty(runtime, 'consoleFacade', {
      value: facade,
      enumerable: false,
      configurable: true,
      writable: true
    })
  }
  return facade
}

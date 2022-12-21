'use strict'
import { fs, inspect, path, promisify } from '../util/node'
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export enum LogLevel {
  Trace,
  Debug,
  Info,
  Warning,
  Error,
  Off
}

const yellowOpen = '\x1B[33m'
const yellowClose = '\x1B[39m'

export const DEFAULT_LOG_LEVEL: LogLevel = LogLevel.Info

export const toTwoDigits = (v: number) => v < 10 ? `0${v}` : v.toString()
export const toThreeDigits = (v: number) => v < 10 ? `00${v}` : v < 100 ? `0${v}` : v.toString()

export interface ILogger {
  readonly category: string
  getLevel(): LogLevel
  log(...args: any[]): void
  trace(...args: any[]): void
  debug(...args: any[]): void
  info(...args: any[]): void
  warn(...args: any[]): void
  error(...args: any[]): void
  fatal(...args: any[]): void
  mark(...args: any[]): void
  /**
   * An operation to flush the contents. Can be synchronous.
   */
  flush(): Promise<void>
}

export function textToLogLevel(level: string): LogLevel {
  let str = level.toLowerCase()
  switch (str) {
    case 'trace':
      return LogLevel.Trace
    case 'debug':
      return LogLevel.Debug
    case 'info':
      return LogLevel.Info
    case 'error':
      return LogLevel.Error
    case 'warn':
    case 'warning':
      return LogLevel.Warning
    case 'off':
      return LogLevel.Off
    default:
      return LogLevel.Info
  }
}

export function format(args: any, depth = 2, color = false, hidden = false): string {
  let result = ''

  for (let i = 0; i < args.length; i++) {
    let a = args[i]

    if (typeof a === 'object') {
      try {
        a = inspect(a, hidden, depth, color)
      } catch (e) {}
    }
    if (color && (typeof a === 'boolean' || typeof a === 'number')) {
      a = `${yellowOpen}${a}${yellowClose}`
    }
    result += (i > 0 ? ' ' : '') + a
  }

  return result
}

abstract class AbstractLogger {
  protected level: LogLevel = DEFAULT_LOG_LEVEL

  public setLevel(level: LogLevel): void {
    if (this.level !== level) {
      this.level = level
    }
  }

  public getLevel(): LogLevel {
    return this.level
  }
}

export interface LoggerConfiguration {
  userFormatters: boolean
  color: boolean
  depth: number // 2
  showHidden: boolean
}

export class FileLogger extends AbstractLogger {

  private promise: Promise<void>
  private backupIndex = 1
  private config: LoggerConfiguration
  private useConsole = false
  private loggers: Map<string, ILogger> = new Map()

  constructor(
    private readonly fsPath: string,
    level: LogLevel,
    config: Partial<LoggerConfiguration>
  ) {
    super()
    this.config = Object.assign({
      userFormatters: true,
      color: false,
      depth: 2,
      showHidden: false
    }, config)
    this.setLevel(level)
    this.promise = this.initialize()
  }

  public switchConsole(): void {
    this.useConsole = !this.useConsole
  }

  private format(args: any[]): string {
    let { color, showHidden, depth } = this.config
    return format(args, depth, color, showHidden)
  }

  public createLogger(scope: string): ILogger {
    let logger = this.loggers.has(scope) ? this.loggers.get(scope) : {
      category: scope,
      mark: () => {
        // not used
      },
      getLevel: () => {
        return this.getLevel()
      },
      trace: (...args: any[]) => {
        if (this.level <= LogLevel.Trace) {
          this._log(LogLevel.Trace, scope, args, this.getCurrentTimestamp())
        }
      },
      debug: (...args: any[]) => {
        if (this.level <= LogLevel.Debug) {
          this._log(LogLevel.Debug, scope, args, this.getCurrentTimestamp())
        }
      },
      log: (...args: any[]) => {
        if (this.level <= LogLevel.Info) {
          this._log(LogLevel.Info, scope, args, this.getCurrentTimestamp())
        }
      },
      info: (...args: any[]) => {
        if (this.level <= LogLevel.Info) {
          this._log(LogLevel.Info, scope, args, this.getCurrentTimestamp())
        }
      },
      warn: (...args: any[]) => {
        if (this.level <= LogLevel.Warning) {
          this._log(LogLevel.Warning, scope, args, this.getCurrentTimestamp())
        }
      },
      error: (...args: any[]) => {
        if (this.level <= LogLevel.Error) {
          this._log(LogLevel.Error, scope, args, this.getCurrentTimestamp())
        }
      },
      fatal: (...args: any[]) => {
        if (this.level <= LogLevel.Error) {
          this._log(LogLevel.Error, scope, args, this.getCurrentTimestamp())
        }
      },
      /**
       * An operation to flush the contents. Can be synchronous.
       */
      flush: () => {
        return this.promise
      }
    }
    this.loggers.set(scope, logger)
    return logger
  }

  private async initialize(): Promise<void> {
    return Promise.resolve()
  }

  public shouldBackup(size: number): boolean {
    return size > MAX_FILE_SIZE
  }

  private _log(level: LogLevel, scope: string, args: any[], time: string): void {
    if (this.useConsole) {
      let method = level === LogLevel.Error ? 'error' : 'log'
      console[method](`${stringifyLogLevel(level)} [${scope}]`, format(args, null, true))
    } else {
      let message = this.format(args)
      this.promise = this.promise.then(() => {
        let fn = async () => {
          let text: string
          if (this.config.userFormatters !== false) {
            let parts = [time, stringifyLogLevel(level), `(pid:${process.pid})`, `[${scope}]`]
            text = `${parts.join(' ')} - ${message}\n`
          } else {
            text = message
          }
          await promisify(fs.appendFile)(this.fsPath, text, { encoding: 'utf8', flag: 'a+' })
          let stat = await promisify(fs.stat)(this.fsPath)
          if (this.shouldBackup(stat.size)) {
            let newFile = this.getBackupResource()
            await promisify(fs.rename)(this.fsPath, newFile)
          }
        }
        return fn()
      }).catch(err => {
        !global.REVISION && console.error(err)
      })
    }
  }

  private getCurrentTimestamp(): string {
    const currentTime = new Date()
    return `${currentTime.getFullYear()}-${toTwoDigits(currentTime.getMonth() + 1)}-${toTwoDigits(currentTime.getDate())}T${getTimestamp(currentTime)}`
  }

  private getBackupResource(): string {
    this.backupIndex = this.backupIndex > 5 ? 1 : this.backupIndex
    return path.join(path.dirname(this.fsPath), `${path.basename(this.fsPath)}_${this.backupIndex++}`)
  }
}

export function stringifyLogLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.Debug: return 'DEBUG'
    case LogLevel.Error: return 'ERROR'
    case LogLevel.Info: return 'INFO'
    case LogLevel.Trace: return 'TRACE'
    case LogLevel.Warning: return 'WARN'
  }
  return ''
}

export function getTimestamp(date: Date): string {
  return `${toTwoDigits(date.getHours())}:${toTwoDigits(date.getMinutes())}:${toTwoDigits(date.getSeconds())}.${toThreeDigits(date.getMilliseconds())}`
}

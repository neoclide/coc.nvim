'use strict'
import { Emitter, Event } from 'vscode-languageserver-protocol'
import style from 'ansi-styles'
import { inspect, promisify } from 'util'
import fs from 'fs'
import path from 'path'
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export enum LogLevel {
  Trace,
  Debug,
  Info,
  Warning,
  Error,
  Off
}

export const DEFAULT_LOG_LEVEL: LogLevel = LogLevel.Info

export const toTwoDigits = (v: number) => v < 10 ? `0${v}` : v.toString()
export const toThreeDigits = (v: number) => v < 10 ? `00${v}` : v < 100 ? `0${v}` : v.toString()

export interface ILogger {
  readonly category: string
  readonly level: string
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
      a = `${style.yellow.open}${a}${style.yellow.close}`
    }
    result += (i > 0 ? ' ' : '') + a
  }

  return result
}

abstract class AbstractLogger {

  private level: LogLevel = DEFAULT_LOG_LEVEL
  private readonly _onDidChangeLogLevel: Emitter<LogLevel> = new Emitter<LogLevel>()
  public readonly onDidChangeLogLevel: Event<LogLevel> = this._onDidChangeLogLevel.event

  public setLevel(level: LogLevel): void {
    if (this.level !== level) {
      this.level = level
      this._onDidChangeLogLevel.fire(this.level)
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

  public createLogger(scope: string): ILogger {
    const fmt = (args: any): string => {
      return format(args, this.config.depth, this.config.color, this.config.showHidden)
    }
    let logger = this.loggers.has(scope) ? this.loggers.get(scope) : {
      category: scope,
      level: this.stringifyLogLevel(this.getLevel()),
      mark: () => {
        // not used
      },
      getLevel: () => {
        return this.getLevel()
      },
      trace: (...args: any[]) => {
        if (this.getLevel() <= LogLevel.Trace) {
          this._log(LogLevel.Trace, scope, fmt(args), this.getCurrentTimestamp())
        }
      },
      debug: (...args: any[]) => {
        if (this.getLevel() <= LogLevel.Debug) {
          this._log(LogLevel.Debug, scope, fmt(args), this.getCurrentTimestamp())
        }
      },
      log: (...args: any[]) => {
        if (this.getLevel() <= LogLevel.Info) {
          this._log(LogLevel.Info, scope, fmt(args), this.getCurrentTimestamp())
        }
      },
      info: (...args: any[]) => {
        if (this.getLevel() <= LogLevel.Info) {
          this._log(LogLevel.Info, scope, fmt(args), this.getCurrentTimestamp())
        }
      },
      warn: (...args: any[]) => {
        if (this.getLevel() <= LogLevel.Warning) {
          this._log(LogLevel.Warning, scope, fmt(args), this.getCurrentTimestamp())
        }
      },
      error: (...args: any[]) => {
        if (this.getLevel() <= LogLevel.Error) {
          this._log(LogLevel.Error, scope, fmt(args), this.getCurrentTimestamp())
        }
      },
      fatal: (...args: any[]) => {
        if (this.getLevel() <= LogLevel.Error) {
          this._log(LogLevel.Error, scope, fmt(args), this.getCurrentTimestamp())
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

  private _log(level: LogLevel, scope: string, message: string, time: string): void {
    this.promise = this.promise.then(() => {
      let fn = async () => {
        let text: string
        if (this.config.userFormatters !== false) {
          let parts = [time, this.stringifyLogLevel(level), `(pid:${process.pid})`, `[${scope}]`]
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

  private getCurrentTimestamp(): string {
    const currentTime = new Date()
    return `${currentTime.getFullYear()}-${toTwoDigits(currentTime.getMonth() + 1)}-${toTwoDigits(currentTime.getDate())}T${toTwoDigits(currentTime.getHours())}:${toTwoDigits(currentTime.getMinutes())}:${toTwoDigits(currentTime.getSeconds())}.${toThreeDigits(currentTime.getMilliseconds())}`
  }

  private getBackupResource(): string {
    this.backupIndex = this.backupIndex > 5 ? 1 : this.backupIndex
    return path.join(path.dirname(this.fsPath), `${path.basename(this.fsPath)}_${this.backupIndex++}`)
  }

  private stringifyLogLevel(level: LogLevel): string {
    switch (level) {
      case LogLevel.Debug: return 'DEBUG'
      case LogLevel.Error: return 'ERROR'
      case LogLevel.Info: return 'INFO'
      case LogLevel.Trace: return 'TRACE'
      case LogLevel.Warning: return 'WARN'
    }
    return ''
  }
}

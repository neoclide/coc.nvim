import fs from 'fs'
import os from 'os'
import path from 'path'
import { inspect } from 'util'
import { Writable } from 'stream'

const debugging = process.env.COC_NODE_CLIENT_DEBUG == '1' && process.env.COC_TESTER == '1'

export interface ILogger {
  debug: (data: string, ...meta: any[]) => void
  info: (data: string, ...meta: any[]) => void
  error: (data: string, ...meta: any[]) => void
  warn: (data: string, ...meta: any[]) => void
  trace: (data: string, ...meta: any[]) => void
}

export const nullLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
}

function getLogFile(): string {
  let file = process.env.NODE_CLIENT_LOG_FILE
  if (file) return file
  let dir = process.env.XDG_RUNTIME_DIR
  if (dir) return path.join(dir, 'node-client.log')
  return path.join(os.tmpdir(), `node-client-${process.pid}.log`)
}

const LOG_FILE_PATH = getLogFile()
export const level = debugging ? 'debug' : process.env.NODE_CLIENT_LOG_LEVEL || 'info'

let invalid = !debugging && process.getuid && process.getuid() == 0
if (!invalid && !debugging) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE_PATH), { recursive: true })
    fs.writeFileSync(LOG_FILE_PATH, '', { encoding: 'utf8', mode: 0o666 })
  } catch (_e) {
    invalid = true
  }
}

function toObject(arg: any): any {
  if (arg == null) {
    return arg
  }
  if (Array.isArray(arg)) {
    return arg.map(o => toObject(o))
  }
  if (typeof arg == 'object' && typeof arg.prefix == 'string' && typeof arg.data == 'number') {
    return '[' + arg.prefix + arg.data + ']'
  }
  return arg
}

function toString(arg: any): string {
  if (debugging) return inspect(arg, { depth: null, colors: true, compact: false })
  if (arg == null) return String(arg)
  if (typeof arg == 'object') return JSON.stringify(arg, null, 2)
  return String(arg)
}

const toTwoDigits = (v: number) => v < 10 ? `0${v}` : v.toString()
const toThreeDigits = (v: number) => v < 10 ? `00${v}` : v < 100 ? `0${v}` : v.toString()

function toTimeString(currentTime: Date): string {
  return `${toTwoDigits(currentTime.getHours())}:${toTwoDigits(currentTime.getMinutes())}:${toTwoDigits(currentTime.getSeconds())}.${toThreeDigits(currentTime.getMilliseconds())}`
}

class Logger implements ILogger {
  private _stream: Writable
  constructor(private name: string) {
  }

  private get stream(): Writable {
    if (this._stream) return this._stream
    if (debugging) {
      this._stream = process.stdout
    } else {
      this._stream = fs.createWriteStream(LOG_FILE_PATH, { encoding: 'utf8' })
    }
    return this._stream
  }

  private getText(level: string, data: string, meta: any[]): string {
    let more = ''
    if (meta.length) {
      let arr = toObject(meta)
      more = ' ' + arr.map(o => toString(o)).join(', ')
    }
    return `${toTimeString(new Date())} ${level.toUpperCase()} [${this.name}] - ${data}${more}\n`
  }

  public debug(data: string, ...meta: any[]): void {
    if (level != 'debug' || invalid) return
    this.stream.write(this.getText('debug', data, meta))
  }

  public info(data: string, ...meta: any[]): void {
    if (invalid) return
    this.stream.write(this.getText('info', data, meta))
  }

  public warn(data: string, ...meta: any[]): void {
    if (invalid) return
    this.stream.write(this.getText('warn', data, meta))
  }

  public error(data: string, ...meta: any[]): void {
    if (invalid) return
    let stream = debugging ? process.stderr : this.stream
    stream.write(this.getText('error', data, meta))
  }

  public trace(data: string, ...meta: any[]): void {
    if (level != 'trace' || invalid) return
    this.stream.write(this.getText('trace', data, meta))
  }
}

export function createLogger(name: string): ILogger {
  return new Logger(name)
}

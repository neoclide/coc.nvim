let _isWindows = false
let _isMacintosh = false
let _isLinux = false
let _isNative = false
let _isWeb = false

export interface IProcessEnvironment {
  [key: string]: string
}

interface INodeProcess {
  nextTick: Function
  platform: string
  env: IProcessEnvironment
  getuid(): number
}

declare let process: INodeProcess
declare let global: any

interface INavigator {
  userAgent: string
  language: string
}
declare let self: any

export const language = 'en'

// OS detection
if (
  typeof process === 'object' &&
  typeof process.nextTick === 'function' &&
  typeof process.platform === 'string'
) {
  _isWindows = process.platform === 'win32'
  _isMacintosh = process.platform === 'darwin'
  _isLinux = process.platform === 'linux'
  _isNative = true
}

export enum Platform {
  Web,
  Mac,
  Linux,
  Windows
}

let _platform: Platform = Platform.Web
if (_isNative) {
  if (_isMacintosh) {
    _platform = Platform.Mac
  } else if (_isWindows) {
    _platform = Platform.Windows
  } else if (_isLinux) {
    _platform = Platform.Linux
  }
}

export const isWindows = _isWindows
export const isMacintosh = _isMacintosh
export const isLinux = _isLinux
export const isNative = _isNative
export const isWeb = _isWeb
export const platform = _platform

export function isRootUser(): boolean {
  return _isNative && !_isWindows && process.getuid() === 0
}

const _globals =
  typeof self === 'object'
    ? self
    : typeof global === 'object'
      ? global
      : ({} as any)
export const globals: any = _globals

let _setImmediate: (callback: (...args: any[]) => void) => number = null
export function setImmediate(callback: (...args: any[]) => void): number {
  if (_setImmediate === null) {
    if (globals.setImmediate) {
      _setImmediate = globals.setImmediate.bind(globals)
    } else if (
      typeof process !== 'undefined' &&
      typeof process.nextTick === 'function'
    ) {
      _setImmediate = process.nextTick.bind(process)
    } else {
      _setImmediate = globals.setTimeout.bind(globals)
    }
  }
  return _setImmediate(callback)
}

export const enum OperatingSystem {
  Windows = 1,
  Macintosh = 2,
  Linux = 3
}
export const OS = _isMacintosh
  ? OperatingSystem.Macintosh
  : _isWindows
    ? OperatingSystem.Windows
    : OperatingSystem.Linux

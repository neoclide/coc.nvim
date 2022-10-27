'use strict'

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

export enum Platform {
  Web,
  Mac,
  Linux,
  Windows,
  Unknown
}

export function getPlatform(process: INodeProcess): Platform {
  let { platform } = process
  if (platform === 'win32') return Platform.Windows
  if (platform === 'darwin') return Platform.Mac
  if (platform === 'linux') return Platform.Linux
  return Platform.Unknown
}

let _platform: Platform = getPlatform(process)

export const platform = _platform
export const isWindows = _platform === Platform.Windows
export const isMacintosh = _platform === Platform.Mac
export const isLinux = _platform === Platform.Linux
export const isNative = true
export const isWeb = false

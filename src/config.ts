import {Config, SourceConfig} from './types'
const logger = require('./util/logger')('config')

let config: Config = {
  fuzzyMatch: true,
  checkGit: false,
  timeout: 300,
  completeOpt: 'menu,preview',
  disabled: [],
  disabledServices: [],
  sources: {},
  hasUserData: false,
  incrementHightlight: false,
  noSelect: false,
  signatureEvents: ['CursorHold'],
}

export function setConfig(opts: {[index: string]: any}):void {
  for (let key of Object.keys(opts)) {
    let val = opts[key]
    if (['fuzzyMatch',
      'noSelect',
      'checkGit',
      'hasUserData',
      'incrementHightlight'].indexOf(key) !== -1) {
      if (val != null) {
        config[key] = !!val
      }
    }
    if (key === 'disabledServices' && Array.isArray(val)) {
      config.disabledServices = val
    }
    if (key === 'timeout') {
      config.timeout = Number(opts.timeout)
      if (isNaN(config.timeout)) config.timeout = 300
    }
    if (key === 'completeOpt') {
      config.completeOpt = opts.completeOpt
    }
    if (key === 'sourceConfig' && !!val) {
      for (let name of Object.keys(val)) {
        configSource(name, val[name])
      }
    }
    if (key === 'signatureEvents' && Array.isArray(key)) {
      config.signatureEvents = opts[key]
    }
  }
  logger.debug(`config:${JSON.stringify(config)}`)
}

export function getConfig(name: string):any {
  return config[name]
}

export function configSource(name: string, opt: any):void {
  let {disabled} = opt
  let {sources} = config
  sources[name] = sources[name] || {}
  if (disabled === 1) {
    if (config.disabled.indexOf(name) == -1) {
      config.disabled.push(name)
    }
  }
  if (disabled === 0) {
    let idx = config.disabled.findIndex(s => s == name)
    config.disabled.splice(idx, 1)
  }
  for (let key of Object.keys(opt)) {
    if (key === 'disabled') continue
    sources[name][key] = opt[key]
  }
}

export function getSourceConfig(name: string):Partial<SourceConfig> {
  let {sources} = config
  let obj = sources[name]
  if (!obj || Object.keys(obj).length === 0) return {}
  return obj
}

export function toggleSource(name: string):string {
  let {disabled} = config
  if (disabled.indexOf(name) == -1) {
    disabled.push(name)
    return 'disabled'
  }
  let idx = disabled.findIndex(s => s === name)
  disabled.splice(idx, 1)
  return 'enabled'
}

export function shouldAutoComplete():boolean {
  let opt = config.completeOpt
  let parts = opt.split(',')
  return parts.indexOf('menu') !== -1 && parts.indexOf('noinsert') === -1
}

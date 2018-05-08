import {Config} from './types'
import {logger} from './util/logger'

let config: Config = {
  fuzzyMatch: true,
  noTrace: false,
  timeout: 300,
  completeOpt: 'menu,preview',
  sources: ['around', 'buffer', 'dictionary', 'path'],
  disabled: [],
}

export function setConfig(opts: {[index: string]: any}):void {
  for (let key of Object.keys(opts)) {
    let val = opts[key]
    if (['fuzzyMatch', 'noTrace'].indexOf(key) !== -1) {
      if (val != null) {
        config[key] = !!val
      }
    }
    if (key === 'timeout') {
      config.timeout = Number(opts.timeout)
      if (isNaN(config.timeout)) config.timeout = 300
    }
    if (key === 'sources' && Array.isArray(opts.sources)) {
      config.sources = config.sources.concat(opts.sources)
    }
    if (key === 'completeOpt') {
      config.completeOpt = opts.completeOpt
    }
  }
  logger.debug(`config:${JSON.stringify(config)}`)
}

export function getConfig(name: string):any {
  return config[name]
}

export function toggleSource(name: string):void {
  let {disabled} = config
  if (disabled.indexOf(name) !== -1) {
    disabled.push(name)
  } else {
    let idx = disabled.findIndex(s => s === name)
    disabled.splice(idx, 1)
  }
}

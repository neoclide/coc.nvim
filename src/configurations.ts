import { Configuration, ConfigurationModel } from './model/configuration'
import { ConfigurationInspect, IConfigurationData, IConfigurationModel, WorkspaceConfiguration, ConfigurationShape, ConfigurationTarget } from './types'
import { mixin } from './util/object'
import { isEmptyObject, isObject } from './util/types'
import { parse } from 'jsonc-parser'
import fs from 'fs'
const logger = require('./util/logger')('configurations')

function lookUp(tree: any, key: string): any {
  if (key) {
    const parts = key.split('.')
    let node = tree
    for (let i = 0; node && i < parts.length; i++) {
      node = node[parts[i]]
    }
    return node
  }
  return tree
}

export default class Configurations {
  private _configuration: Configuration

  constructor(
    data: IConfigurationData,
    private readonly _proxy: ConfigurationShape
  ) {
    this._configuration = Configurations.parse(data)
  }

  /**
   * getConfiguration
   *
   * @public
   * @param {string} section
   * @returns {WorkspaceConfiguration}
   */
  public getConfiguration(section?: string): WorkspaceConfiguration {

    const config = Object.freeze(lookUp(this._configuration.getValue(null), section))

    const result: WorkspaceConfiguration = {
      has(key: string): boolean {
        return typeof lookUp(config, key) !== 'undefined'
      },
      get: <T>(key: string, defaultValue?: T) => {
        let result = lookUp(config, key)
        if (typeof result === 'undefined') {
          result = defaultValue
        }
        if (result == null || (typeof result == 'string' && result.length == 0)) return undefined
        return result
      },
      update: (key: string, value: any, isGlobal = true) => {
        let s = section ? `${section}.${key}` : key
        this._configuration.updateValue(s, value)
        if (global.hasOwnProperty('__TEST__')) {
          return
        }
        let target = isGlobal ? ConfigurationTarget.User : ConfigurationTarget.Workspace
        if (value === undefined) {
          this._proxy.$removeConfigurationOption(target, s)
        } else {
          this._proxy.$updateConfigurationOption(target, s, value)
        }
      },
      inspect: <T>(key: string): ConfigurationInspect<T> => {
        key = section ? `${section}.${key}` : key
        const config = this._configuration.inspect<T>(key)
        if (config) {
          return {
            key,
            defaultValue: config.default,
            globalValue: config.user,
            workspaceValue: config.workspace,
          }
        }
        return undefined
      }
    }

    if (typeof config === 'object') {
      mixin(result, config, false)
    }
    return Object.freeze(result) as WorkspaceConfiguration
  }

  private static parseConfigurationModel(model: IConfigurationModel): ConfigurationModel {
    return new ConfigurationModel(model.contents).freeze()
  }

  private static parse(data: IConfigurationData): Configuration {
    const defaultConfiguration = Configurations.parseConfigurationModel(data.defaults)
    const userConfiguration = Configurations.parseConfigurationModel(data.user)
    const workspaceConfiguration = Configurations.parseConfigurationModel(data.workspace)
    return new Configuration(defaultConfiguration, userConfiguration, workspaceConfiguration, new ConfigurationModel())
  }
}

export function parseContentFromFile(filepath: string): IConfigurationModel {
  if (!fs.existsSync(filepath)) return { contents: {} }
  let content: string
  try {
    content = fs.readFileSync(filepath, 'utf8')
  } catch (_e) {
    content = ''
  }
  let res: any
  try {
    res = { contents: parseContent(content) }
  } catch (e) {
    res = { contents: {} }
  }
  return res
}

export function parseContent(content: string): any {
  if (content.length == 0) return {}
  let data = parse(content)
  function addProperty(current: object, key: string, remains: string[], value: any): void {
    if (remains.length == 0) {
      current[key] = convert(value)
    } else {
      if (!current[key]) current[key] = {}
      let o = current[key]
      let first = remains.shift()
      addProperty(o, first, remains, value)
    }
  }

  function convert(obj: any): any {
    if (!isObject(obj)) return obj
    if (isEmptyObject(obj)) return {}
    let dest = {}
    for (let key of Object.keys(obj)) {
      if (key.indexOf('.') !== -1) {
        let parts = key.split('.')
        let first = parts.shift()
        addProperty(dest, first, parts, obj[key])
      } else {
        dest[key] = convert(obj[key])
      }
    }
    return dest
  }
  return convert(data)
}

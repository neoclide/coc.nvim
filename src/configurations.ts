import { mixin, deepClone } from './util/object'
import {
  isObject,
  isEmptyObject
} from './util/types'
import {
  WorkspaceConfiguration,
  ConfigurationInspect,
  MainThreadConfigurationShape,
  IConfigurationModel,
  IConfigurationData,
} from './types'
import {
  ConfigurationModel,
  Configuration,
} from './model/configuration'
import {
  readFile,
  statAsync,
} from './util/fs'
import JSON5 = require('json5')
const logger = require('./util/logger')('configurations')

function lookUp(tree: any, key: string):any {
  if (key) {
    const parts = key.split('.')
    let node = tree
    for (let i = 0; node && i < parts.length; i++) {
      node = node[parts[i]]
    }
    return node
  }
}

export default class Configurations {
  private readonly _proxy: MainThreadConfigurationShape
  private _configuration: Configuration

  constructor(data: IConfigurationData) {
    this._configuration = Configurations.parse(data)
  }

  /**
   * getConfiguration
   *
   * @public
   * @param {string} section
   * @returns {WorkspaceConfiguration}
   */
  public getConfiguration(section: string): WorkspaceConfiguration {

    const config = Object.freeze(lookUp(this._configuration.getValue(null), section))

    const result: WorkspaceConfiguration = {
      has(key: string): boolean {
        return typeof lookUp(config, key) !== 'undefined'
      },
      get: <T>(key: string, defaultValue?: T) => {
        let result = lookUp(config, key)
        if (typeof result === 'undefined') {
          result = defaultValue
        } else {
          let clonedConfig = void 0
          const cloneOnWriteProxy = (target: any, accessor: string): any => {
            let clonedTarget = void 0
            const cloneTarget = () => {
              clonedConfig = clonedConfig ? clonedConfig : deepClone(config)
              clonedTarget = clonedTarget ? clonedTarget : lookUp(clonedConfig, accessor)
            }
            return isObject(target) ?
              new Proxy(target, {
                get: (target: any, property: string) => {
                  if (typeof property === 'string' && property.toLowerCase() === 'tojson') {
                    cloneTarget()
                    return () => clonedTarget
                  }
                  if (clonedConfig) {
                    clonedTarget = clonedTarget ? clonedTarget : lookUp(clonedConfig, accessor)
                    return clonedTarget[property]
                  }
                  const result = target[property]
                  if (typeof property === 'string') {
                    return cloneOnWriteProxy(result, `${accessor}.${property}`)
                  }
                  return result
                },
                set: (target: any, property: string, value: any) => {
                  cloneTarget()
                  clonedTarget[property] = value
                  return true
                },
                deleteProperty: (target: any, property: string) => {
                  cloneTarget()
                  delete clonedTarget[property]
                  return true
                },
                defineProperty: (target: any, property: string, descriptor: any) => {
                  cloneTarget()
                  Object.defineProperty(clonedTarget, property, descriptor)
                  return true
                }
              }) : target
          }
          result = cloneOnWriteProxy(result, key)
        }
        if (result == null || (typeof result == 'string' && result.length == 0)) return null
        return result
      },
      update: (key: string, value: any, _isGlobal?: boolean) => {
        this._configuration.updateValue(key, value)
        // TODO change configuration file
      },
      inspect: <T>(key: string): ConfigurationInspect<T> => {
        key = `${section}.${key}`
        const config = this._configuration.inspect<T>(key)
        if (config) {
          return {
            key,
            defaultValue: config.default,
            globalValue: config.user,
            folderValue: config.folder,
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
    const folderConfiguration = Configurations.parseConfigurationModel(data.folder)
    return new Configuration(defaultConfiguration, userConfiguration, folderConfiguration, new ConfigurationModel())
	}
}

export async function parseContentFromFile(filepath:string):Promise<IConfigurationModel> {
  let stat = await statAsync(filepath)
  if (!stat || !stat.isFile()) return {contents: {}}
  let content = await readFile(filepath, 'utf8')
  return {
    contents: parseContent(content)
  }
}

export function parseContent(content:string):any {
  let data = JSON5.parse(content)
  function addProperty(current:object, key:string, remains:string[], value:any):void {
    if (remains.length == 0) {
      current[key] = convert(value)
    } else {
      if (!current[key]) current[key] = {}
      let o = current[key]
      let first = remains.shift()
      addProperty(o, first, remains, value)
    }
  }

  function convert(obj:any):any {
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

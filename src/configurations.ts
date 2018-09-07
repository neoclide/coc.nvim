import { Configuration, ConfigurationModel } from './model/configuration'
import { ConfigurationInspect, ConfigurationShape, ConfigurationTarget, IConfigurationData, IConfigurationModel, WorkspaceConfiguration } from './types'
import { mixin } from './util/object'
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

  public updateDefaults(key: string, value: any):void {
    this._configuration.updateValue(key, value, true)
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
      update: (key: string, value: any, isUser = true) => {
        let s = section ? `${section}.${key}` : key
        this._configuration.updateValue(s, value)
        let target = isUser ? ConfigurationTarget.User : ConfigurationTarget.Workspace
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
    Object.defineProperty(result, 'has', {
      enumerable: false
    })
    Object.defineProperty(result, 'get', {
      enumerable: false
    })
    Object.defineProperty(result, 'update', {
      enumerable: false
    })
    Object.defineProperty(result, 'inspect', {
      enumerable: false
    })

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

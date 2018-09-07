import { IConfigurationData, IConfigurationModel } from '../types'
import { objectLiteral } from '../util/is'
import { deepClone } from '../util/object'
const logger = require('../util/logger')('model-configuration')

export class ConfigurationModel implements IConfigurationModel {

  constructor(
    private _contents: any = {},
  ) { }

  public get contents(): any {
    return this._contents
  }

  public getValue<V>(section: string): V {
    return section
      ? getConfigurationValue<any>(this.contents, section)
      : this.contents
  }

  public merge(...others: ConfigurationModel[]): ConfigurationModel {
    const contents = deepClone(this.contents)

    for (const other of others) {
      this.mergeContents(contents, other.contents)
    }
    return new ConfigurationModel(contents)
  }

  public freeze(): ConfigurationModel {
    return this
  }

  private mergeContents(source: any, target: any): void {
    for (const key of Object.keys(target)) {
      if (key in source) {
        if (objectLiteral(source[key]) && objectLiteral(target[key])) {
          this.mergeContents(source[key], target[key])
          continue
        }
      }
      source[key] = deepClone(target[key])
    }
  }

  public toJSON(): IConfigurationModel {
    return {
      contents: this.contents
    }
  }

  // Update methods

  public setValue(key: string, value: any): void {
    addToValueTree(this.contents, key, value, message => {
      logger.error(message)
    })
  }

  public removeValue(key: string): void {
    removeFromValueTree(this.contents, key)
  }
}
export function addToValueTree(
  settingsTreeRoot: any,
  key: string,
  value: any,
  conflictReporter: (message: string) => void
): void {
  const segments = key.split('.')
  const last = segments.pop()

  let curr = settingsTreeRoot
  for (let i = 0; i < segments.length; i++) {
    let s = segments[i]
    let obj = curr[s]
    switch (typeof obj) {
      case 'undefined': {
        obj = curr[s] = {}
        break
      }
      case 'object':
        break
      default:
        conflictReporter(
          `Ignoring ${key} as ${segments
            .slice(0, i + 1)
            .join('.')} is ${JSON.stringify(obj)}`
        )
        return
    }
    curr = obj
  }

  if (typeof curr === 'object') {
    curr[last] = value // workaround https://github.com/Microsoft/vscode/issues/13606
  } else {
    conflictReporter(
      `Ignoring ${key} as ${segments.join('.')} is ${JSON.stringify(curr)}`
    )
  }
}

export function removeFromValueTree(valueTree: any, key: string): void {
  const segments = key.split('.')
  doRemoveFromValueTree(valueTree, segments)
}

function doRemoveFromValueTree(valueTree: any, segments: string[]): void {
  const first = segments.shift()
  if (segments.length === 0) {
    // Reached last segment
    delete valueTree[first]
    return
  }

  if (Object.keys(valueTree).indexOf(first) !== -1) {
    const value = valueTree[first]
    if (typeof value === 'object' && !Array.isArray(value)) {
      doRemoveFromValueTree(value, segments)
      if (Object.keys(value).length === 0) {
        delete valueTree[first]
      }
    }
  }
}

export function getConfigurationValue<T>(
  config: any,
  settingPath: string,
  defaultValue?: T
): T {
  function accessSetting(config: any, path: string[]): any {
    let current = config
    for (let i = 0; i < path.length; i++) { // tslint:disable-line
      if (typeof current !== 'object' || current === null) {
        return undefined
      }
      current = current[path[i]]
    }
    return current as T
  }

  const path = settingPath.split('.')
  const result = accessSetting(config, path)

  return typeof result === 'undefined' ? defaultValue : result
}

export class Configuration {
  private _consolidateConfiguration: ConfigurationModel

  constructor(
    private _defaultConfiguration: ConfigurationModel,
    private _userConfiguration: ConfigurationModel,
    private _workspaceConfiguration: ConfigurationModel,
    private _memoryConfiguration: ConfigurationModel = new ConfigurationModel(),
  ) {
  }

  private getConsolidateConfiguration(): ConfigurationModel {
    if (!this._consolidateConfiguration) {
      this._consolidateConfiguration = this._defaultConfiguration.merge(this._userConfiguration, this._workspaceConfiguration, this._memoryConfiguration)
      this._consolidateConfiguration = this._consolidateConfiguration.freeze()
    }
    return this._consolidateConfiguration
  }

  public getValue(section?: string): any {
    let configuration = this.getConsolidateConfiguration()
    return configuration.getValue(section)
  }

  public updateValue(key: string, value: any, updateDefaults = false): void {
    let configuration = updateDefaults ? this._defaultConfiguration : this._memoryConfiguration
    if (value === void 0) {
      configuration.removeValue(key)
    } else {
      configuration.setValue(key, value)
    }
    this._consolidateConfiguration = null
  }

  public inspect<C>(key: string): {
    default: C
    user: C
    workspace: C
    memory?: C
    value: C
  } {
    const consolidateConfigurationModel = this.getConsolidateConfiguration()
    const { _workspaceConfiguration, _memoryConfiguration } = this
    return {
      default: this._defaultConfiguration.freeze().getValue(key),
      user: this._userConfiguration.freeze().getValue(key),
      workspace: _workspaceConfiguration.freeze().getValue(key),
      memory: _memoryConfiguration.freeze().getValue(key),
      value: consolidateConfigurationModel.getValue(key)
    }
  }

  public get defaults(): ConfigurationModel {
    return this._defaultConfiguration
  }

  public get user(): ConfigurationModel {
    return this._userConfiguration
  }

  public get workspace(): ConfigurationModel {
    return this._workspaceConfiguration
  }

  public toData(): IConfigurationData {
    return {
      defaults: {
        contents: this._defaultConfiguration.contents
      },
      user: {
        contents: this._userConfiguration.contents
      },
      workspace: {
        contents: this._workspaceConfiguration.contents
      }
    }
  }
}

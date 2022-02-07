import fs from 'fs'
import os from 'os'
import path from 'path'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { ConfigurationChangeEvent, ConfigurationInspect, ConfigurationShape, ConfigurationTarget, ErrorItem, IConfigurationData, IConfigurationModel, WorkspaceConfiguration } from '../types'
import { CONFIG_FILE_NAME, disposeAll, watchFile } from '../util'
import { findUp, isParentFolder, sameFile } from '../util/fs'
import { objectLiteral } from '../util/is'
import { deepClone, deepFreeze, mixin } from '../util/object'
import { Configuration } from './configuration'
import { ConfigurationModel } from './model'
import { addToValueTree, getChangedKeys, loadDefaultConfigurations, parseContentFromFile } from './util'
const logger = require('../util/logger')('configurations')

function lookUp(tree: any, key: string): any {
  if (key) {
    if (tree && tree.hasOwnProperty(key)) return tree[key]
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
  private _errorItems: ErrorItem[] = []
  private _folderConfigurations: Map<string, ConfigurationModel> = new Map()
  private _onError = new Emitter<ErrorItem[]>()
  private _onChange = new Emitter<ConfigurationChangeEvent>()
  private disposables: Disposable[] = []
  private workspaceConfigFile: string | undefined

  public readonly onError: Event<ErrorItem[]> = this._onError.event
  public readonly onDidChange: Event<ConfigurationChangeEvent> = this._onChange.event

  constructor(
    private userConfigFile?: string | null,
    private readonly _proxy?: ConfigurationShape
  ) {
    let user = this.parseContentFromFile(userConfigFile)
    let data: IConfigurationData = {
      defaults: loadDefaultConfigurations(),
      user,
      workspace: { contents: {} }
    }
    this._configuration = Configurations.parse(data)
    this.watchFile(userConfigFile, ConfigurationTarget.User)
    this.addFolderFromCwd()
  }

  private parseContentFromFile(filepath: string): IConfigurationModel {
    if (!filepath) return { contents: {} }
    let uri = URI.file(filepath).toString()
    this._errorItems = this._errorItems.filter(o => o.location.uri != uri)
    let res = parseContentFromFile(filepath, errors => {
      this._errorItems.push(...errors)
    })
    this._onError.fire(this._errorItems)
    return res
  }

  public get errorItems(): ErrorItem[] {
    return this._errorItems
  }

  public get foldConfigurations(): Map<string, ConfigurationModel> {
    return this._folderConfigurations
  }

  // used for extensions, no change event fired
  public extendsDefaults(props: { [key: string]: any }): void {
    let { defaults } = this._configuration
    let { contents } = defaults
    contents = deepClone(contents)
    Object.keys(props).forEach(key => {
      addToValueTree(contents, key, props[key], msg => {
        logger.error(msg)
      })
    })
    let data: IConfigurationData = {
      defaults: { contents },
      user: this._configuration.user,
      workspace: this._configuration.workspace
    }
    this._configuration = Configurations.parse(data)
  }

  // change user configuration, without change file
  public updateUserConfig(props: { [key: string]: any }): void {
    if (!props || Object.keys(props).length == 0) return
    let { user } = this._configuration
    let model = user.clone()
    Object.keys(props).forEach(key => {
      let val = props[key]
      if (val === undefined) {
        model.removeValue(key)
      } else if (objectLiteral(val)) {
        for (let k of Object.keys(val)) {
          model.setValue(`${key}.${k}`, val[k])
        }
      } else {
        model.setValue(key, val)
      }
    })
    this.changeConfiguration(ConfigurationTarget.User, model, undefined)
  }

  public get defaults(): ConfigurationModel {
    return this._configuration.defaults
  }

  public get user(): ConfigurationModel {
    return this._configuration.user
  }

  public get workspace(): ConfigurationModel {
    return this._configuration.workspace
  }

  public addFolderFile(filepath: string, change = true, fromCwd = false): boolean {
    if (!fs.existsSync(filepath)) return false
    if (sameFile(this.userConfigFile, filepath)) return false
    if (sameFile(filepath, path.join(os.homedir(), `.vim/${CONFIG_FILE_NAME}`))) return false
    this.watchFile(filepath, ConfigurationTarget.Workspace)
    let model = this.addFolderConfiguration(filepath)
    logger.debug(`Add folder configuration from ${fromCwd ? 'cwd' : 'file'}:`, filepath)
    if (!change) return true
    this.changeConfiguration(ConfigurationTarget.Workspace, model, filepath)
    return true
  }

  public addFolderFromCwd(): void {
    let filepath = path.join(process.cwd(), `.vim/${CONFIG_FILE_NAME}`)
    this.addFolderFile(filepath, true, true)
  }

  private watchFile(filepath: string, target: ConfigurationTarget): void {
    if (!fs.existsSync(filepath) || global.hasOwnProperty('__TEST__')) return
    let disposable = watchFile(filepath, () => {
      let model = this.addFolderConfiguration(filepath)
      this.changeConfiguration(target, model, filepath)
    })
    this.disposables.push(disposable)
  }

  private addFolderConfiguration(configFile: string): IConfigurationModel {
    let model = this.parseContentFromFile(configFile)
    this._folderConfigurations.set(configFile, new ConfigurationModel(model.contents))
    return model
  }

  // create new configuration and fire change event
  public changeConfiguration(target: ConfigurationTarget, model: IConfigurationModel, configFile: string | undefined): void {
    let { defaults, user, workspace } = this._configuration
    let { workspaceConfigFile } = this
    let data: IConfigurationData = {
      defaults: target == ConfigurationTarget.Global ? model : defaults,
      user: target == ConfigurationTarget.User ? model : user,
      workspace: target == ConfigurationTarget.Workspace ? model : workspace,
    }
    let configuration = Configurations.parse(data)
    let changed = getChangedKeys(this._configuration.getValue(), configuration.getValue())
    if (target == ConfigurationTarget.Workspace) {
      logger.debug('Change folder configuration to:', configFile)
      this.workspaceConfigFile = configFile
    }
    if (changed.length == 0) return
    this._configuration = configuration
    this._onChange.fire({
      affectsConfiguration: (section, resource) => {
        if (!resource || target != ConfigurationTarget.Workspace) return changed.includes(section)
        let u = URI.parse(resource)
        if (u.scheme !== 'file') return changed.includes(section)
        let filepath = u.fsPath
        let preRoot = workspaceConfigFile ? path.resolve(workspaceConfigFile, '../..') : ''
        if (configFile && !isParentFolder(preRoot, filepath, true) && !isParentFolder(path.resolve(configFile, '../..'), filepath)) {
          return false
        }
        return changed.includes(section)
      }
    })
  }

  private getFolderConfigFile(filepath: string): string | undefined {
    let { folders } = this
    let folder = folders.find(f => isParentFolder(f, filepath, true))
    return folder ? path.join(folder, `.vim/${CONFIG_FILE_NAME}`) : undefined
  }

  public getConfigFile(target: ConfigurationTarget): string {
    if (target == ConfigurationTarget.Global) return null
    if (target == ConfigurationTarget.User) return this.userConfigFile
    return this.workspaceConfigFile
  }

  private get folders(): string[] {
    let res: string[] = []
    let { _folderConfigurations } = this
    for (let folder of _folderConfigurations.keys()) {
      res.push(path.resolve(folder, '../..'))
    }
    return res
  }

  public get configuration(): Configuration {
    return this._configuration
  }

  /**
   * getConfiguration
   *
   * @public
   * @param {string} section
   * @returns {WorkspaceConfiguration}
   */
  public getConfiguration(section?: string, resource?: string): WorkspaceConfiguration {
    let configuration: Configuration
    if (resource) {
      let { defaults, user } = this._configuration
      configuration = new Configuration(defaults, user, this.getFolderConfiguration(resource))
    } else {
      configuration = this._configuration
    }
    const config = Object.freeze(lookUp(configuration.getValue(null), section))

    const result: WorkspaceConfiguration = {
      has(key: string): boolean {
        return typeof lookUp(config, key) !== 'undefined'
      },
      get: <T>(key: string, defaultValue?: T) => {
        let result: T = lookUp(config, key)
        if (result == null) return defaultValue
        return result
      },
      update: (key: string, value: any, isUser = false) => {
        let s = section ? `${section}.${key}` : key
        let target = isUser ? ConfigurationTarget.User : ConfigurationTarget.Workspace
        let model = target == ConfigurationTarget.User ? this.user.clone() : this.workspace.clone()
        if (value == undefined) {
          model.removeValue(s)
        } else {
          model.setValue(s, value)
        }
        if (target == ConfigurationTarget.Workspace && !this.workspaceConfigFile && this._proxy) {
          let file = this.workspaceConfigFile = this._proxy.workspaceConfigFile
          if (!fs.existsSync(file)) {
            let folder = path.dirname(file)
            if (!fs.existsSync(folder)) fs.mkdirSync(folder)
            fs.writeFileSync(file, '{}', { encoding: 'utf8' })
          }
        }
        this.changeConfiguration(target, model, target == ConfigurationTarget.Workspace ? this.workspaceConfigFile : this.userConfigFile)
        if (this._proxy && !global.hasOwnProperty('__TEST__')) {
          if (value == undefined) {
            this._proxy.$removeConfigurationOption(target, s)
          } else {
            this._proxy.$updateConfigurationOption(target, s, value)
          }
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
    return deepFreeze(result)
  }

  private getFolderConfiguration(uri: string): ConfigurationModel {
    let u = URI.parse(uri)
    if (u.scheme != 'file') return new ConfigurationModel()
    let filepath = u.fsPath
    for (let [configFile, model] of this.foldConfigurations) {
      let root = path.resolve(configFile, '../..')
      if (isParentFolder(root, filepath, true)) return model
    }
    return new ConfigurationModel()
  }

  /**
   * Resolve folder configuration from uri, returns resolved config file path.
   */
  public resolveFolderConfigution(uri: string): string | undefined {
    let u = URI.parse(uri)
    if (u.scheme != 'file') return
    let rootPath = path.dirname(u.fsPath)
    let configFile = this.getFolderConfigFile(rootPath)
    if (configFile) return configFile
    let folder = findUp('.vim', rootPath)
    if (!folder) return
    let filepath = path.join(folder, CONFIG_FILE_NAME)
    let added = this.addFolderFile(filepath, false)
    if (!added) return
    return filepath
  }

  /**
   * Try to change current workspace configuration by uri
   */
  public setFolderConfiguration(uri: string): void {
    let u = URI.parse(uri)
    if (u.scheme != 'file') return
    let filepath = u.fsPath
    for (let [configFile, model] of this.foldConfigurations) {
      let root = path.resolve(configFile, '../..')
      if (isParentFolder(root, filepath, true)) {
        if (this.workspaceConfigFile != configFile) {
          this.changeConfiguration(ConfigurationTarget.Workspace, model, configFile)
        }
        break
      }
    }
  }

  private static parse(data: IConfigurationData): Configuration {
    const defaultConfiguration = new ConfigurationModel(data.defaults.contents)
    const userConfiguration = new ConfigurationModel(data.user.contents)
    const workspaceConfiguration = new ConfigurationModel(data.workspace.contents)
    return new Configuration(defaultConfiguration, userConfiguration, workspaceConfiguration, new ConfigurationModel())
  }

  /**
   * Reset configurations
   */
  public reset(): void {
    this._errorItems = []
    this._folderConfigurations.clear()
    let user = this.parseContentFromFile(this.userConfigFile)
    let data: IConfigurationData = {
      defaults: loadDefaultConfigurations(),
      user,
      workspace: { contents: {} }
    }
    this._configuration = Configurations.parse(data)
    this._onChange.fire({
      affectsConfiguration: () => {
        return true
      }
    })
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

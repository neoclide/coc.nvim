import os from 'os'
import fs from 'fs'
import path from 'path'
import { Emitter, Event, Disposable } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { ConfigurationChangeEvent, ConfigurationInspect, ConfigurationShape, ConfigurationTarget, IConfigurationData, IConfigurationModel, WorkspaceConfiguration } from '../types'
import { deepClone, deepFreeze, mixin } from '../util/object'
import { watchFile, disposeAll, CONFIG_FILE_NAME } from '../util'
import { Configuration } from './configuration'
import { ConfigurationModel } from './model'
import { addToValueTree, loadDefaultConfigurations, parseContentFromFile, ErrorItem, getChangedKeys } from './util'
import { objectLiteral } from '../util/is'
import { isParentFolder, findUp } from '../util/fs'
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
  private workspaceConfigFile: string

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
    let folderConfigFile = path.join(process.cwd(), `.vim/${CONFIG_FILE_NAME}`)
    if (folderConfigFile != userConfigFile && fs.existsSync(folderConfigFile)) {
      this.addFolderFile(folderConfigFile)
    }
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
    this.changeConfiguration(ConfigurationTarget.User, model)
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

  public addFolderFile(filepath: string): void {
    let { _folderConfigurations } = this
    if (_folderConfigurations.has(filepath)) return
    if (path.resolve(filepath, '../..') == os.homedir()) return
    let model = this.parseContentFromFile(filepath)
    this.watchFile(filepath, ConfigurationTarget.Workspace)
    this.changeConfiguration(ConfigurationTarget.Workspace, model, filepath)
  }

  private watchFile(filepath: string, target: ConfigurationTarget): void {
    if (!fs.existsSync(filepath) || global.hasOwnProperty('__TEST__')) return
    let disposable = watchFile(filepath, () => {
      let model = this.parseContentFromFile(filepath)
      this.changeConfiguration(target, model, filepath)
    })
    this.disposables.push(disposable)
  }

  // create new configuration and fire change event
  public changeConfiguration(target: ConfigurationTarget, model: IConfigurationModel, configFile?: string): void {
    let { defaults, user, workspace } = this._configuration
    let { workspaceConfigFile } = this
    let data: IConfigurationData = {
      defaults: target == ConfigurationTarget.Global ? model : defaults,
      user: target == ConfigurationTarget.User ? model : user,
      workspace: target == ConfigurationTarget.Workspace ? model : workspace,
    }
    let configuration = Configurations.parse(data)
    let changed = getChangedKeys(this._configuration.getValue(), configuration.getValue())
    if (target == ConfigurationTarget.Workspace && configFile) {
      this._folderConfigurations.set(configFile, new ConfigurationModel(model.contents))
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

  public setFolderConfiguration(uri: string): void {
    let u = URI.parse(uri)
    if (u.scheme != 'file') return
    let filepath = u.fsPath
    for (let [configFile, model] of this.foldConfigurations) {
      let root = path.resolve(configFile, '../..')
      if (isParentFolder(root, filepath, true) && this.workspaceConfigFile != configFile) {
        this.changeConfiguration(ConfigurationTarget.Workspace, model, configFile)
        break
      }
    }
  }

  public hasFolderConfiguration(filepath: string): boolean {
    let { folders } = this
    return folders.findIndex(f => isParentFolder(f, filepath, true)) !== -1
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

  public checkFolderConfiguration(uri: string): void {
    let u = URI.parse(uri)
    if (u.scheme != 'file') return
    let rootPath = path.dirname(u.fsPath)
    if (!this.hasFolderConfiguration(rootPath)) {
      let folder = findUp('.vim', rootPath)
      if (folder && folder != os.homedir()) {
        let file = path.join(folder, CONFIG_FILE_NAME)
        if (fs.existsSync(file)) {
          this.addFolderFile(file)
        }
      }
    } else {
      this.setFolderConfiguration(uri)
    }
  }

  private static parse(data: IConfigurationData): Configuration {
    const defaultConfiguration = new ConfigurationModel(data.defaults.contents)
    const userConfiguration = new ConfigurationModel(data.user.contents)
    const workspaceConfiguration = new ConfigurationModel(data.workspace.contents)
    return new Configuration(defaultConfiguration, userConfiguration, workspaceConfiguration, new ConfigurationModel())
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

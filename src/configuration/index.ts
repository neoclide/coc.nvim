'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Diagnostic, Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import defaultSchema from '../../data/schema.json'
import { createLogger } from '../logger'
import { ConfigurationInspect, ConfigurationResourceScope, ConfigurationTarget, ConfigurationUpdateTarget, IConfigurationChange, IConfigurationChangeEvent, IConfigurationOverrides, WorkspaceConfiguration } from '../types'
import { CONFIG_FILE_NAME, disposeAll } from '../util'
import { isFalsyOrEmpty } from '../util/array'
import { findUp, normalizeFilePath, sameFile, watchFile } from '../util/fs'
import { objectLiteral } from '../util/is'
import { Extensions as JSONExtensions, IJSONContributionRegistry } from '../util/jsonRegistry'
import { IJSONSchema } from '../util/jsonSchema'
import { deepFreeze, hasOwnProperty, mixin } from '../util/object'
import { convertProperties, Registry } from '../util/registry'
import { Configuration } from './configuration'
import { ConfigurationChangeEvent } from './event'
import { ConfigurationModel } from './model'
import { ConfigurationModelParser } from './parser'
import { allSettings, Extensions, IConfigurationNode, IConfigurationRegistry, resourceSettings } from './registry'
import { IConfigurationShape } from './shape'
import { addToValueTree, convertTarget, scopeToOverrides } from './util'
const logger = createLogger('configurations')

export const userSettingsSchemaId = 'vscode://schemas/settings/user'
export const folderSettingsSchemaId = 'vscode://schemas/settings/folder'

const jsonRegistry = Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution)

interface ConfigurationErrorEvent {
  uri: string,
  diagnostics: Diagnostic[]
}

export default class Configurations {
  private _watchedFiles: Set<string> = new Set()
  private builtinKeys: string[] = []
  private _configuration: Configuration
  private _errors: Map<string, Diagnostic[]> = new Map()
  private _onError = new Emitter<ConfigurationErrorEvent>()
  private _onChange = new Emitter<IConfigurationChangeEvent>()
  private disposables: Disposable[] = []

  public readonly onError: Event<ConfigurationErrorEvent> = this._onError.event
  public readonly onDidChange: Event<IConfigurationChangeEvent> = this._onChange.event

  constructor(
    private userConfigFile?: string | undefined,
    private readonly _proxy?: IConfigurationShape,
    private noWatch = global.__TEST__,
    cwd = process.cwd()
  ) {
    let defaultConfiguration = this.loadDefaultConfigurations()
    let userConfiguration = this.parseConfigurationModel(this.userConfigFile)
    this._configuration = new Configuration(defaultConfiguration, userConfiguration)
    this.watchFile(this.userConfigFile, ConfigurationTarget.User)
    let filepath = this.folderToConfigfile(cwd)
    if (filepath) this.addFolderFile(filepath, true)
  }

  public get errors(): Map<string, Diagnostic[]> {
    return this._errors
  }

  public get configuration(): Configuration {
    return this._configuration
  }

  private loadDefaultConfigurations(): ConfigurationModel {
    // register properties and listen events
    let configuration = Registry.as<IConfigurationRegistry>(Extensions.Configuration)
    let node: IConfigurationNode = { properties: convertProperties(defaultSchema.properties) }
    configuration.registerConfiguration(node)
    configuration.onDidUpdateConfiguration(e => {
      if (e.properties.length === 0) return
      // update default configuration with new value
      let dict = configuration.getConfigurationProperties()
      let model = this._configuration.defaults.clone()
      for (let key of e.properties) {
        let def = dict[key]
        if (def) {
          model.setValue(key, def.default)
        } else {
          model.removeValue(key)
        }
      }
      this.changeConfiguration(ConfigurationTarget.Default, model, undefined, e.properties)
    }, null, this.disposables)
    let properties = configuration.getConfigurationProperties()
    let config = {}
    let keys: string[] = []
    Object.keys(properties).forEach(key => {
      let value = properties[key].default
      keys.push(key)
      addToValueTree(config, key, value, undefined)
    })
    this.builtinKeys = keys.slice()
    let model = new ConfigurationModel(config, keys)
    return model
  }

  public getJSONSchema(uri: string): IJSONSchema | undefined {
    if (uri === userSettingsSchemaId) {
      return {
        properties: allSettings.properties,
        patternProperties: allSettings.patternProperties,
        definitions: defaultSchema.definitions as any,
        additionalProperties: false,
        allowTrailingCommas: true,
        allowComments: true
      }
    }
    if (uri === folderSettingsSchemaId) {
      return {
        properties: resourceSettings.properties,
        patternProperties: resourceSettings.patternProperties,
        definitions: defaultSchema.definitions as any,
        errorMessage: 'Configuration property may not work as folder configuration',
        additionalProperties: false,
        allowTrailingCommas: true,
        allowComments: true
      }
    }
    let schemas = jsonRegistry.getSchemaContributions().schemas
    if (hasOwnProperty(schemas, uri)) return schemas[uri]
    return undefined
  }

  public parseConfigurationModel(filepath: string | undefined): ConfigurationModel {
    if (!filepath) return new ConfigurationModel()
    let parser = new ConfigurationModelParser(filepath)
    let content = fs.existsSync(filepath) ? fs.readFileSync(filepath, 'utf8') : ''
    let uri = URI.file(filepath).toString()
    parser.parse(content)
    if (!isFalsyOrEmpty(parser.errors)) {
      this._errors.set(uri, parser.errors)
      this._onError.fire({ uri, diagnostics: parser.errors })
    } else {
      this._errors.delete(uri)
      this._onError.fire({ uri, diagnostics: [] })
    }
    return parser.configurationModel
  }

  public folderToConfigfile(folder: string): string | undefined {
    if (sameFile(folder, os.homedir())) return undefined
    let filepath = path.join(folder, `.vim/${CONFIG_FILE_NAME}`)
    if (sameFile(filepath, this.userConfigFile)) return undefined
    return filepath
  }

  // change memory configuration
  public updateMemoryConfig(props: { [key: string]: any }): void {
    let keys = Object.keys(props)
    if (!props || keys.length == 0) return
    let { builtinKeys } = this
    let memoryModel = this._configuration.memory.clone()
    keys.forEach(key => {
      let val = props[key]
      if (val === undefined) {
        memoryModel.removeValue(key)
      } else if (builtinKeys.includes(key)) {
        memoryModel.setValue(key, val)
      } else if (objectLiteral(val)) {
        for (let k of Object.keys(val)) {
          memoryModel.setValue(`${key}.${k}`, val[k])
        }
      } else {
        memoryModel.setValue(key, val)
      }
    })
    this.changeConfiguration(ConfigurationTarget.Memory, memoryModel, undefined, keys)
  }

  /**
   * Add new folder config file.
   */
  public addFolderFile(configFilePath: string, fromCwd = false, resource?: string): boolean {
    let folder = normalizeFilePath(path.resolve(configFilePath, '../..'))
    if (this._configuration.hasFolder(folder) || !fs.existsSync(configFilePath)) return false
    this.watchFile(configFilePath, ConfigurationTarget.WorkspaceFolder)
    let model = this.parseConfigurationModel(configFilePath)
    this._configuration.addFolderConfiguration(folder, model, resource)
    logger.info(`Add folder configuration from ${fromCwd ? 'cwd' : 'file'}:`, configFilePath)
    return true
  }

  private watchFile(filepath: string, target: ConfigurationTarget): void {
    if (!fs.existsSync(filepath) || this._watchedFiles.has(filepath) || this.noWatch) return
    this._watchedFiles.add(filepath)
    const folder = ConfigurationTarget.WorkspaceFolder ? normalizeFilePath(path.resolve(filepath, '../..')) : undefined
    let disposable = watchFile(filepath, () => {
      let model = this.parseConfigurationModel(filepath)
      this.changeConfiguration(target, model, folder)
    })
    this.disposables.push(disposable)
  }

  /**
   * Update ConfigurationModel and fire event.
   */
  public changeConfiguration(target: ConfigurationTarget, model: ConfigurationModel, folder: string | undefined, keys?: string[]): void {
    let configuration = this._configuration
    let previous = configuration.toData()
    let change: IConfigurationChange
    if (target === ConfigurationTarget.Default) {
      change = configuration.compareAndUpdateDefaultConfiguration(model, keys)
    } else if (target === ConfigurationTarget.User) {
      change = configuration.compareAndUpdateUserConfiguration(model)
    } else if (target === ConfigurationTarget.Workspace) {
      change = configuration.compareAndUpdateWorkspaceConfiguration(model)
    } else if (target === ConfigurationTarget.WorkspaceFolder) {
      change = configuration.compareAndUpdateFolderConfiguration(folder, model)
    } else {
      change = configuration.compareAndUpdateMemoryConfiguration(model)
    }
    if (!change || change.keys.length == 0) return
    let ev = new ConfigurationChangeEvent(change, previous, configuration)
    ev.source = target
    this._onChange.fire(ev)
  }

  public getDefaultResource(): string | undefined {
    let root = this._proxy?.root
    if (!root) return undefined
    return URI.file(root).toString()
  }

  /**
   * Get workspace configuration
   */
  public getConfiguration(section?: string, scope?: ConfigurationResourceScope): WorkspaceConfiguration {
    let configuration = this._configuration
    let overrides: IConfigurationOverrides = scope ? scopeToOverrides(scope) : { resource: scope === null ? undefined : this.getDefaultResource() }
    const config = Object.freeze(lookUp(configuration.getValue(undefined, overrides), section))

    const result: WorkspaceConfiguration = {
      has(key: string): boolean {
        return typeof lookUp(config, key) !== 'undefined'
      },
      get: <T>(key: string, defaultValue?: T) => {
        let result: T = lookUp(config, key)
        if (result == null) return defaultValue
        return result
      },
      update: (key: string, value?: any, updateTarget: ConfigurationUpdateTarget | boolean = false): Promise<void> => {
        const resource = overrides.resource
        let entry = section ? `${section}.${key}` : key
        let target: ConfigurationTarget
        if (typeof updateTarget === 'boolean') {
          target = updateTarget ? ConfigurationTarget.User : ConfigurationTarget.WorkspaceFolder
        } else {
          target = convertTarget(updateTarget)
        }
        // let folderConfigFile: string | undefined
        let folder: string | undefined
        if (target === ConfigurationTarget.WorkspaceFolder) {
          folder = this._configuration.resolveFolder(resource) ?? this.resolveWorkspaceFolderForResource(resource)
          if (!folder) {
            console.error(`Unable to locate workspace folder configuration for ${resource}`)
            logger.error(`Unable to locate workspace folder configuration`, resource, Error().stack)
            return
          }
        }

        let model: ConfigurationModel = this._configuration.getConfigurationModel(target, folder).clone()
        if (value === undefined) {
          model.removeValue(entry)
        } else {
          model.setValue(entry, value)
        }

        this.changeConfiguration(target, model, folder)
        let fsPath: string
        if (target === ConfigurationTarget.WorkspaceFolder) {
          fsPath = this.folderToConfigfile(folder)
        } else if (target === ConfigurationTarget.User) {
          fsPath = this.userConfigFile
        }
        return fsPath ? this._proxy?.modifyConfiguration(fsPath, entry, value) : Promise.resolve()
      },
      inspect: <T>(key: string): ConfigurationInspect<T> => {
        key = section ? `${section}.${key}` : key
        const config = this._configuration.inspect<T>(key, overrides)
        return {
          key,
          defaultValue: config.defaultValue,
          globalValue: config.userValue,
          workspaceValue: config.workspaceValue,
          workspaceFolderValue: config.workspaceFolderValue
        }
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

  /**
   * Resolve folder configuration from uri.
   */
  public locateFolderConfigution(uri: string): boolean {
    let folder = this._configuration.resolveFolder(uri)
    if (folder) return true
    let u = URI.parse(uri)
    if (u.scheme !== 'file') return false
    let dir = folder = findUp('.vim', u.fsPath)
    if (!dir) return false
    folder = path.dirname(dir)
    let filepath = this.folderToConfigfile(folder)
    if (filepath) {
      this.addFolderFile(filepath, false, uri)
      return true
    }
    return false
  }

  /**
   * Resolve workspace folder config file path.
   */
  public resolveWorkspaceFolderForResource(resource?: string): string | undefined {
    if (this._proxy && typeof this._proxy.getWorkspaceFolder === 'function') {
      // fallback to check workspace folder.
      let uri = this._proxy.getWorkspaceFolder(resource)
      if (!uri) return undefined
      let fsPath = uri.fsPath
      let configFilePath = this.folderToConfigfile(fsPath)
      if (configFilePath) {
        if (!fs.existsSync(configFilePath)) {
          fs.mkdirSync(path.dirname(configFilePath), { recursive: true })
          fs.writeFileSync(configFilePath, '{}', 'utf8')
        }
        this.addFolderFile(configFilePath, false, resource)
        return fsPath
      }
    }
    return undefined
  }

  /**
   * Reset configurations for test
   */
  public reset(): void {
    this._errors.clear()
    let model = new ConfigurationModel()
    this.changeConfiguration(ConfigurationTarget.Memory, model, undefined)
  }

  public dispose(): void {
    this._onError.dispose()
    this._onChange.dispose()
    disposeAll(this.disposables)
  }
}

function lookUp(tree: any, key: string): any {
  if (key) {
    if (tree && hasOwnProperty(tree, key)) return tree[key]
    const parts = key.split('.')
    let node = tree
    for (let i = 0; node && i < parts.length; i++) {
      node = node[parts[i]]
    }
    return node
  }
  return tree
}

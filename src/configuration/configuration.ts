'use strict'
import { URI } from 'vscode-uri'
import { ConfigurationTarget, IConfigurationChange, IConfigurationData, IConfigurationModel, IConfigurationOverrides } from './types'
import { distinct } from '../util/array'
import { isParentFolder, normalizeFilePath, sameFile } from '../util/fs'
import { equals } from '../util/object'
import { ConfigurationModel } from './model'
import { compareConfigurationContents, IConfigurationCompareResult, overrideIdentifiersFromKey } from './util'

export interface IConfigurationValue<T> {
  readonly defaultValue?: T
  readonly userValue?: T
  readonly workspaceValue?: T
  readonly workspaceFolderValue?: T
  readonly memoryValue?: T
  readonly value?: T
  readonly default?: { value?: T; override?: T }
  readonly user?: { value?: T; override?: T }
  readonly workspace?: { value?: T; override?: T }
  readonly workspaceFolder?: { value?: T; override?: T }
  readonly memory?: { value?: T; override?: T }
  readonly overrideIdentifiers?: string[]
}

export class FolderConfigutions {
  private _folderConfigurations: Map<string, ConfigurationModel> = new Map()

  public get keys(): Iterable<string> {
    return this._folderConfigurations.keys()
  }

  public has(folder: string): boolean {
    for (let key of this.keys) {
      if (sameFile(folder, key)) return true
    }
    return false
  }

  public set(folder: string, model: ConfigurationModel): void {
    let key = normalizeFilePath(folder)
    this._folderConfigurations.set(key, model)
  }

  public get(folder: string): ConfigurationModel | undefined {
    let key = normalizeFilePath(folder)
    return this._folderConfigurations.get(key)
  }

  public delete(folder: string): void {
    let key = normalizeFilePath(folder)
    this._folderConfigurations.delete(key)
  }

  public forEach(fn: (model: ConfigurationModel, key: string) => void): void {
    this._folderConfigurations.forEach(fn)
  }

  public getConfigurationByResource(uri: string): { folder: string, model: ConfigurationModel } | undefined {
    let u = URI.parse(uri)
    if (u.scheme !== 'file') return undefined
    let folders = Array.from(this._folderConfigurations.keys())
    folders.sort((a, b) => b.length - a.length)
    let fullpath = u.fsPath
    for (let folder of folders) {
      if (isParentFolder(folder, fullpath, true)) {
        return { folder, model: this._folderConfigurations.get(folder) }
      }
    }
    return undefined
  }
}

export class Configuration {
  private _workspaceConsolidatedConfiguration: ConfigurationModel | null = null
  private _resolvedFolderConfigurations: Map<string, string> = new Map()
  private _memoryConfigurationByResource: Map<string, ConfigurationModel> = new Map()

  constructor(
    private _defaultConfiguration: ConfigurationModel,
    private _userConfiguration: ConfigurationModel,
    private _workspaceConfiguration: ConfigurationModel = new ConfigurationModel(),
    private _folderConfigurations: FolderConfigutions = new FolderConfigutions(),
    private _memoryConfiguration: ConfigurationModel = new ConfigurationModel()
  ) {
  }

  public updateValue(key: string, value: any, overrides: IConfigurationOverrides = {}): void {
    let memoryConfiguration: ConfigurationModel | undefined
    if (overrides.resource) {
      memoryConfiguration = this._memoryConfigurationByResource.get(overrides.resource)
      if (!memoryConfiguration) {
        memoryConfiguration = new ConfigurationModel()
        this._memoryConfigurationByResource.set(overrides.resource, memoryConfiguration)
      }
    } else {
      memoryConfiguration = this._memoryConfiguration
    }
    if (value === undefined) {
      memoryConfiguration.removeValue(key)
    } else {
      memoryConfiguration.setValue(key, value)
    }
    if (!overrides.resource) {
      this._workspaceConsolidatedConfiguration = null
    }
  }

  public hasFolder(folder: string): boolean {
    return this._folderConfigurations.has(folder)
  }

  public addFolderConfiguration(folder: string, model: ConfigurationModel, resource?: string): void {
    this._folderConfigurations.set(folder, model)
    if (resource) {
      this._resolvedFolderConfigurations.set(resource, folder)
    }
  }

  public deleteFolderConfiguration(fsPath: string): void {
    this._folderConfigurations.delete(fsPath)
  }

  private getWorkspaceConsolidateConfiguration(): ConfigurationModel {
    if (!this._workspaceConsolidatedConfiguration) {
      this._workspaceConsolidatedConfiguration = this._defaultConfiguration.merge(this._userConfiguration, this._workspaceConfiguration, this._memoryConfiguration)
      this._workspaceConsolidatedConfiguration = this._workspaceConsolidatedConfiguration.freeze()
    }
    return this._workspaceConsolidatedConfiguration
  }

  /**
   * Get folder configuration fsPath & model
   *
   * @param uri folder or file uri
   */
  public getFolderConfigurationModelForResource(uri: string): ConfigurationModel | undefined {
    let folder = this._resolvedFolderConfigurations.get(uri)
    if (folder) return this._folderConfigurations.get(folder)
    let conf = this._folderConfigurations.getConfigurationByResource(uri)
    if (!conf) return undefined
    this._resolvedFolderConfigurations.set(uri, conf.folder)
    return conf.model
  }

  public resolveFolder(uri: string): string | undefined {
    let folder = this._resolvedFolderConfigurations.get(uri)
    if (folder) return folder
    let folders = Array.from(this._folderConfigurations.keys)
    folders.sort((a, b) => b.length - a.length)
    for (let folder of folders) {
      if (isParentFolder(folder, URI.parse(uri).fsPath, true)) {
        this._resolvedFolderConfigurations.set(uri, folder)
        return folder
      }
    }
    return undefined
  }

  private getConsolidatedConfigurationModel(overrides: IConfigurationOverrides): ConfigurationModel {
    let configuration = this.getWorkspaceConsolidateConfiguration()
    if (overrides.resource) {
      let folderConfiguration = this.getFolderConfigurationModelForResource(overrides.resource)
      if (folderConfiguration) {
        configuration = configuration.merge(folderConfiguration)
      }
      const memoryConfigurationForResource = this._memoryConfigurationByResource.get(overrides.resource)
      if (memoryConfigurationForResource) {
        configuration = configuration.merge(memoryConfigurationForResource)
      }
    }
    if (overrides.overrideIdentifier) {
      configuration = configuration.override(overrides.overrideIdentifier)
    }
    return configuration
  }

  public getValue(section: string | undefined, overrides: IConfigurationOverrides): any {
    let configuration = this.getConsolidatedConfigurationModel(overrides)
    return configuration.getValue(section)
  }

  public inspect<C>(key: string, overrides: IConfigurationOverrides): IConfigurationValue<C> {
    const consolidateConfigurationModel = this.getConsolidatedConfigurationModel(overrides)
    const folderConfigurationModel = this.getFolderConfigurationModelForResource(overrides.resource)
    const memoryConfigurationModel = overrides.resource ? this._memoryConfigurationByResource.get(overrides.resource) || this._memoryConfiguration : this._memoryConfiguration

    const defaultValue = overrides.overrideIdentifier ? this._defaultConfiguration.freeze().override(overrides.overrideIdentifier).getValue<C>(key) : this._defaultConfiguration.freeze().getValue<C>(key)
    const userValue = overrides.overrideIdentifier ? this._userConfiguration.freeze().override(overrides.overrideIdentifier).getValue<C>(key) : this._userConfiguration.freeze().getValue<C>(key)
    const workspaceValue = overrides.overrideIdentifier ? this._workspaceConfiguration.freeze().override(overrides.overrideIdentifier).getValue<C>(key) : this._workspaceConfiguration.freeze().getValue<C>(key)

    const workspaceFolderValue = folderConfigurationModel ? overrides.overrideIdentifier ? folderConfigurationModel.freeze().override(overrides.overrideIdentifier).getValue<C>(key) : folderConfigurationModel.freeze().getValue<C>(key) : undefined
    const memoryValue = overrides.overrideIdentifier ? memoryConfigurationModel.override(overrides.overrideIdentifier).getValue<C>(key) : memoryConfigurationModel.getValue<C>(key)
    const value = consolidateConfigurationModel.getValue<C>(key)
    const overrideIdentifiers: string[] = distinct(consolidateConfigurationModel.overrides.map(override => override.identifiers).flat()).filter(overrideIdentifier => consolidateConfigurationModel.getOverrideValue(key, overrideIdentifier) !== undefined)

    return {
      defaultValue,
      userValue,
      workspaceValue,
      workspaceFolderValue,
      memoryValue,
      value,
      default: defaultValue !== undefined ? { value: this._defaultConfiguration.freeze().getValue(key), override: overrides.overrideIdentifier ? this._defaultConfiguration.freeze().getOverrideValue(key, overrides.overrideIdentifier) : undefined } : undefined,
      user: userValue !== undefined ? { value: this._userConfiguration.freeze().getValue(key), override: overrides.overrideIdentifier ? this._userConfiguration.freeze().getOverrideValue(key, overrides.overrideIdentifier) : undefined } : undefined,
      workspace: workspaceValue !== undefined ? { value: this._workspaceConfiguration.freeze().getValue(key), override: overrides.overrideIdentifier ? this._workspaceConfiguration.freeze().getOverrideValue(key, overrides.overrideIdentifier) : undefined } : undefined,
      workspaceFolder: workspaceFolderValue !== undefined ? { value: folderConfigurationModel?.freeze().getValue(key), override: overrides.overrideIdentifier ? folderConfigurationModel?.freeze().getOverrideValue(key, overrides.overrideIdentifier) : undefined } : undefined,
      memory: memoryValue !== undefined ? { value: memoryConfigurationModel.getValue(key), override: overrides.overrideIdentifier ? memoryConfigurationModel.getOverrideValue(key, overrides.overrideIdentifier) : undefined } : undefined,
      overrideIdentifiers: overrideIdentifiers.length ? overrideIdentifiers : undefined
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

  public get memory(): ConfigurationModel {
    return this._memoryConfiguration
  }

  public getConfigurationModel(target: ConfigurationTarget, folder?: string): ConfigurationModel {
    switch (target) {
      case ConfigurationTarget.Default:
        return this._defaultConfiguration
      case ConfigurationTarget.User:
        return this._userConfiguration
      case ConfigurationTarget.Workspace:
        return this._workspaceConfiguration
      case ConfigurationTarget.WorkspaceFolder:
        return this._folderConfigurations.get(folder) ?? new ConfigurationModel()
      default:
        return this._memoryConfiguration
    }
  }

  public updateFolderConfiguration(folder: string, model: ConfigurationModel): void {
    this._folderConfigurations.set(folder, model)
  }

  public updateUserConfiguration(model: ConfigurationModel): void {
    this._userConfiguration = model
    this._workspaceConsolidatedConfiguration = null
  }

  public updateWorkspaceConfiguration(model: ConfigurationModel): void {
    this._workspaceConfiguration = model
    this._workspaceConsolidatedConfiguration = null
  }

  public updateDefaultConfiguration(model: ConfigurationModel): void {
    this._defaultConfiguration = model
    this._workspaceConsolidatedConfiguration = null
  }

  public updateMemoryConfiguration(model: ConfigurationModel): void {
    this._memoryConfiguration = model
    this._workspaceConsolidatedConfiguration = null
  }

  public compareAndUpdateMemoryConfiguration(memory: ConfigurationModel): IConfigurationChange {
    const { added, updated, removed, overrides } = compare(this._memoryConfiguration, memory)
    const keys = [...added, ...updated, ...removed]
    if (keys.length) {
      this.updateMemoryConfiguration(memory)
    }
    return { keys, overrides }
  }

  public compareAndUpdateUserConfiguration(user: ConfigurationModel): IConfigurationChange {
    const { added, updated, removed, overrides } = compare(this._userConfiguration, user)
    const keys = [...added, ...updated, ...removed]
    if (keys.length) {
      this.updateUserConfiguration(user)
    }
    return { keys, overrides }
  }

  public compareAndUpdateDefaultConfiguration(defaults: ConfigurationModel, keys?: string[]): IConfigurationChange {
    const overrides: [string, string[]][] = []
    if (!keys) {
      const { added, updated, removed } = compare(this._defaultConfiguration, defaults)
      keys = [...added, ...updated, ...removed]
    }
    for (const key of keys) {
      for (const overrideIdentifier of overrideIdentifiersFromKey(key)) {
        const fromKeys = this._defaultConfiguration.getKeysForOverrideIdentifier(overrideIdentifier)
        const toKeys = defaults.getKeysForOverrideIdentifier(overrideIdentifier)
        const keys = [
          ...toKeys.filter(key => fromKeys.indexOf(key) === -1),
          ...fromKeys.filter(key => toKeys.indexOf(key) === -1),
          ...fromKeys.filter(key => !equals(this._defaultConfiguration.override(overrideIdentifier).getValue(key), defaults.override(overrideIdentifier).getValue(key)))
        ]
        overrides.push([overrideIdentifier, keys])
      }
    }
    this.updateDefaultConfiguration(defaults)
    return { keys, overrides }
  }

  public compareAndUpdateWorkspaceConfiguration(workspaceConfiguration: ConfigurationModel): IConfigurationChange {
    const { added, updated, removed, overrides } = compare(this._workspaceConfiguration, workspaceConfiguration)
    const keys = [...added, ...updated, ...removed]
    if (keys.length) {
      this.updateWorkspaceConfiguration(workspaceConfiguration)
    }
    return { keys, overrides }
  }

  public compareAndUpdateFolderConfiguration(folder: string, folderConfiguration: ConfigurationModel): IConfigurationChange {
    const currentFolderConfiguration = this._folderConfigurations.get(folder)
    const { added, updated, removed, overrides } = compare(currentFolderConfiguration, folderConfiguration)
    const keys = [...added, ...updated, ...removed]
    if (keys.length || !currentFolderConfiguration) {
      this.updateFolderConfiguration(folder, folderConfiguration)
    }
    return { keys, overrides }
  }

  public compareAndDeleteFolderConfiguration(folder: string): IConfigurationChange {
    const folderConfig = this._folderConfigurations.get(folder)
    if (!folderConfig) return
    this.deleteFolderConfiguration(folder)
    const { added, updated, removed, overrides } = compare(folderConfig, undefined)
    return { keys: [...added, ...updated, ...removed], overrides }
  }

  public allKeys(): string[] {
    const keys: Set<string> = new Set<string>()
    this._defaultConfiguration.freeze().keys.forEach(key => keys.add(key))
    this._userConfiguration.freeze().keys.forEach(key => keys.add(key))
    this._workspaceConfiguration.freeze().keys.forEach(key => keys.add(key))
    this._folderConfigurations.forEach(folderConfiguration => folderConfiguration.freeze().keys.forEach(key => keys.add(key)))
    return [...keys.values()]
  }

  public toData(): IConfigurationData {
    let { _defaultConfiguration, _userConfiguration, _workspaceConfiguration, _folderConfigurations } = this
    let folders: [string, IConfigurationModel][] = []
    _folderConfigurations.forEach((model, fsPath) => {
      folders.push([fsPath, model.toJSON()])
    })
    return {
      defaults: _defaultConfiguration.toJSON(),
      user: _userConfiguration.toJSON(),
      workspace: _workspaceConfiguration.toJSON(),
      folders
    }
  }

  public static parse(data: IConfigurationData): Configuration {
    const defaultConfiguration = this.parseConfigurationModel(data.defaults)
    const userConfiguration = this.parseConfigurationModel(data.user)
    const workspaceConfiguration = this.parseConfigurationModel(data.workspace)
    const folderConfigurations: FolderConfigutions = new FolderConfigutions()
    data.folders.forEach(value => {
      folderConfigurations.set(value[0], this.parseConfigurationModel(value[1]))
    })
    return new Configuration(defaultConfiguration, userConfiguration, workspaceConfiguration, folderConfigurations)
  }

  private static parseConfigurationModel(model: IConfigurationModel): ConfigurationModel {
    return new ConfigurationModel(model.contents, model.keys, model.overrides).freeze()
  }
}

function compare(from: ConfigurationModel | undefined, to: ConfigurationModel | undefined): IConfigurationCompareResult {
  const { added, removed, updated } = compareConfigurationContents(to, from)
  const overrides: [string, string[]][] = []

  const fromOverrideIdentifiers = from?.getAllOverrideIdentifiers() ?? []
  const toOverrideIdentifiers = to?.getAllOverrideIdentifiers() ?? []

  if (to) {
    const addedOverrideIdentifiers = toOverrideIdentifiers.filter(key => !fromOverrideIdentifiers.includes(key))
    for (const identifier of addedOverrideIdentifiers) {
      overrides.push([identifier, to.getKeysForOverrideIdentifier(identifier)])
    }
  }

  if (from) {
    const removedOverrideIdentifiers = fromOverrideIdentifiers.filter(key => !toOverrideIdentifiers.includes(key))
    for (const identifier of removedOverrideIdentifiers) {
      overrides.push([identifier, from.getKeysForOverrideIdentifier(identifier)])
    }
  }

  if (to && from) {
    for (const identifier of fromOverrideIdentifiers) {
      if (toOverrideIdentifiers.includes(identifier)) {
        const result = compareConfigurationContents({ contents: from.getOverrideValue(undefined, identifier) || {}, keys: from.getKeysForOverrideIdentifier(identifier) }, { contents: to.getOverrideValue(undefined, identifier) || {}, keys: to.getKeysForOverrideIdentifier(identifier) })
        overrides.push([identifier, [...result.added, ...result.removed, ...result.updated]])
      }
    }
  }

  return { added, removed, updated, overrides }
}

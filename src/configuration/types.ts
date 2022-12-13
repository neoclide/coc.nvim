import type { TextDocument } from 'vscode-languageserver-textdocument'
import type { WorkspaceFolder } from 'vscode-languageserver-types'
import type { URI } from 'vscode-uri'

/**
 * An interface for a JavaScript object that
 * acts a dictionary. The keys are strings.
 */
export type IStringDictionary<V> = Record<string, V>

export enum ConfigurationTarget {
  Default,
  User,
  Workspace,
  WorkspaceFolder,
  Memory,
}

export interface IConfigurationChange {
  keys: string[]
  overrides: [string, string[]][]
}

export enum ConfigurationUpdateTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3
}

export const enum ConfigurationScope {
  /**
   * Application specific configuration, which can be configured only in local user settings.
   */
  APPLICATION = 1,
  /**
   * Window specific configuration, which can be configured in the user or workspace settings.
   */
  WINDOW,
  /**
   * Resource specific configuration, which can be configured in the user, workspace or folder settings.
   */
  RESOURCE,
  /**
   * Resource specific configuration that can be configured in language specific settings
   */
  LANGUAGE_OVERRIDABLE,
}

export type ConfigurationResourceScope = string | null | URI | TextDocument | WorkspaceFolder | { uri?: string; languageId?: string }

export interface IConfigurationChangeEvent {
  readonly source: ConfigurationTarget
  readonly affectedKeys: string[]
  readonly change?: IConfigurationChange
  affectsConfiguration(configuration: string, scope?: ConfigurationResourceScope): boolean
}

export interface ConfigurationInspect<T> {
  key: string
  defaultValue?: T
  globalValue?: T
  workspaceValue?: T
  workspaceFolderValue?: T
}

export interface IConfigurationOverrides {
  overrideIdentifier?: string | null
  resource?: string | null
}

export interface IOverrides {
  contents: any
  keys: string[]
  identifiers: string[]
}

export interface IConfigurationModel {
  contents: any
  keys: string[]
  overrides: IOverrides[]
}

export interface IConfigurationData {
  defaults: IConfigurationModel
  user: IConfigurationModel
  workspace: IConfigurationModel
  folders: [string, IConfigurationModel][]
}

export interface WorkspaceConfiguration {
  /**
   * Return a value from this configuration.
   *
   * @param section Configuration name, supports _dotted_ names.
   * @return The value `section` denotes or `undefined`.
   */
  get<T>(section: string): T | undefined

  /**
   * Return a value from this configuration.
   *
   * @param section Configuration name, supports _dotted_ names.
   * @param defaultValue A value should be returned when no value could be found, is `undefined`.
   * @return The value `section` denotes or the default.
   */
  get<T>(section: string, defaultValue: T): T

  /**
   * Check if this configuration has a certain value.
   *
   * @param section Configuration name, supports _dotted_ names.
   * @return `true` if the section doesn't resolve to `undefined`.
   */
  has(section: string): boolean

  /**
   * Retrieve all information about a configuration setting. A configuration value
   * often consists of a *default* value, a global or installation-wide value,
   * a workspace-specific value
   *
   * *Note:* The configuration name must denote a leaf in the configuration tree
   * (`editor.fontSize` vs `editor`) otherwise no result is returned.
   *
   * @param section Configuration name, supports _dotted_ names.
   * @return Information about a configuration setting or `undefined`.
   */
  inspect<T>(section: string): ConfigurationInspect<T> | undefined
  /**
   * Update a configuration value. The updated configuration values are persisted.
   *
   *
   * @param section Configuration name, supports _dotted_ names.
   * @param value The new value.
   * @param isUser if true, always update user configuration
   */
  update(section: string, value: any, isUser?: ConfigurationUpdateTarget | boolean): Thenable<void>

  /**
   * Readable dictionary that backs this configuration.
   */
  readonly [key: string]: any
}

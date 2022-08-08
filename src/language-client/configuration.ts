'use strict'
import { ClientCapabilities, ConfigurationRequest, DidChangeConfigurationNotification, DidChangeConfigurationRegistrationOptions, Disposable, RegistrationType, WorkspaceFolder } from 'vscode-languageserver-protocol'
import workspace from '../workspace'
import * as UUID from './utils/uuid'
import * as Is from '../util/is'
import { FeatureState, RegistrationData, StaticFeature, DynamicFeature, ensure, FeatureClient } from './features'
import { FileSystemWatcher, ConfigurationChangeEvent } from '../types'
import { mergeConfigProperties } from '../configuration/util'
const logger = require('../util/logger')('languageclient-configuration')

export interface ConfigurationMiddleware {
  configuration?: ConfigurationRequest.MiddlewareSignature
}

interface ConfigurationWorkspaceMiddleware {
  workspace?: ConfigurationMiddleware
}

export interface SynchronizeOptions {
  /**
   * The configuration sections to synchronize. Pushing settings from the
   * client to the server is deprecated in favour of the new pull model
   * that allows servers to query settings scoped on resources. In this
   * model the client can only deliver an empty change event since the
   * actually setting value can vary on the provided resource scope.
   *
   * @deprecated Use the new pull model (`workspace/configuration` request)
   */
  configurationSection?: string | string[]

  /**
   * Asks the client to send file change events to the server. Watchers
   * operate on workspace folders. The LSP client doesn't support watching
   * files outside a workspace folder.
   */
  fileEvents?: FileSystemWatcher | FileSystemWatcher[]
}

export interface $ConfigurationOptions {
  synchronize?: SynchronizeOptions
  workspaceFolder?: WorkspaceFolder
}

export class PullConfigurationFeature implements StaticFeature {
  private languageserverSection: string | undefined
  constructor(private _client: FeatureClient<ConfigurationWorkspaceMiddleware, $ConfigurationOptions>) {
    let section = this._client.clientOptions.synchronize?.configurationSection
    if (typeof section === 'string' && section.startsWith('languageserver.')) {
      this.languageserverSection = section
    }
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    capabilities.workspace = capabilities.workspace || {}
    capabilities.workspace.configuration = true
  }

  public getState(): FeatureState {
    return { kind: 'static' }
  }

  public initialize(): void {
    let client = this._client
    client.onRequest(ConfigurationRequest.type, (params, token) => {
      let configuration: ConfigurationRequest.HandlerSignature = params => {
        let result: any[] = []
        for (let item of params.items) {
          result.push(this.getConfiguration(item.scopeUri, item.section))
        }
        return result
      }
      let middleware = client.middleware.workspace
      return middleware && middleware.configuration
        ? middleware.configuration(params, token, configuration)
        : configuration(params, token)
    })
  }

  private getConfiguration(
    resource: string | undefined,
    section: string | undefined
  ): any {
    let result: any = null
    if (section) {
      if (this.languageserverSection) {
        section = `${this.languageserverSection}.${section}`
      }
      let index = section.lastIndexOf('.')
      if (index === -1) {
        result = toJSONObject(workspace.getConfiguration(undefined, resource).get(section))
      } else {
        let config = workspace.getConfiguration(section.substr(0, index), resource)
        if (config) {
          result = toJSONObject(config.get(section.substr(index + 1)))
        }
      }
    } else {
      let config = workspace.getConfiguration(this.languageserverSection, resource)
      result = {}
      for (let key of Object.keys(config)) {
        if (config.has(key)) {
          result[key] = toJSONObject(config.get(key))
        }
      }
    }
    return result
  }

  public dispose(): void {
  }
}

export function toJSONObject(obj: any): any {
  if (obj) {
    if (Array.isArray(obj)) {
      return obj.map(toJSONObject)
    } else if (typeof obj === 'object') {
      const res = Object.create(null)
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          res[key] = toJSONObject(obj[key])
        }
      }
      return res
    }
  }
  return obj
}

export interface DidChangeConfigurationSignature {
  (this: void, sections: string[] | undefined): Promise<void>
}

export interface DidChangeConfigurationMiddleware {
  didChangeConfiguration?: (this: void, sections: string[] | undefined, next: DidChangeConfigurationSignature) => void
}

interface DidChangeConfigurationWorkspaceMiddleware {
  workspace?: DidChangeConfigurationMiddleware
}

export class SyncConfigurationFeature implements DynamicFeature<DidChangeConfigurationRegistrationOptions> {
  private _listeners: Map<string, Disposable> = new Map<string, Disposable>()

  constructor(private _client: FeatureClient<DidChangeConfigurationWorkspaceMiddleware, $ConfigurationOptions>) {}

  public getState(): FeatureState {
    return { kind: 'workspace', id: this.registrationType.method, registrations: this._listeners.size > 0 }
  }

  public get registrationType(): RegistrationType<DidChangeConfigurationRegistrationOptions> {
    return DidChangeConfigurationNotification.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'workspace')!, 'didChangeConfiguration')!.dynamicRegistration = true
  }

  public initialize(): void {
    let section = this._client.clientOptions.synchronize?.configurationSection
    if (section !== undefined) {
      this.register({
        id: UUID.generateUuid(),
        registerOptions: {
          section
        }
      })
    }
  }

  public register(
    data: RegistrationData<DidChangeConfigurationRegistrationOptions>
  ): void {
    let { section } = data.registerOptions
    let disposable = workspace.onDidChangeConfiguration(event => {
      this.onDidChangeConfiguration(data.registerOptions.section, event)
    })
    this._listeners.set(data.id, disposable)
    if (section != undefined) {
      this.onDidChangeConfiguration(section, undefined)
    }
  }

  public unregister(id: string): void {
    let disposable = this._listeners.get(id)
    if (disposable) {
      this._listeners.delete(id)
      disposable.dispose()
    }
  }

  public dispose(): void {
    for (let disposable of this._listeners.values()) {
      disposable.dispose()
    }
    this._listeners.clear()
  }

  private onDidChangeConfiguration(configurationSection: string | string[] | undefined, event: ConfigurationChangeEvent | undefined): void {
    let isConfigured = typeof configurationSection === 'string' && configurationSection.startsWith('languageserver.')
    let sections: string[] | undefined
    if (Is.string(configurationSection)) {
      sections = [configurationSection]
    } else {
      sections = configurationSection
    }
    if (sections != null && event != null) {
      let affected = sections.some(section => event.affectsConfiguration(section))
      if (!affected) return
    }
    let didChangeConfiguration = (sections: string[] | undefined): Promise<void> => {
      if (sections == null) {
        return this._client.sendNotification(DidChangeConfigurationNotification.type, { settings: null })
      }
      return this._client.sendNotification(DidChangeConfigurationNotification.type, {
        settings: isConfigured ? this.getConfiguredSettings(sections[0]) : this.extractSettingsInformation(sections)
      })
    }
    let middleware = this._client.middleware.workspace?.didChangeConfiguration
    middleware ? middleware(sections, didChangeConfiguration) : didChangeConfiguration(sections).catch(error => {
      this._client.error(`Sending notification ${DidChangeConfigurationNotification.type.method} failed`, error)
    })
  }

  // for configured languageserver
  private getConfiguredSettings(key: string): any {
    let len = '.settings'.length
    let config = workspace.getConfiguration(key.slice(0, - len))
    return mergeConfigProperties(config.get<any>('settings', {}))
  }

  private extractSettingsInformation(keys: string[]): any {
    function ensurePath(config: any, path: string[]): any {
      let current = config
      for (let i = 0; i < path.length - 1; i++) {
        let obj = current[path[i]]
        if (!obj) {
          obj = Object.create(null)
          current[path[i]] = obj
        }
        current = obj
      }
      return current
    }
    let result = Object.create(null)
    for (let i = 0; i < keys.length; i++) {
      let key = keys[i]
      let index: number = key.indexOf('.')
      let config: any = null
      if (index >= 0) {
        config = workspace.getConfiguration(key.substr(0, index)).get(key.substr(index + 1))
      } else {
        config = workspace.getConfiguration(key)
      }
      if (config) {
        let path = keys[i].split('.')
        ensurePath(result, path)[path[path.length - 1]] = config
      }
    }
    return result
  }
}

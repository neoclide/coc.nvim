/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { ClientCapabilities, ConfigurationRequest } from 'vscode-languageserver-protocol'
import workspace from '../workspace'
import { BaseLanguageClient, StaticFeature } from './client'
const logger = require('../util/logger')('languageclient-configuration')

export interface ConfigurationWorkspaceMiddleware {
  configuration?: ConfigurationRequest.MiddlewareSignature
}

export class ConfigurationFeature implements StaticFeature {
  constructor(private _client: BaseLanguageClient) { }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    capabilities.workspace = capabilities.workspace || {}
    capabilities.workspace!.configuration = true
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
      let middleware = client.clientOptions.middleware!.workspace
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
    let { id } = this._client
    if (section) {
      if (id.startsWith('languageserver')) {
        let config = workspace.getConfiguration(id, resource).get<any>('settings')
        if (config && config[section] != null) return config[section]
      }
      let index = section.lastIndexOf('.')
      if (index === -1) {
        result = workspace.getConfiguration(undefined, resource).get<any>(section, {})
      } else {
        let config = workspace.getConfiguration(section.substr(0, index), resource)
        if (config) {
          result = config.get(section.substr(index + 1))
        }
      }
    } else {
      let config = workspace.getConfiguration(undefined, resource)
      result = {}
      for (let key of Object.keys(config)) {
        if (config.has(key)) {
          result[key] = config.get(key)
        }
      }
    }
    return result
  }
}

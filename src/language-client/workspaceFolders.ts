/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import { CancellationToken, ClientCapabilities, DidChangeWorkspaceFoldersNotification, DidChangeWorkspaceFoldersParams, Disposable, InitializeParams, RPCMessageType, ServerCapabilities, WorkspaceFoldersRequest, WorkspaceFoldersChangeEvent } from 'vscode-languageserver-protocol'
import workspace from '../workspace'
import { BaseLanguageClient, DynamicFeature, NextSignature, RegistrationData } from './client'
import * as UUID from './utils/uuid'
const logger = require('../util/logger')('language-client-workspaceFolder')

function access<T, K extends keyof T>(target: T | undefined, key: K): T[K] | undefined {
  if (target === void 0) {
    return undefined
  }
  return target[key]
}

export interface WorkspaceFolderWorkspaceMiddleware {
  workspaceFolders?: WorkspaceFoldersRequest.MiddlewareSignature
  didChangeWorkspaceFolders?: NextSignature<WorkspaceFoldersChangeEvent, void>
}

export class WorkspaceFoldersFeature implements DynamicFeature<undefined> {

  private _listeners: Map<string, Disposable> = new Map<string, Disposable>()

  constructor(private _client: BaseLanguageClient) {
  }

  public get messages(): RPCMessageType {
    return DidChangeWorkspaceFoldersNotification.type
  }

  public fillInitializeParams(params: InitializeParams): void {
    params.workspaceFolders = workspace.workspaceFolders
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    capabilities.workspace = capabilities.workspace || {}
    capabilities.workspace.workspaceFolders = true
  }

  public initialize(capabilities: ServerCapabilities): void {
    let client = this._client
    client.onRequest(WorkspaceFoldersRequest.type, (token: CancellationToken) => {
      let workspaceFolders: WorkspaceFoldersRequest.HandlerSignature = () => {
        let { workspaceFolders } = workspace
        return workspaceFolders.length ? workspaceFolders : null
      }
      let middleware = client.clientOptions.middleware!.workspace
      return middleware && middleware.workspaceFolders
        ? middleware.workspaceFolders(token, workspaceFolders)
        : workspaceFolders(token)
    })
    let value = access(access(access(capabilities, 'workspace'), 'workspaceFolders'), 'changeNotifications')
    let id: string | undefined
    if (typeof value === 'string') {
      id = value
    } else if (value === true) {
      id = UUID.generateUuid()
    }
    if (id) {
      this.register(this.messages, {
        id,
        registerOptions: undefined
      })
    }
  }

  public register(_message: RPCMessageType, data: RegistrationData<undefined>): void {
    let id = data.id
    let client = this._client
    let disposable = workspace.onDidChangeWorkspaceFolders(event => {
      let didChangeWorkspaceFolders = (event: WorkspaceFoldersChangeEvent) => {
        let params: DidChangeWorkspaceFoldersParams = { event }
        this._client.sendNotification(DidChangeWorkspaceFoldersNotification.type, params)
      }
      let middleware = client.clientOptions.middleware!.workspace
      middleware && middleware.didChangeWorkspaceFolders
        ? middleware.didChangeWorkspaceFolders(event, didChangeWorkspaceFolders)
        : didChangeWorkspaceFolders(event)
    })
    this._listeners.set(id, disposable)
  }

  public unregister(id: string): void {
    let disposable = this._listeners.get(id)
    if (disposable === void 0) {
      return
    }
    this._listeners.delete(id)
    disposable.dispose()
  }

  public dispose(): void {
    for (let disposable of this._listeners.values()) {
      disposable.dispose()
    }
    this._listeners.clear()
  }
}

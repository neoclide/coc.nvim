/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import { CancellationToken, ClientCapabilities, DidChangeWorkspaceFoldersNotification, DidChangeWorkspaceFoldersParams, Disposable, InitializeParams, RPCMessageType, ServerCapabilities, WorkspaceFolder, WorkspaceFoldersRequest } from 'vscode-languageserver-protocol'
import workspace from '../workspace'
import { BaseLanguageClient, DynamicFeature, NextSignature, RegistrationData } from './client'
import * as UUID from './utils/uuid'


function access<T, K extends keyof T>(target: T | undefined, key: K): T[K] | undefined {
  if (target === void 0) {
    return undefined
  }
  return target[key]
}

export interface WorkspaceFolderWorkspaceMiddleware {
  workspaceFolders?: WorkspaceFoldersRequest.MiddlewareSignature
  didChangeWorkspaceFolders?: NextSignature<WorkspaceFolder, void>
}

export class WorkspaceFoldersFeature implements DynamicFeature<undefined> {

  private _listeners: Map<string, Disposable> = new Map<string, Disposable>()
  private folders: WorkspaceFolder[] = []

  constructor(private _client: BaseLanguageClient) {
    let folder = workspace.workspaceFolder
    if (folder) this.folders.push(folder)
    workspace.onDidChangeWorkspaceFolder(folder => {
      if (!this.exists(folder)) {
        this.folders.push(folder)
      }
    })
  }

  private exists(folder: WorkspaceFolder): boolean {
    return this.folders.findIndex(o => o.uri == folder.uri) != -1
  }

  public get messages(): RPCMessageType {
    return DidChangeWorkspaceFoldersNotification.type
  }

  public fillInitializeParams(params: InitializeParams): void {
    let folder = workspace.workspaceFolder

    if (folder == null) {
      params.workspaceFolders = null
    } else {
      params.workspaceFolders = [folder]
    }
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    capabilities.workspace = capabilities.workspace || {}
    capabilities.workspace.workspaceFolders = true
  }

  public initialize(capabilities: ServerCapabilities): void {
    let client = this._client
    client.onRequest(WorkspaceFoldersRequest.type, (token: CancellationToken) => {
      let workspaceFolders: WorkspaceFoldersRequest.HandlerSignature = () => {
        let { folders } = this
        if (folders.length == 0) {
          return null
        }
        return folders
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
        id: id,
        registerOptions: undefined
      })
    }
  }

  public register(_message: RPCMessageType, data: RegistrationData<undefined>): void {
    let id = data.id
    let client = this._client
    let disposable = workspace.onDidChangeWorkspaceFolder(event => {
      if (this.exists(event)) return
      let didChangeWorkspaceFolders = (event: WorkspaceFolder) => {
        let params: DidChangeWorkspaceFoldersParams = {
          event: {
            added: [event],
            removed: []
          }
        }
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


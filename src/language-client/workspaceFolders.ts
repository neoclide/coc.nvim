'use strict'
import type { CancellationToken, ClientCapabilities, DidChangeWorkspaceFoldersParams, Disposable, InitializeParams, RegistrationType, ServerCapabilities, WorkspaceFolder, WorkspaceFoldersChangeEvent } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { defaultValue } from '../util'
import { isFalsyOrEmpty } from '../util/array'
import { sameFile } from '../util/fs'
import { DidChangeWorkspaceFoldersNotification, WorkspaceFoldersRequest } from '../util/protocol'
import workspace from '../workspace'
import { DynamicFeature, FeatureClient, FeatureState, NextSignature, RegistrationData } from './features'
import * as UUID from './utils/uuid'

function access<T, K extends keyof T>(target: T | undefined, key: K): T[K] | undefined {
  if (target === void 0) {
    return undefined
  }
  return target[key]
}

function arrayDiff<T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>): T[] {
  return left.filter(element => !right.includes(element))
}

export interface WorkspaceFolderMiddleware {
  workspaceFolders?: WorkspaceFoldersRequest.MiddlewareSignature
  didChangeWorkspaceFolders?: NextSignature<WorkspaceFoldersChangeEvent, Promise<void>>
}

interface WorkspaceFolderWorkspaceMiddleware {
  workspace?: WorkspaceFolderMiddleware
}

export interface $WorkspaceOptions {
  ignoredRootPaths?: string[]
}

export class WorkspaceFoldersFeature implements DynamicFeature<void> {

  private _listeners: Map<string, Disposable> = new Map<string, Disposable>()
  private _initialFolders: ReadonlyArray<WorkspaceFolder> | undefined

  constructor(private _client: FeatureClient<WorkspaceFolderWorkspaceMiddleware, $WorkspaceOptions>) {
  }

  public getState(): FeatureState {
    return { kind: 'workspace', id: this.registrationType.method, registrations: this._listeners.size > 0 }
  }

  public get registrationType(): RegistrationType<void> {
    return DidChangeWorkspaceFoldersNotification.type
  }

  public getValidWorkspaceFolders(): WorkspaceFolder[] | undefined {
    let { workspaceFolders } = workspace
    let ignoredRootPaths = this._client.clientOptions.ignoredRootPaths
    let arr = isFalsyOrEmpty(ignoredRootPaths) ? workspaceFolders.slice(0) : workspaceFolders.filter(o => {
      let fsPath = URI.parse(o.uri).fsPath
      return ignoredRootPaths.every(p => !sameFile(p, fsPath))
    })
    return arr.length > 0 ? arr : undefined
  }

  public fillInitializeParams(params: InitializeParams): void {
    const folders = this.getValidWorkspaceFolders()
    this.initializeWithFolders(folders)
    if (folders == null) {
      params.workspaceFolders = null
    } else {
      params.workspaceFolders = folders.map(folder => this.asProtocol(folder))
    }
  }

  protected initializeWithFolders(currentWorkspaceFolders: ReadonlyArray<WorkspaceFolder> | undefined) {
    this._initialFolders = currentWorkspaceFolders
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    capabilities.workspace = defaultValue(capabilities.workspace, {})
    capabilities.workspace.workspaceFolders = true
  }

  public initialize(capabilities: ServerCapabilities): void {
    let client = this._client
    client.onRequest(WorkspaceFoldersRequest.type, (token: CancellationToken) => {
      let workspaceFolders: WorkspaceFoldersRequest.HandlerSignature = () => {
        let folders = this.getValidWorkspaceFolders()
        if (folders == null) {
          return null
        }
        return folders.map(folder => this.asProtocol(folder))
      }
      const middleware = client.middleware.workspace
      return middleware && middleware.workspaceFolders
        ? middleware.workspaceFolders(token, workspaceFolders)
        : workspaceFolders(token)
    })
    const value = access(access(access(capabilities, 'workspace'), 'workspaceFolders'), 'changeNotifications')
    let id: string | undefined
    if (typeof value === 'string') {
      id = value
    } else if (value) {
      id = UUID.generateUuid()
    }
    if (id) {
      this.register({ id, registerOptions: undefined })
    }
  }

  protected sendInitialEvent(currentWorkspaceFolders: ReadonlyArray<WorkspaceFolder> | undefined): void {
    let promise: Promise<void> | undefined
    if (this._initialFolders && currentWorkspaceFolders) {
      const removed: WorkspaceFolder[] = arrayDiff(this._initialFolders, currentWorkspaceFolders)
      const added: WorkspaceFolder[] = arrayDiff(currentWorkspaceFolders, this._initialFolders)
      if (added.length > 0 || removed.length > 0) {
        promise = this.doSendEvent(added, removed)
      }
    } else if (this._initialFolders) {
      promise = this.doSendEvent([], this._initialFolders)
    } else if (currentWorkspaceFolders) {
      promise = this.doSendEvent(currentWorkspaceFolders, [])
    }
    if (promise) {
      promise.catch(this.onNotificationError.bind(this))
    }
  }

  private onNotificationError(error: any): void {
    this._client.error(`Sending notification ${DidChangeWorkspaceFoldersNotification.type.method} failed`, error)
  }

  private doSendEvent(addedFolders: ReadonlyArray<WorkspaceFolder>, removedFolders: ReadonlyArray<WorkspaceFolder>): Promise<void> {
    let params: DidChangeWorkspaceFoldersParams = {
      event: {
        added: addedFolders.map(folder => this.asProtocol(folder)),
        removed: removedFolders.map(folder => this.asProtocol(folder))
      }
    }
    return this._client.sendNotification(DidChangeWorkspaceFoldersNotification.type, params)
  }

  public register(data: RegistrationData<undefined>): void {
    let id = data.id
    let client = this._client
    if (this._listeners.size == 0) {
      let disposable = workspace.onDidChangeWorkspaceFolders(event => {
        let didChangeWorkspaceFolders = (e: WorkspaceFoldersChangeEvent): Promise<void> => {
          return this.doSendEvent(e.added, e.removed)
        }
        let middleware = client.middleware.workspace
        const promise = middleware && middleware.didChangeWorkspaceFolders
          ? middleware.didChangeWorkspaceFolders(event, didChangeWorkspaceFolders)
          : didChangeWorkspaceFolders(event)
        if (promise) {
          promise.catch(this.onNotificationError.bind(this))
        }
      })
      this._listeners.set(id, disposable)
      let workspaceFolders = this.getValidWorkspaceFolders()
      this.sendInitialEvent(workspaceFolders)
    }
  }

  public unregister(id: string): void {
    const disposable = this._listeners.get(id)
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

  private asProtocol(workspaceFolder: WorkspaceFolder): WorkspaceFolder {
    return { uri: this._client.code2ProtocolConverter.asUri(URI.parse(workspaceFolder.uri)), name: workspaceFolder.name }
  }
}

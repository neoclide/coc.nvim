'use strict'
import type { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, RegistrationType, ServerCapabilities, SymbolInformation, WorkspaceSymbol, WorkspaceSymbolRegistrationOptions } from "vscode-languageserver-protocol"
import languages from "../languages"
import { ProviderResult, WorkspaceSymbolProvider } from "../provider"
import { WorkspaceSymbolRequest, WorkspaceSymbolResolveRequest } from '../util/protocol'
import { SupportedSymbolKinds, SupportedSymbolTags } from './documentSymbol'
import { BaseFeature, DynamicFeature, ensure, FeatureClient, FeatureState, RegistrationData } from './features'
import * as UUID from './utils/uuid'

export interface ProvideWorkspaceSymbolsSignature {
  (this: void, query: string, token: CancellationToken): ProviderResult<SymbolInformation[]>
}

export interface ResolveWorkspaceSymbolSignature {
  (this: void, item: WorkspaceSymbol, token: CancellationToken): ProviderResult<SymbolInformation>
}

export interface WorkspaceSymbolMiddleware {
  provideWorkspaceSymbols?: (this: void, query: string, token: CancellationToken, next: ProvideWorkspaceSymbolsSignature) => ProviderResult<SymbolInformation[]>
  resolveWorkspaceSymbol?: (this: void, item: WorkspaceSymbol, token: CancellationToken, next: ResolveWorkspaceSymbolSignature) => ProviderResult<WorkspaceSymbol>
}

interface WorkspaceFeatureRegistration<PR> {
  disposable: Disposable
  provider: PR
}

export interface WorkspaceProviderFeature<PR> {
  getProviders(): PR[] | undefined
}

abstract class WorkspaceFeature<RO, PR, M> extends BaseFeature<M, object> implements DynamicFeature<RO> {
  protected _registrations: Map<string, WorkspaceFeatureRegistration<PR>> = new Map()

  constructor(_client: FeatureClient<M>, private _registrationType: RegistrationType<RO>) {
    super(_client)
  }

  public getState(): FeatureState {
    const registrations = this._registrations.size > 0
    return { kind: 'workspace', id: this._registrationType.method, registrations }
  }

  public get registrationType(): RegistrationType<RO> {
    return this._registrationType
  }

  public abstract fillClientCapabilities(capabilities: ClientCapabilities): void

  public abstract initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector | undefined): void

  public register(data: RegistrationData<RO>): void {
    const registration = this.registerLanguageProvider(data.registerOptions)
    this._registrations.set(data.id, { disposable: registration[0], provider: registration[1] })
  }

  protected abstract registerLanguageProvider(options: RO): [Disposable, PR]

  public unregister(id: string): void {
    const registration = this._registrations.get(id)
    if (registration) registration.disposable.dispose()
  }

  public dispose(): void {
    this._registrations.forEach(value => {
      value.disposable.dispose()
    })
    this._registrations.clear()
  }

  public getProviders(): PR[] {
    const result: PR[] = []
    for (const registration of this._registrations.values()) {
      result.push(registration.provider)
    }
    return result
  }
}

export class WorkspaceSymbolFeature extends WorkspaceFeature<WorkspaceSymbolRegistrationOptions, WorkspaceSymbolProvider, WorkspaceSymbolMiddleware> {
  constructor(client: FeatureClient<WorkspaceSymbolMiddleware>) {
    super(client, WorkspaceSymbolRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let symbolCapabilities = ensure(ensure(capabilities, 'workspace')!, 'symbol')!
    symbolCapabilities.dynamicRegistration = true
    symbolCapabilities.symbolKind = {
      valueSet: SupportedSymbolKinds
    }
    symbolCapabilities.tagSupport = {
      valueSet: SupportedSymbolTags
    }
    symbolCapabilities.resolveSupport = { properties: ['location.range'] }
  }

  public initialize(capabilities: ServerCapabilities): void {
    if (!capabilities.workspaceSymbolProvider) {
      return
    }
    this.register({
      id: UUID.generateUuid(),
      registerOptions: capabilities.workspaceSymbolProvider === true ? { workDoneProgress: false } : capabilities.workspaceSymbolProvider
    })
  }

  protected registerLanguageProvider(options: WorkspaceSymbolRegistrationOptions): [Disposable, WorkspaceSymbolProvider] {
    const provider: WorkspaceSymbolProvider = {
      provideWorkspaceSymbols: (query, token) => {
        const client = this._client
        const provideWorkspaceSymbols: ProvideWorkspaceSymbolsSignature = (query, token) => {
          return this.sendRequest(WorkspaceSymbolRequest.type, { query }, token) as any
        }
        const middleware = client.middleware!
        return middleware.provideWorkspaceSymbols
          ? middleware.provideWorkspaceSymbols(query, token, provideWorkspaceSymbols)
          : provideWorkspaceSymbols(query, token)
      },
      resolveWorkspaceSymbol: options.resolveProvider === true
        ? (item, token) => {
          const client = this._client
          const resolveWorkspaceSymbol: ResolveWorkspaceSymbolSignature = (item, token) => {
            return this.sendRequest(WorkspaceSymbolResolveRequest.type, item, token) as any
          }
          const middleware = client.middleware!
          return middleware.resolveWorkspaceSymbol
            ? middleware.resolveWorkspaceSymbol(item, token, resolveWorkspaceSymbol)
            : resolveWorkspaceSymbol(item, token)
        }
        : undefined
    }
    return [languages.registerWorkspaceSymbolProvider(provider), provider]
  }
}

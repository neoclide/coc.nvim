import { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, RegistrationType, ServerCapabilities, SymbolInformation, WorkspaceSymbolRegistrationOptions, WorkspaceSymbolRequest, WorkspaceSymbolResolveRequest } from "vscode-languageserver-protocol"
import languages from "../languages"
import { ProviderResult, WorkspaceSymbolProvider } from "../provider"
import { BaseLanguageClient, DynamicFeature, ensure, Middleware, RegistrationData, SupportedSymbolKinds, SupportedSymbolTags } from "./client"
import * as UUID from './utils/uuid'

export interface ProvideWorkspaceSymbolsSignature {
  (this: void, query: string, token: CancellationToken): ProviderResult<SymbolInformation[]>
}

export interface ResolveWorkspaceSymbolSignature {
  (this: void, item: SymbolInformation, token: CancellationToken): ProviderResult<SymbolInformation>
}

export interface WorkspaceSymbolMiddleware {
  provideWorkspaceSymbols?: (this: void, query: string, token: CancellationToken, next: ProvideWorkspaceSymbolsSignature) => ProviderResult<SymbolInformation[]>
  resolveWorkspaceSymbol?: (this: void, item: SymbolInformation, token: CancellationToken, next: ResolveWorkspaceSymbolSignature) => ProviderResult<SymbolInformation>
}

interface WorkspaceFeatureRegistration<PR> {
  disposable: Disposable
  provider: PR
}

abstract class WorkspaceFeature<RO, PR> implements DynamicFeature<RO> {
  protected _registrations: Map<string, WorkspaceFeatureRegistration<PR>> = new Map()

  constructor(protected _client: BaseLanguageClient, private _registrationType: RegistrationType<RO>) {}

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

export class WorkspaceSymbolFeature extends WorkspaceFeature<WorkspaceSymbolRegistrationOptions, WorkspaceSymbolProvider> {
  constructor(client: BaseLanguageClient) {
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
          return client.sendRequest(WorkspaceSymbolRequest.type, { query }, token).then(
            res => token.isCancellationRequested ? null : res,
            error => {
              return client.handleFailedRequest(WorkspaceSymbolRequest.type, token, error, null)
            })
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideWorkspaceSymbols
          ? middleware.provideWorkspaceSymbols(query, token, provideWorkspaceSymbols)
          : provideWorkspaceSymbols(query, token)
      },
      resolveWorkspaceSymbol: options.resolveProvider === true
        ? (item, token) => {
          const client = this._client
          const resolveWorkspaceSymbol: ResolveWorkspaceSymbolSignature = (item, token) => {
            return client.sendRequest(WorkspaceSymbolResolveRequest.type, item, token).then(
              result => token.isCancellationRequested ? null : result,
              error => {
                return client.handleFailedRequest(WorkspaceSymbolResolveRequest.type, token, error, null)
              })
          }
          const middleware = client.clientOptions.middleware!
          return middleware.resolveWorkspaceSymbol
            ? middleware.resolveWorkspaceSymbol(item, token, resolveWorkspaceSymbol)
            : resolveWorkspaceSymbol(item, token)
        }
        : undefined
    }
    return [languages.registerWorkspaceSymbolProvider(provider), provider]
  }
}


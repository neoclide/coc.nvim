import { CancellationToken, Disposable, Emitter, StaticRegistrationOptions, TextDocumentContentRefreshRequest, TextDocumentContentRequest, type ClientCapabilities, type RegistrationType, type ServerCapabilities, type TextDocumentContentParams, type TextDocumentContentRegistrationOptions } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { ProviderResult, TextDocumentContentProvider } from '../provider'
import workspace from '../workspace'
import { ensure, type DynamicFeature, type FeatureClient, type FeatureState, type RegistrationData } from './features'
import * as UUID from './utils/uuid'

export interface ProvideTextDocumentContentSignature {
  (this: void, uri: URI, token: CancellationToken): ProviderResult<string>
}

export interface TextDocumentContentMiddleware {
  provideTextDocumentContent?: (this: void, uri: URI, token: CancellationToken, next: ProvideTextDocumentContentSignature) => ProviderResult<string>
}

export interface TextDocumentContentProviderShape {
  scheme: string
  onDidChangeEmitter: Emitter<URI>
  provider: TextDocumentContentProvider
}

export class TextDocumentContentFeature implements DynamicFeature<TextDocumentContentRegistrationOptions> {

  private readonly _client: FeatureClient<TextDocumentContentMiddleware>
  private readonly _registrations: Map<string, { disposable: Disposable; providers: TextDocumentContentProviderShape[] }> = new Map()

  constructor(client: FeatureClient<TextDocumentContentMiddleware>) {
    this._client = client
  }

  public getState(): FeatureState {
    const registrations = this._registrations.size > 0
    return { kind: 'workspace', id: TextDocumentContentRequest.method, registrations }
  }

  public get registrationType(): RegistrationType<TextDocumentContentRegistrationOptions> {
    return TextDocumentContentRequest.type
  }

  public getProviders(): TextDocumentContentProviderShape[] {
    const result: TextDocumentContentProviderShape[] = []
    for (const registration of this._registrations.values()) {
      result.push(...registration.providers)
    }
    return result
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    const textDocumentContent = ensure(ensure(capabilities, 'workspace')!, 'textDocumentContent')!
    textDocumentContent.dynamicRegistration = true
  }

  public initialize(capabilities: ServerCapabilities): void {
    const client = this._client
    client.onRequest(TextDocumentContentRefreshRequest.type, async params => {
      const uri = URI.parse(params.uri)
      for (const registrations of this._registrations.values()) {
        for (const provider of registrations.providers) {
          if (provider.scheme !== uri.scheme) {
            provider.onDidChangeEmitter.fire(uri)
          }
        }
      }
    })

    if (!capabilities?.workspace?.textDocumentContent) {
      return
    }
    const capability = capabilities.workspace.textDocumentContent
    const id = StaticRegistrationOptions.hasId(capability) ? capability.id : UUID.generateUuid()
    this.register({
      id,
      registerOptions: capability
    })
  }

  public register(data: RegistrationData<TextDocumentContentRegistrationOptions>): void {
    const registrations: TextDocumentContentProviderShape[] = []
    for (const scheme of data.registerOptions.schemes) {
      const [disposable, registration] = this.registerTextDocumentContentProvider(scheme)
      registrations.push(registration)
      this._registrations.set(data.id, { disposable, providers: registrations })
    }
  }

  private registerTextDocumentContentProvider(scheme: string): [Disposable, TextDocumentContentProviderShape] {
    const eventEmitter: Emitter<URI> = new Emitter<URI>()
    const provider: TextDocumentContentProvider = {
      onDidChange: eventEmitter.event,
      provideTextDocumentContent: (uri, token) => {
        const client = this._client
        const provideTextDocumentContent: ProvideTextDocumentContentSignature = (uri, token) => {
          const params: TextDocumentContentParams = {
            uri: uri.toString()
          }
          return client.sendRequest(TextDocumentContentRequest.type, params, token).then(result => {
            if (token.isCancellationRequested) {
              return null
            }
            return result.text
          }, error => {
            return client.handleFailedRequest(TextDocumentContentRequest.type, token, error, null)
          })
        }
        const middleware = client.middleware
        return middleware.provideTextDocumentContent
          ? middleware.provideTextDocumentContent(uri, token, provideTextDocumentContent)
          : provideTextDocumentContent(uri, token)
      }
    }
    return [workspace.registerTextDocumentContentProvider(scheme, provider), { scheme, onDidChangeEmitter: eventEmitter, provider }]
  }

  public unregister(id: string): void {
    const registration = this._registrations.get(id)
    if (registration !== undefined) {
      this._registrations.delete(id)
      registration.disposable.dispose()
    }
  }

  public dispose(): void {
    this._registrations.forEach(value => {
      value.disposable.dispose()
    })
    this._registrations.clear()
  }

  public clear(): void {
    this._registrations.forEach(registration => {
      registration.disposable.dispose()
    })
    this._registrations.clear()
  }
}

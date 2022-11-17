'use strict'
import type { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, RenameOptions, RenameParams, RenameRegistrationOptions, ServerCapabilities, TextDocumentPositionParams, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from "vscode-languageserver-textdocument"
import { Position, Range } from 'vscode-languageserver-types'
import languages from '../languages'
import { ProviderResult, RenameProvider } from '../provider'
import * as Is from '../util/is'
import { PrepareRenameRequest, PrepareSupportDefaultBehavior, RenameRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'
import * as UUID from './utils/uuid'

interface DefaultBehavior {
  defaultBehavior: boolean
}

export interface PrepareRenameSignature {
  (this: void, document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Range | { range: Range, placeholder: string }>
}

export interface ProvideRenameEditsSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    newName: string,
    token: CancellationToken
  ): ProviderResult<WorkspaceEdit>
}

export interface RenameMiddleware {
  prepareRename?: (
    this: void, document: TextDocument,
    position: Position,
    token: CancellationToken,
    next: PrepareRenameSignature
  ) => ProviderResult<Range | { range: Range, placeholder: string }>
  provideRenameEdits?: (
    this: void,
    document: TextDocument,
    position: Position,
    newName: string,
    token: CancellationToken,
    next: ProvideRenameEditsSignature
  ) => ProviderResult<WorkspaceEdit>
}

export class RenameFeature extends TextDocumentLanguageFeature<boolean | RenameOptions, RenameRegistrationOptions, RenameProvider, RenameMiddleware> {
  constructor(client: FeatureClient<RenameMiddleware>) {
    super(client, RenameRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let rename = ensure(ensure(capabilities, 'textDocument')!, 'rename')!
    rename.dynamicRegistration = true
    rename.prepareSupport = true
    rename.honorsChangeAnnotations = true
    rename.prepareSupportDefaultBehavior = PrepareSupportDefaultBehavior.Identifier
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.renameProvider)
    if (!options) {
      return
    }
    if (Is.boolean(capabilities.renameProvider)) {
      options.prepareProvider = false
    }
    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(options: RenameRegistrationOptions): [Disposable, RenameProvider] {
    const provider: RenameProvider = {
      provideRenameEdits: (document, position, newName, token) => {
        const client = this._client
        const provideRenameEdits: ProvideRenameEditsSignature = (document, position, newName, token) => {
          const params: RenameParams = {
            textDocument: { uri: document.uri },
            position,
            newName
          }
          return this.sendRequest(RenameRequest.type, params, token)
        }
        const middleware = client.middleware!
        return middleware.provideRenameEdits
          ? middleware.provideRenameEdits(document, position, newName, token, provideRenameEdits)
          : provideRenameEdits(document, position, newName, token)
      },
      prepareRename: options.prepareProvider
        ? (document, position, token) => {
          const client = this._client
          const prepareRename: PrepareRenameSignature = (document, position, token) => {
            const params: TextDocumentPositionParams = {
              textDocument: cv.asTextDocumentIdentifier(document),
              position
            }
            return this.sendRequest(PrepareRenameRequest.type, params, token).then(result => {
              if (!result) return null

              if (Range.is(result)) {
                return result
              } else if (this.isDefaultBehavior(result)) {
                return result.defaultBehavior === true ? null : Promise.reject(new Error(`The element can't be renamed.`))
              } else if (result && Range.is(result.range)) {
                return {
                  range: result.range,
                  placeholder: result.placeholder
                }
              }
            })
          }
          const middleware = client.middleware!
          return middleware.prepareRename
            ? middleware.prepareRename(document, position, token, prepareRename)
            : prepareRename(document, position, token)
        }
        : undefined
    }

    return [languages.registerRenameProvider(options.documentSelector, provider), provider]
  }

  private isDefaultBehavior(value: any): value is DefaultBehavior {
    const candidate: DefaultBehavior = value
    return candidate && Is.boolean(candidate.defaultBehavior)
  }
}

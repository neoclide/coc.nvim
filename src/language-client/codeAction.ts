'use strict'
import type { CancellationToken, ClientCapabilities, CodeAction, CodeActionContext, CodeActionOptions, CodeActionParams, CodeActionRegistrationOptions, Disposable, DocumentSelector, ExecuteCommandParams, Range, ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from "vscode-languageserver-textdocument"
import { CodeActionKind, Command } from 'vscode-languageserver-types'
import commands from '../commands'
import languages from '../languages'
import { CodeActionProvider, ProviderResult } from '../provider'
import { CodeActionRequest, CodeActionResolveRequest, ExecuteCommandRequest } from '../util/protocol'
import { ExecuteCommandMiddleware, ExecuteCommandSignature } from './executeCommand'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as UUID from './utils/uuid'

export interface ProvideCodeActionsSignature {
  (
    this: void,
    document: TextDocument,
    range: Range,
    context: CodeActionContext,
    token: CancellationToken
  ): ProviderResult<(Command | CodeAction)[]>
}

export interface ResolveCodeActionSignature {
  (this: void, item: CodeAction, token: CancellationToken): ProviderResult<CodeAction>
}

export interface CodeActionMiddleware {
  provideCodeActions?: (
    this: void,
    document: TextDocument,
    range: Range,
    context: CodeActionContext,
    token: CancellationToken,
    next: ProvideCodeActionsSignature
  ) => ProviderResult<(Command | CodeAction)[]>
  resolveCodeAction?: (
    this: void,
    item: CodeAction,
    token: CancellationToken,
    next: ResolveCodeActionSignature
  ) => ProviderResult<CodeAction>
}

export class CodeActionFeature extends TextDocumentLanguageFeature<boolean | CodeActionOptions, CodeActionRegistrationOptions, CodeActionProvider, CodeActionMiddleware & ExecuteCommandMiddleware> {
  private disposables: Disposable[] = []
  constructor(client: FeatureClient<CodeActionMiddleware>) {
    super(client, CodeActionRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    const cap = ensure(ensure(capabilities, 'textDocument')!, 'codeAction')!
    cap.dynamicRegistration = true
    cap.isPreferredSupport = true
    cap.disabledSupport = true
    cap.dataSupport = true
    cap.honorsChangeAnnotations = false
    cap.resolveSupport = {
      properties: ['edit']
    }
    cap.codeActionLiteralSupport = {
      codeActionKind: {
        valueSet: [
          CodeActionKind.Empty,
          CodeActionKind.QuickFix,
          CodeActionKind.Refactor,
          CodeActionKind.RefactorExtract,
          CodeActionKind.RefactorInline,
          CodeActionKind.RefactorRewrite,
          CodeActionKind.Source,
          CodeActionKind.SourceOrganizeImports
        ]
      }
    }
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.codeActionProvider)
    if (!options) {
      return
    }

    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: CodeActionRegistrationOptions
  ): [Disposable, CodeActionProvider] {
    const registerCommand = (id: string) => {
      const client = this._client
      const executeCommand: ExecuteCommandSignature = (command: string, args: any[]): any => {
        const params: ExecuteCommandParams = {
          command,
          arguments: args
        }
        return client.sendRequest(ExecuteCommandRequest.type, params)
      }
      const middleware = client.middleware!
      this.disposables.push(commands.registerCommand(id, (...args: any[]) => {
        return middleware.executeCommand
          ? middleware.executeCommand(id, args, executeCommand)
          : executeCommand(id, args)
      }, null, true))
    }
    const provider: CodeActionProvider = {
      provideCodeActions: (document, range, context, token) => {
        const client = this._client
        const _provideCodeActions: ProvideCodeActionsSignature = (document, range, context, token) => {
          const params: CodeActionParams = {
            textDocument: {
              uri: document.uri
            },
            range,
            context,
          }
          return this.sendRequest(CodeActionRequest.type, params, token).then(
            values => {
              if (!values) return undefined
              // some server may not registered commands to client.
              values.forEach(val => {
                let cmd = Command.is(val) ? val.command : val.command?.command
                if (cmd && !commands.has(cmd)) registerCommand(cmd)
              })
              return values
            }
          )
        }
        const middleware = client.middleware!
        return middleware.provideCodeActions
          ? middleware.provideCodeActions(document, range, context, token, _provideCodeActions)
          : _provideCodeActions(document, range, context, token)
      },
      resolveCodeAction: options.resolveProvider
        ? (item: CodeAction, token: CancellationToken) => {
          const middleware = this._client.middleware!
          const resolveCodeAction: ResolveCodeActionSignature = (item, token) => {
            return this.sendRequest(CodeActionResolveRequest.type, item, token, item)
          }
          return middleware.resolveCodeAction
            ? middleware.resolveCodeAction(item, token, resolveCodeAction)
            : resolveCodeAction(item, token)
        }
        : undefined
    }
    return [languages.registerCodeActionProvider(options.documentSelector, provider, this._client.id, options.codeActionKinds), provider]
  }

  public dispose(): void {
    this.disposables.forEach(o => {
      o.dispose()
    })
    this.disposables = []
    super.dispose()
  }
}

/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import fs from 'fs'
import path from 'path'
import { CodeAction, CodeActionContext, Command, Diagnostic, DidCloseTextDocumentNotification, DidOpenTextDocumentNotification, ExecuteCommandParams, ExecuteCommandRequest, NotificationType, RequestType, TextDocument, TextDocumentIdentifier, VersionedTextDocumentIdentifier } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import commandManager from '../../commands'
import { LanguageService } from '../../language-client'
import { ErrorAction, ErrorHandler, LanguageClientOptions, WorkspaceMiddleware } from '../../language-client/main'
import { ProviderResult } from '../../provider'
import { ServiceStat } from '../../types'
import { echoErr, echoWarning } from '../../util'
import workspace from '../../workspace'
import { findEslint } from './utils'
const logger = require('../../util/logger')('eslint')
const defaultLanguages = ['javascript', 'javascript.jsx']

namespace Is {
  const toString = Object.prototype.toString

  export function boolean(value: any): value is boolean {
    return value === true || value === false
  }

  export function string(value: any): value is string {
    return toString.call(value) === '[object String]'
  }
}

interface DirectoryItem {
  directory: string
  changeProcessCWD?: boolean
}

namespace DirectoryItem {
  export function is(item: any): item is DirectoryItem {
    let candidate = item as DirectoryItem
    return (
      candidate &&
      Is.string(candidate.directory) &&
      (Is.boolean(candidate.changeProcessCWD) ||
        candidate.changeProcessCWD === void 0)
    )
  }
}

type RunValues = 'onType' | 'onSave'

interface TextDocumentSettings {
  packageManager: 'npm' | 'yarn'
  autoFix: boolean
  autoFixOnSave: boolean
  options: any | undefined
  run: RunValues
  nodePath?: string
  workingDirectory: DirectoryItem
}

interface NoConfigParams {
  message: string
  document: TextDocumentIdentifier
}

interface NoConfigResult { }

namespace NoConfigRequest {
  export const type = new RequestType<
    NoConfigParams,
    NoConfigResult,
    void,
    void
    >('eslint/noConfig')
}

interface NoESLintLibraryParams {
  source: TextDocumentIdentifier
}

interface NoESLintLibraryResult { }

namespace NoESLintLibraryRequest {
  export const type = new RequestType<
    NoESLintLibraryParams,
    NoESLintLibraryResult,
    void,
    void
    >('eslint/noLibrary')
}

const exitCalled = new NotificationType<[number, string], void>('eslint/exitCalled')

async function createDefaultConfiguration(): Promise<void> {
  let { root } = workspace
  let configFiles = [
    '.eslintrc.js',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    '.eslintrc',
    '.eslintrc.json'
  ]
  for (let configFile of configFiles) {
    if (fs.existsSync(path.join(root, configFile))) {
      workspace.openResource(Uri.file(root).toString()).catch(_e => {
        // noop
      })
      return
    }
  }
  const eslintCommand = await findEslint(root)
  await workspace.nvim.call('coc#util#open_terminal', [eslintCommand + ' --init', root])
}

function shouldBeValidated(textDocument: TextDocument): boolean {
  let config = workspace.getConfiguration('eslint', textDocument.uri)
  if (!config.get('enable', true)) return false
  let filetypes = config.get<(string)[]>('filetypes', defaultLanguages)
  return filetypes.indexOf(textDocument.languageId) !== -1
}

export default class EslintService extends LanguageService {
  private syncedDocuments: Map<string, TextDocument>
  private defaultErrorHandler: ErrorHandler

  constructor() {
    const config = workspace.getConfiguration().get('eslint') as any
    super('eslint', 'Eslint Language Server', {
      module: path.join(__dirname, 'server/index.js'),
      args: ['--node-ipc'],
      execArgv: config.execArgv,
      filetypes: config.filetypes || defaultLanguages,
      enable: config.enable !== false
    }, 'tslint')
    this.syncedDocuments = new Map()
    this.onServiceReady(() => {
      let {client} = this
      client.onNotification(exitCalled, params => {
        this.client.error(
          `Server process exited with code ${params[0]}. This usually indicates a misconfigured ESLint setup.`,
          params[1]
        )
        echoErr(workspace.nvim, `ESLint server shut down itself.`)
      })
      client.onRequest(NoConfigRequest.type, params => {
        let document = Uri.parse(params.document.uri)
        let fileLocation = document.fsPath
        echoWarning(workspace.nvim, `No ESLint configuration (e.g .eslintrc) found for file: ${fileLocation}`)
        return {}
      })
      client.onRequest(NoESLintLibraryRequest.type, params => {
        let uri: Uri = Uri.parse(params.source.uri)
        echoWarning(workspace.nvim, `Failed to load the ESLint library for the document ${ uri.fsPath }`)
        return {}
      })

      this.disposables.push(
        commandManager.registerCommand('eslint.createConfig', createDefaultConfiguration),
      )
      this.defaultErrorHandler = this.client.createDefaultErrorHandler()
      workspace.onDidChangeConfiguration(this.onDidChangeConfiguration)

      commandManager.registerCommand('eslint.executeAutofix', async () => {
        let document = await workspace.document
        let textDocument: VersionedTextDocumentIdentifier = {
          uri: document.uri,
          version: document.version
        }
        let params: ExecuteCommandParams = {
          command: '_eslint.applyAutoFix',
          arguments: [textDocument]
        }
        client.sendRequest(ExecuteCommandRequest.type, params)
          .then(undefined, () => {
            echoErr(workspace.nvim, 'Failed to apply ESLint fixes to the document.')
          })
      })
    })
  }

  private onDidChangeConfiguration() :void{
    let {syncedDocuments, state} = this
    if (state != ServiceStat.Running) return
    for (let textDocument of syncedDocuments.values()) {
      if (!shouldBeValidated(textDocument)) {
        syncedDocuments.delete(textDocument.uri)
        this.client.sendNotification(
          DidCloseTextDocumentNotification.type,
          { textDocument: { uri: textDocument.uri } }
        )
      }
    }
    for (let textDocument of workspace.textDocuments) {
      if (!syncedDocuments.has(textDocument.uri.toString()) && shouldBeValidated(textDocument)) {
        this.client.sendNotification(
          DidOpenTextDocumentNotification.type,
          {
            textDocument: {
              uri: textDocument.uri,
              languageId: textDocument.languageId,
              version: textDocument.version,
              text: textDocument.getText()
            }
          })
        syncedDocuments.set(textDocument.uri.toString(), textDocument)
      }
    }
  }

  protected resolveClientOptions(clientOptions: LanguageClientOptions): LanguageClientOptions {
    let {syncedDocuments} = this
    Object.assign(clientOptions, {
      synchronize: {
        configurationSection: 'eslint',
        fileEvents: [
          workspace.createFileSystemWatcher(
            '**/.eslintr{c.js,c.yaml,c.yml,c,c.json}'
          ),
          workspace.createFileSystemWatcher('**/.eslintignore'),
          workspace.createFileSystemWatcher('**/package.json')
        ]
      },
      diagnosticCollectionName: 'eslint',
      initializationFailedHandler: error => {
        logger.error('eslint initialization failed.', error)
        echoErr(workspace.nvim, 'Server initialization failed.')
        return false
      },
      errorHandler: {
        error: (error, message, count): ErrorAction => {
          return this.defaultErrorHandler.error(error, message, count)
        }
      },
      middleware: {
        didOpen: (document, next) => {
          if (shouldBeValidated(document)) {
            next(document)
            syncedDocuments.set(document.uri.toString(), document)
            return
          }
        },
        didChange: (event, next) => {
          if (syncedDocuments.has(event.textDocument.uri)) {
            next(event)
          }
        },
        didClose: (document, next) => {
          let uri = document.uri.toString()
          if (syncedDocuments.has(uri)) {
            syncedDocuments.delete(uri)
            next(document)
          }
        },
        provideCodeActions: (document, range, context, token, next): ProviderResult<(Command | CodeAction)[]> => {
          if (!syncedDocuments.has(document.uri.toString()) || !context.diagnostics || context.diagnostics.length === 0) {
            return []
          }
          let eslintDiagnostics: Diagnostic[] = []
          for (let diagnostic of context.diagnostics) {
            if (diagnostic.source === 'eslint') {
              eslintDiagnostics.push(diagnostic)
            }
          }
          if (eslintDiagnostics.length === 0) {
            return []
          }
          let newContext: CodeActionContext = Object.assign({}, context, {
            diagnostics: eslintDiagnostics
          } as CodeActionContext)
          return next(document, range, newContext, token)
        },
        workspace: {
          configuration: (_params, _token, _next): any => {
            let config = workspace.getConfiguration('eslint')
            let pm = config.get('packageManager', 'npm')
            let settings: TextDocumentSettings = {
              packageManager: pm === 'yarn' ? 'yarn' : 'npm',
              autoFix: config.get('autoFix', false),
              autoFixOnSave: config.get('autoFixOnSave', false),
              options: config.get('options', {}),
              run: config.get('run', 'onType'),
              workingDirectory: {directory: workspace.root, changeProcessCWD: false}
            }
            return [settings]
          }
        } as WorkspaceMiddleware
      }
    })
    return clientOptions
  }
}

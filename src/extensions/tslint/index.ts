import {exec} from 'child_process'
import fs from 'fs'
import opn from 'opn'
import path from 'path'
import {CancellationToken, CodeAction, CodeActionContext, Command, ConfigurationParams, Diagnostic, RequestType, TextDocument, TextDocumentIdentifier, TextEdit} from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import commandManager from '../../commands'
import {LanguageService} from '../../language-client'
import {LanguageClientOptions, WorkspaceMiddleware} from '../../language-client/main'
import {ProviderResult} from '../../provider'
import {ServiceStat, TextDocumentWillSaveEvent} from '../../types'
import {echoErr, echoMessage, echoWarning} from '../../util'
import workspace from '../../workspace'
const logger = require('../../util/logger')('tslint')

interface AllFixesParams {
  readonly textDocument: TextDocumentIdentifier
  readonly isOnSave: boolean
}

interface AllFixesResult {
  readonly documentVersion: number
  readonly edits: TextEdit[]
  readonly ruleId?: string
  readonly overlappingFixes: boolean
}

namespace AllFixesRequest {
  export const type = new RequestType<
    AllFixesParams,
    AllFixesResult,
    void,
    void
    >('textDocument/tslint/allFixes')
}

interface NoTSLintLibraryParams {
  readonly source: TextDocumentIdentifier
}

interface NoTSLintLibraryResult {
}

namespace NoTSLintLibraryRequest {
  export const type = new RequestType<NoTSLintLibraryParams, NoTSLintLibraryResult, void, void>('tslint/noLibrary')
}

interface Settings {
  enable: boolean
  jsEnable: boolean
  rulesDirectory: string | string[]
  configFile: string
  ignoreDefinitionFiles: boolean
  exclude: string | string[]
  validateWithDefaultConfig: boolean
  nodePath: string | undefined
  run: 'onSave' | 'onType'
  alwaysShowRuleFailuresAsWarnings: boolean
  autoFixOnSave: boolean | string[]
  trace: any
  workspaceFolderPath: string // 'virtual' setting sent to the server
}

export default class TslintService extends LanguageService {
  constructor() {
    const config = workspace.getConfiguration().get('tslint') as any
    super('tslint', 'Tslint Language Server', {
      module: path.join(__dirname, 'server/tslintServer.js'),
      args: ['--node-ipc'],
      execArgv: config.execArgv,
      filetypes: config.filetypes || ['typescript', 'javascript'],
      enable: config.enable !== false
    }, 'tslint')

    this.onServiceReady(() => {
      this.client.onRequest(NoTSLintLibraryRequest.type, () => {
        return {}
      })

      workspace.onWillSaveTextDocument(this.willSaveTextDocument)
      commandManager.registerCommand('_tslint.applySingleFix', applyTextEdits)
      commandManager.registerCommand('_tslint.applySameFixes', applyTextEdits)
      commandManager.registerCommand('_tslint.applyAllFixes', applyTextEdits)
      commandManager.registerCommand('_tslint.applyDisableRule', applyDisableRuleEdit)
      commandManager.registerCommand('_tslint.showRuleDocumentation', showRuleDocumentation)

      // user commandManager
      commandManager.registerCommand('tslint.fixAllProblems', this.fixAllProblems.bind(this))
      commandManager.registerCommand('tslint.createConfig', createDefaultConfiguration)
    })
  }

  protected resolveClientOptions(clientOptions: LanguageClientOptions): LanguageClientOptions {
    Object.assign(clientOptions, {
      synchronize: {
        configurationSection: 'tslint',
        fileEvents: workspace.createFileSystemWatcher('**/tslint.{json,yml,yaml}')
      },
      diagnosticCollectionName: 'tslint',
      initializationFailedHandler: error => {
        logger.error('Server initialization failed.', error)
        echoErr(workspace.nvim, 'Server initialization failed.')
        return false
      },
      middleware: {
        provideCodeActions: (document, range, context, token, next): ProviderResult<(Command | CodeAction)[]> => {
          // do not ask server for code action when the diagnostic isn't from tslint
          if (!context.diagnostics || context.diagnostics.length === 0) {
            return []
          }
          let tslintDiagnostics: Diagnostic[] = []
          for (let diagnostic of context.diagnostics) {
            if (diagnostic.source === 'tslint') {
              tslintDiagnostics.push(diagnostic)
            }
          }
          if (tslintDiagnostics.length === 0) return []
          let newContext: CodeActionContext = Object.assign({}, context, {
            diagnostics: tslintDiagnostics
          } as CodeActionContext)
          return next(document, range, newContext, token)
        },
        workspace: {
          configuration: (params: ConfigurationParams, token: CancellationToken, next: Function): any[] => {
            if (!params.items) return []
            let result:Settings[] = next(params, token, next)
            if (!result || !result.length) return []
            let config:Settings = Object.assign({}, result[0])
            let configFile = result[0].configFile || 'tslint.json'
            config.configFile = convertAbsolute(configFile)
            config.workspaceFolderPath = workspace.root
            return [config]
          }
        } as WorkspaceMiddleware
      }
    })
    return clientOptions
  }

  private autoFixOnSave(document: TextDocument): Thenable<any> {
    let start = Date.now()
    const timeBudget = 500 // total willSave time budget is 1500
    let retryCount = 0
    let retry = false
    let lastVersion = document.version
    let promise = this.client.sendRequest(AllFixesRequest.type, {
      textDocument: {uri: document.uri.toString()},
      isOnSave: true
    }).then(async result => {
      while (true) {
        if (Date.now() - start > timeBudget) {
          logger.info(`TSLint auto fix on save maximum time budget (${timeBudget}ms) exceeded.`)
          break
        }
        if (retryCount > 10) {
          logger.info(`TSLint auto fix on save maximum retries exceeded.`)
        }
        if (result) {
          // ensure that document versions on the client are in sync
          if (lastVersion !== document.version) {
            echoMessage(workspace.nvim, 'TSLint: Auto fix on save, fixes could not be applied (client version mismatch).')
            break
          }
          retry = false
          if (lastVersion !== result.documentVersion) {
            logger.info('TSLint auto fix on save, server document version different than client version')
            retry = true // retry to get the fixes matching the document
          } else {
            // disable version check by passing -1 as the version, the event loop is blocked during `willSave`
            let success = await applyTextEdits(
              document.uri.toString(),
              -1,
              result.edits
            )
            if (!success) {
              echoErr(workspace.nvim, 'TSLint: Auto fix on save, edits could not be applied')
              break
            }
          }

          lastVersion = document.version

          if (result.overlappingFixes || retry) {
            // ask for more non overlapping fixes
            if (retry) {
              retryCount++
            }
            result = await this.client.sendRequest(AllFixesRequest.type, {
              textDocument: {uri: document.uri.toString()},
              isOnSave: true
            })
          } else {
            break
          }
        } else {
          break
        }
      }
      return null
    })
    return promise
  }

  private async fixAllProblems(): Promise<void> {
    // server is not running so there can be no problems to fix
    if (this.state != ServiceStat.Running) return
    let document = await workspace.document
    let uri: string = document.uri
    try {
      let result = await this.client.sendRequest(AllFixesRequest.type, {textDocument: {uri}})
      if (result) {
        let success = await applyTextEdits(
          uri,
          result.documentVersion,
          result.edits
        )
        if (!success) {
          echoErr(workspace.nvim, 'TSLint could not apply the fixes')
        }
      }
    } catch (e) {
      echoErr(workspace.nvim, 'Failed to apply TSLint fixes to the document. Please consider opening an issue with steps to reproduce.')
    }
  }

  private willSaveTextDocument(e: TextDocumentWillSaveEvent): void {
    if (this.state != ServiceStat.Running) return
    let config = workspace.getConfiguration('tslint')
    let autoFix = config.get('autoFixOnSave', false)
    if (autoFix) {
      let document = e.document
      // only auto fix when the document was manually saved by the user
      if (!(isTypeScriptDocument(document) || isEnabledForJavaScriptDocument(document))) {
        return
      }
      e.waitUntil(this.autoFixOnSave(document))
    }
  }
}

function isTypeScriptDocument(document: TextDocument): boolean {
  return document.languageId === 'typescript' || document.languageId === 'typescriptreact'
}

function isJavaScriptDocument(languageId): boolean {
  return languageId === 'javascript' || languageId === 'javascriptreact'
}

function isEnabledForJavaScriptDocument(document: TextDocument): boolean {
  let isJsEnable = workspace.getConfiguration('tslint').get('jsEnable', true)
  if (isJsEnable && isJavaScriptDocument(document.languageId)) {
    return true
  }
  return false
}

function exists(file: string): Promise<boolean> {
  return new Promise<boolean>((resolve, _reject) => {
    fs.exists(file, value => {
      resolve(value)
    })
  })
}

async function findTslint(rootPath: string): Promise<string> {
  const platform = process.platform
  if (platform === 'win32' &&
    (await exists(path.join(rootPath, 'node_modules', '.bin', 'tslint.cmd')))
  ) {
    return path.join('.', 'node_modules', '.bin', 'tslint.cmd')
  } else if (
    (platform === 'linux' || platform === 'darwin') &&
    (await exists(path.join(rootPath, 'node_modules', '.bin', 'tslint')))
  ) {
    return path.join('.', 'node_modules', '.bin', 'tslint')
  } else {
    return 'tslint'
  }
}

async function createDefaultConfiguration(): Promise<void> {
  const folderPath = workspace.root
  const tslintConfigFile = path.join(folderPath, 'tslint.json')
  if (fs.existsSync(tslintConfigFile)) {
    await workspace.openResource(Uri.file(tslintConfigFile).toString())
  } else {
    const tslintCmd = await findTslint(folderPath)
    const cmd = `${tslintCmd} --init`
    const p = exec(cmd, {cwd: folderPath, env: process.env})
    p.on('exit', async (code: number, _signal: string) => {
      if (code === 0) {
        await workspace.openResource(Uri.file(tslintConfigFile).toString())
      } else {
        echoErr(workspace.nvim, 'Could not run `tslint` to generate a configuration file. Please verify that you have `tslint` and `typescript` installed.')
      }
    })
  }
}

async function applyTextEdits(uri: string, _documentVersion: number, edits: TextEdit[]): Promise<boolean> {
  let document = workspace.getDocument(uri)
  if (!document) return false
  await document.applyEdits(workspace.nvim, edits)
  return true
}

async function applyDisableRuleEdit(uri: string, documentVersion: number, edits: TextEdit[]): Promise<void> {
  let document = workspace.getDocument(uri)
  if (!document) return
  if (document.version != documentVersion) {
    echoWarning(workspace.nvim, `TSLint fixes are outdated and can't be applied to the document.`)
    return
  }
  // prefix disable comment with same indent as line with the diagnostic
  let edit = edits[0]
  let line = document.getline(edit.range.start.line)
  let indent = await workspace.nvim.call('indent', [edit.range.start.line + 1])
  let prefix = line.substr(0, indent)
  edit.newText = prefix + edit.newText
  await applyTextEdits(uri, documentVersion, edits)
}

function showRuleDocumentation(_uri: string, _documentVersion: number, _edits: TextEdit[], ruleId: string): void {
  const tslintDocBaseURL = 'https://palantir.github.io/tslint/rules'
  if (!ruleId) return
  opn(tslintDocBaseURL + '/' + ruleId)
}

function convertAbsolute(file: string): string {
  if (path.isAbsolute(file)) return file
  return path.join(workspace.root, file)
}

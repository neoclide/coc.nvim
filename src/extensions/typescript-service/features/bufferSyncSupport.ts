/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import workspace from '../../../workspace'
import {
  disposeAll,
} from '../../../util'
import Uri from 'vscode-uri'
import {
  TextDocument,
  DidChangeTextDocumentParams,
  Disposable,
} from 'vscode-languageserver-protocol'
import API from '../utils/api'
import * as Proto from '../protocol'
import {ITypeScriptServiceClient} from '../typescriptService'
import {Delayer} from '../utils/async'
import * as languageModeIds from '../utils/languageModeIds'
const logger = require('../../../util/logger')('typescript-service-bufferSyncSupport')

function mode2ScriptKind(
  mode: string
): 'TS' | 'TSX' | 'JS' | 'JSX' | undefined {
  switch (mode) {
    case languageModeIds.typescript:
      return 'TS'
    case languageModeIds.typescriptreact:
      return 'TSX'
    case languageModeIds.javascript:
      return 'JS'
    case languageModeIds.javascriptreact:
      return 'JSX'
  }
  return undefined
}

export default class BufferSyncSupport {
  private readonly client: ITypeScriptServiceClient

  private _validate: boolean
  private readonly modeIds: Set<string>
  private readonly uris: Set<string> = new Set()
  private readonly disposables: Disposable[] = []

  private readonly pendingDiagnostics = new Map<string, number>()
  private readonly diagnosticDelayer: Delayer<any>

  constructor(
    client: ITypeScriptServiceClient,
    modeIds: string[],
    validate: boolean
  ) {
    this.client = client
    this.modeIds = new Set<string>(modeIds)
    this._validate = validate || false
    this.diagnosticDelayer = new Delayer<any>(300)
  }

  public listen(): void {
    workspace.onDidOpenTextDocument(
      this.onDidOpenTextDocument,
      this,
      this.disposables
    )
    workspace.onDidCloseTextDocument(
      this.onDidCloseTextDocument,
      this,
      this.disposables
    )
    workspace.onDidChangeTextDocument(
      this.onDidChangeTextDocument,
      this,
      this.disposables
    )
    workspace.textDocuments.forEach(this.onDidOpenTextDocument, this)
  }

  public set validate(value: boolean) {
    this._validate = value
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }

  private onDidOpenTextDocument(document: TextDocument): void {
    if (!this.modeIds.has(document.languageId)) return
    let {uri} = document
    let filepath = Uri.parse(uri).fsPath
    this.uris.add(uri)
    const args: Proto.OpenRequestArgs = {
      file: filepath,
      fileContent: document.getText()
    }

    if (this.client.apiVersion.gte(API.v203)) {
      const scriptKind = mode2ScriptKind(document.languageId)
      if (scriptKind) {
        args.scriptKindName = scriptKind
      }
    }
    this.client.execute('open', args, false) // tslint:disable-line
    this.requestDiagnostic(uri)
  }

  private onDidCloseTextDocument(document: TextDocument): void {
    let {uri} = document
    if (!this.uris.has(uri)) return
    let filepath = Uri.parse(uri).fsPath
    const args: Proto.FileRequestArgs = {
      file: filepath
    }
    this.client.execute('close', args, false) // tslint:disable-line
  }

  private onDidChangeTextDocument(e: DidChangeTextDocumentParams): void {
    let {textDocument, contentChanges} = e
    let {uri} = textDocument
    if (!this.uris.has(uri)) return
    let filepath = Uri.parse(uri).fsPath
    for (const { range, text } of contentChanges) {
      const args: Proto.ChangeRequestArgs = {
        file: filepath,
        line: range ? range.start.line + 1 : 1,
        offset: range ? range.start.character + 1 : 1,
        endLine: range ? range.end.line + 1 : 2**24,
        endOffset: range ? range.end.character + 1 : 1,
        insertString: text
      }
      this.client.execute('change', args, false) // tslint:disable-line
    }
    this.requestDiagnostic(uri)
  }

  public requestAllDiagnostics():void {
    if (!this._validate) {
      return
    }
    for (const uri of this.uris) {
      this.pendingDiagnostics.set(uri, Date.now())
    }
    this.diagnosticDelayer.trigger(() => { // tslint:disable-line
      this.sendPendingDiagnostics()
    }, 200)
  }

  public requestDiagnostic(uri: string): void {
    if (!this._validate) {
      return
    }
    let document = workspace.getDocument(uri)
    if (!document) return
    this.pendingDiagnostics.set(uri, Date.now())
    let delay = 300
    const lineCount = document.lineCount
    delay = Math.min(Math.max(Math.ceil(lineCount / 20), 300), 800)
    this.diagnosticDelayer.trigger(() => {
      this.sendPendingDiagnostics()
    }, delay) // tslint:disable-line
  }

  public hasPendingDiagnostics(uri: string): boolean {
    return this.pendingDiagnostics.has(uri)
  }

  private sendPendingDiagnostics(): void {
    if (!this._validate) {
      return
    }
    const files = Array.from(this.pendingDiagnostics.entries())
      .sort((a, b) => a[1] - b[1])
      .map(entry => Uri.parse(entry[0]).fsPath)

    // Add all open TS buffers to the geterr request. They might be visible
    for (const uri of this.uris) {
      if (!this.pendingDiagnostics.get(uri)) {
        let file = Uri.parse(uri).fsPath
        files.push(file)
      }
    }
    if (files.length) {
      const args: Proto.GeterrRequestArgs = {
        delay: 0,
        files
      }
      this.client.execute('geterr', args, false) // tslint:disable-line
    }
    this.pendingDiagnostics.clear()
  }
}

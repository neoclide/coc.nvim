/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Disposable, TextDocument, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { Command, CommandManager } from '../../../commands'
import { TextDocumentWillSaveEvent } from '../../../types'
import { disposeAll } from '../../../util'
import workspace from '../../../workspace'
import Proto from '../protocol'
import { ITypeScriptServiceClient } from '../typescriptService'
import { standardLanguageDescriptions } from '../utils/languageDescription'
import * as typeconverts from '../utils/typeConverters'
import FileConfigurationManager from './fileConfigurationManager'
const logger = require('../../../util/logger')('typescript-organizeImports')

class OrganizeImportsCommand implements Command {
  public readonly id: string = 'tsserver.organizeImports'

  constructor(
    private readonly client: ITypeScriptServiceClient,
    private commaAfterImport: boolean,
    private modeIds: string[]
  ) {
    workspace.onWillSaveUntil(this.onWillSaveUntil, this, 'tsserver-organizeImports')
  }

  private onWillSaveUntil(event: TextDocumentWillSaveEvent): void {
    let config = workspace.getConfiguration('tsserver')
    let format = config.get('orgnizeImportOnSave', false)
    if (!format) return
    let { document } = event
    if (this.modeIds.indexOf(document.languageId) == -1) return
    let willSaveWaitUntil = async (): Promise<TextEdit[]> => {
      let edit = await this.getTextEdits(document)
      if (!edit) return []
      return edit.changes ? edit.changes[document.uri] : []
    }
    event.waitUntil(willSaveWaitUntil())
  }

  private async getTextEdits(document: TextDocument): Promise<WorkspaceEdit | null> {
    let file = this.client.toPath(document.uri)
    const args: Proto.OrganizeImportsRequestArgs = {
      scope: {
        type: 'file',
        args: {
          file
        }
      }
    }
    const response = await this.client.execute('organizeImports', args)
    if (!response || !response.success) {
      return
    }

    const edit = typeconverts.WorkspaceEdit.fromFileCodeEdits(
      this.client,
      response.body
    )
    if (!this.commaAfterImport) {
      let { changes } = edit
      if (changes) {
        for (let c of Object.keys(changes)) {
          for (let textEdit of changes[c]) {
            textEdit.newText = textEdit.newText.replace(/;/g, '')
          }
        }
      }
    }
    return edit
  }

  public async execute(): Promise<void> {
    let document = await workspace.document
    if (this.modeIds.indexOf(document.filetype) == -1) return
    let edit = await this.getTextEdits(document.textDocument)
    if (edit) await workspace.applyEdit(edit)
    return
  }
}

export default class OrganizeImports {
  private disposables: Disposable[] = []
  public constructor(
    client: ITypeScriptServiceClient,
    commandManager: CommandManager,
    fileConfigurationManager: FileConfigurationManager,
    languageId: string
  ) {
    let description = standardLanguageDescriptions.find(o => o.id == languageId)
    let modeIds = description ? description.modeIds : []
    let option = fileConfigurationManager.getCompleteOptions(languageId)
    let cmd = new OrganizeImportsCommand(client, option.commaAfterImport, modeIds)
    commandManager.register(cmd)
    this.disposables.push(Disposable.create(() => {
      commandManager.unregister(cmd.id)
    }))
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

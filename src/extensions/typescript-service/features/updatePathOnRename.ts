/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as Proto from '../protocol'
import {ITypeScriptServiceClient} from '../typescriptService'
import * as typeConverters from '../utils/typeConverters'
import FileConfigurationManager from './fileConfigurationManager'
import workspace from '../../../workspace'
import {wait} from '../../../util'
import {
  Disposable,
  TextDocument,
} from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
const logger = require('../../../util/logger')('typescript-langauge-updatePathOnRename')

export default class UpdateImportsOnFileRenameHandler {
  private readonly _onDidRenameSub: Disposable

  public constructor(
    private readonly client: ITypeScriptServiceClient,
    private readonly fileConfigurationManager: FileConfigurationManager,
    languageId: string
  ) {
    let glob = languageId == 'typescript' ? '**/*.ts' : '**/*.js'
    const watcher = workspace.createFileSystemWatcher(glob)
    watcher.onDidRename(e => {
      this.doRename(e.oldUri, e.newUri)
    })
  }

  public dispose() {
    this._onDidRenameSub.dispose()
  }

  private async doRename(
    oldResource: Uri,
    newResource: Uri
  ): Promise<void> {
    logger.debug('rename', oldResource, newResource)
    const targetFile = newResource.fsPath
    const oldFile = oldResource.fsPath
    await workspace.openResource(newResource.toString())
    // Make sure TS knows about file
    await wait(30)

    let document = workspace.getDocument(newResource.toString())
    if (!document) return

    const edits = await this.getEditsForFileRename(
      document.textDocument,
      oldFile,
      targetFile,
    )
    if (!edits) return

    if (await this.promptUser(newResource)) {
      await workspace.applyEdit(edits)
    }
  }

  private async promptUser(newResource: Uri): Promise<boolean> {
    const res = await workspace.nvim.call('coc#util#prompt_confirm', [`Update imports for moved file: ${newResource.fsPath}`])
    return res == 1
  }


  private async getEditsForFileRename(
    document: TextDocument,
    oldFile: string,
    newFile: string
  ) {
    await this.fileConfigurationManager.ensureConfigurationForDocument(document)

    const args: Proto.GetEditsForFileRenameRequestArgs = {
      oldFilePath: oldFile,
      newFilePath: newFile
    }
    const response = await this.client.execute('getEditsForFileRename', args)
    if (!response || !response.body) {
      return
    }

    const edits: Proto.FileCodeEdits[] = []
    for (const edit of response.body) {
      // Workaround for https://github.com/Microsoft/vscode/issues/52675
      if ((edit as Proto.FileCodeEdits).fileName.match(
          /[\/\\]node_modules[\/\\]/gi
        )) {
        continue
      }
      for (const change of (edit as Proto.FileCodeEdits).textChanges) {
        if (change.newText.match(/\/node_modules\//gi)) {
          continue
        }
      }

      edits.push(edit)
    }
    return typeConverters.WorkspaceEdit.fromFileCodeEdits(this.client, edits)
  }
}

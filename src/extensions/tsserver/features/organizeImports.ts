/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as Proto from '../protocol'
import {ITypeScriptServiceClient} from '../typescriptService'
import {Command, CommandManager} from '../../../commands'
import * as typeconverts from '../utils/typeConverters'
import workspace from '../../../workspace'
import FileConfigurationManager from './fileConfigurationManager'
import * as languageIds from '../utils/languageModeIds'
import Uri from 'vscode-uri'
import {Disposable} from 'vscode-languageserver-protocol'
import {disposeAll} from '../../../util'
const logger = require('../../../util/logger')('typescript-organizeImports')

class OrganizeImportsCommand implements Command {
  public readonly id: string = 'tsserver.organizeImports'

  constructor(
    private readonly client: ITypeScriptServiceClient,
    private commaAfterImport:boolean,
  ) {
  }

  public async execute(): Promise<void> {
    let document = await workspace.document
    if (languageIds[document.filetype] == null) return
    let file = Uri.parse(document.uri).fsPath
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
      let {changes} = edit
      if (changes) {
        for (let c of Object.keys(changes)) {
          for (let textEdit of changes[c]) {
            textEdit.newText = textEdit.newText.replace(/;/g, '')
          }
        }
      }
    }
    await workspace.applyEdit(edit)
    return
  }
}

export default class OrganizeImports {
  private disposables:Disposable[] = []
  public constructor(
    client: ITypeScriptServiceClient,
    commandManager: CommandManager,
    fileConfigurationManager: FileConfigurationManager,
    languageId: string
  ) {
    let option = fileConfigurationManager.getCompleteOptions(languageId)
    let cmd = new OrganizeImportsCommand(client, option.commaAfterImport)
    commandManager.register(cmd)
    this.disposables.push(Disposable.create(()=> {
      commandManager.unregister(cmd.id)
    }))
  }

  public dispose():void {
    disposeAll(this.disposables)
  }
}

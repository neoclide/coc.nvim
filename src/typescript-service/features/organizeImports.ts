/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as Proto from '../protocol'
import {ITypeScriptServiceClient} from '../typescriptService'
import {Command, CommandManager} from '../../commands'
import * as typeconverts from '../utils/typeConverters'
import {
  CodeActionProvider,
  CodeActionProviderMetadata,
} from '../../provider'
import {
  TextDocument,
  Range,
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionKind,
} from 'vscode-languageserver-protocol'
import workspace from '../../workspace'
import FileConfigurationManager from './fileConfigurationManager'
const logger = require('../../util/logger')('typescript-organizeImports')

class OrganizeImportsCommand implements Command {
  public static readonly Id = '_typescript.organizeImports'
  public readonly id = OrganizeImportsCommand.Id

  constructor(
    private readonly client: ITypeScriptServiceClient,
    private commaAfterImport:boolean,
  ) {
  }

  public async execute(file: string): Promise<void> {
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

export default class OrganizeImportsCodeActionProvider implements CodeActionProvider {
  public constructor(
    private readonly client: ITypeScriptServiceClient,
    commandManager: CommandManager,
    fileConfigurationManager: FileConfigurationManager,
    languageId: string
  ) {
    let option = fileConfigurationManager.getCompleteOptions(languageId)
    commandManager.register(new OrganizeImportsCommand(client, option.commaAfterImport))
  }

  public readonly metadata: CodeActionProviderMetadata = {
    providedCodeActionKinds: [CodeActionKind.SourceOrganizeImports]
  }

  public provideCodeActions(
    document: TextDocument,
    _range: Range,
    _context: CodeActionContext,
    _token: CancellationToken
  ): CodeAction[] {
    const file = this.client.toPath(document.uri)
    if (!file) return []

    const action:CodeAction = {
      title: 'Organize Imports',
      kind: CodeActionKind.SourceOrganizeImports,
      command: {
        title: '',
        command: OrganizeImportsCommand.Id,
        arguments: [file]
      }
    }
    return [action]
  }
}

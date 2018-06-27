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
const logger = require('../../util/logger')('typescript-organizeImports')

class OrganizeImportsCommand implements Command {
  public static readonly Id = '_typescript.organizeImports'

  public readonly id = OrganizeImportsCommand.Id

  constructor(private readonly client: ITypeScriptServiceClient) {}

  public async execute(file: string): Promise<boolean> {
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
      return false
    }

    const edits = typeconverts.WorkspaceEdit.fromFileCodeEdits(
      this.client,
      response.body
    )
    return await workspace.applyEdit(edits)
  }
}

export default class OrganizeImportsCodeActionProvider implements CodeActionProvider {
  public constructor(
    private readonly client: ITypeScriptServiceClient,
    commandManager: CommandManager,
  ) {
    commandManager.register(new OrganizeImportsCommand(client))
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

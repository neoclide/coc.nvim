/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken, FormattingOptions, Position, Range, TextDocument, TextEdit } from 'vscode-languageserver-protocol'
import commandManager from '../../../commands'
import { DocumentFormattingEditProvider, DocumentRangeFormattingEditProvider } from '../../../provider'
import workspace from '../../../workspace'
import * as Proto from '../protocol'
import { ITypeScriptServiceClient } from '../typescriptService'
import { languageIds } from '../utils/languageModeIds'
import * as typeConverters from '../utils/typeConverters'
import FileConfigurationManager from './fileConfigurationManager'

export default class TypeScriptFormattingProvider
  implements
  DocumentRangeFormattingEditProvider,
  DocumentFormattingEditProvider {
  public constructor(
    private readonly client: ITypeScriptServiceClient,
    private readonly formattingOptionsManager: FileConfigurationManager
  ) {
    commandManager.register({
      id: 'tsserver.format',
      execute: async (): Promise<void> => {
        let document = await workspace.document
        if (!document) return
        if (languageIds.indexOf(document.filetype) == -1) {
          return
        }
        let options = await workspace.getFormatOptions()
        let edit = await this.provideDocumentFormattingEdits(
          document.textDocument,
          options
        )
        if (!edit) return
        await document.applyEdits(workspace.nvim, edit)
      }
    })
  }

  private async doFormat(
    document: TextDocument,
    options: FormattingOptions,
    args: Proto.FormatRequestArgs,
    token?: CancellationToken
  ): Promise<TextEdit[]> {
    await this.formattingOptionsManager.ensureConfigurationOptions(
      document.languageId,
      options.insertSpaces,
      options.tabSize
    )
    try {
      const response = await this.client.execute('format', args, token)
      if (response.body) {
        return response.body.map(typeConverters.TextEdit.fromCodeEdit)
      }
    } catch {
      // noop
    }
    return []
  }

  public async provideDocumentRangeFormattingEdits(
    document: TextDocument,
    range: Range,
    options: FormattingOptions,
    token: CancellationToken
  ): Promise<TextEdit[]> {
    const filepath = this.client.toPath(document.uri)
    if (!filepath) return []
    const args: Proto.FormatRequestArgs = {
      file: filepath,
      line: range.start.line + 1,
      offset: range.start.character + 1,
      endLine: range.end.line + 1,
      endOffset: range.end.character + 1
    }
    return this.doFormat(document, options, args, token)
  }

  public async provideDocumentFormattingEdits(
    document: TextDocument,
    options: FormattingOptions,
    token?: CancellationToken
  ): Promise<TextEdit[]> {
    const filepath = this.client.toPath(document.uri)
    if (!filepath) return []
    const args: Proto.FormatRequestArgs = {
      file: filepath,
      line: 1,
      offset: 1,
      endLine: document.lineCount + 1,
      endOffset: 1
    }
    return this.doFormat(document, options, args, token)
  }

  public async provideOnTypeFormattingEdits(
    document: TextDocument,
    position: Position,
    ch: string,
    options: FormattingOptions,
    token: CancellationToken
  ): Promise<TextEdit[]> {
    if (!this.client.configuration.formatOnType) {
      return
    }
    const file = this.client.toPath(document.uri)
    if (!file) {
      return []
    }

    await this.formattingOptionsManager.ensureConfigurationOptions(
      document.languageId,
      options.insertSpaces,
      options.tabSize
    )
    const doc = workspace.getDocument(document.uri)

    const args: Proto.FormatOnKeyRequestArgs = {
      ...typeConverters.Position.toFileLocationRequestArgs(file, position),
      key: ch
    }
    try {
      const { body } = await this.client.execute('formatonkey', args, token)
      const edits = body
      const result: TextEdit[] = []
      if (!edits) {
        return result
      }
      for (const edit of edits) {
        const textEdit = typeConverters.TextEdit.fromCodeEdit(edit)
        const range = textEdit.range
        // Work around for https://github.com/Microsoft/TypeScript/issues/6700.
        // Check if we have an edit at the beginning of the line which only removes white spaces and leaves
        // an empty line. Drop those edits
        if (
          range.start.character === 0 &&
          range.start.line === range.end.line &&
          textEdit.newText === ''
        ) {
          const lText = doc.getline(range.start.line)
          // If the edit leaves something on the line keep the edit (note that the end character is exclusive).
          // Keep it also if it removes something else than whitespace
          if (lText.trim().length > 0 || lText.length > range.end.character) {
            result.push(textEdit)
          }
        } else {
          result.push(textEdit)
        }
      }
      return result
    } catch {
      // noop
    }
    return []
  }
}

import * as Proto from '../protocol'
import {
  DocumentRangeFormattingEditProvider,
  DocumentFormattingEditProvider,
  FormattingOptions,
} from '../../provider'
import {
  TextDocument,
  CancellationToken,
  TextEdit,
  Range,
} from 'vscode-languageserver-protocol'
import {ITypeScriptServiceClient} from '../typescriptService'
import * as typeConverters from '../utils/typeConverters'
import FileConfigurationManager from './fileConfigurationManager'

export default class TypeScriptFormattingProvider implements DocumentRangeFormattingEditProvider,DocumentFormattingEditProvider {

  public constructor(
    private readonly client: ITypeScriptServiceClient,
    private readonly formattingOptionsManager: FileConfigurationManager
  ) {}

  private async doFormat(
    document: TextDocument,
    options: FormattingOptions,
    args: Proto.FormatRequestArgs,
    token: CancellationToken
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
    token: CancellationToken
  ): Promise<TextEdit[]> {
    const filepath = this.client.toPath(document.uri)
    if (!filepath) return []
    const args: Proto.FormatRequestArgs = {
      file: filepath,
      line:1,
      offset: 1,
      endLine: document.lineCount + 1,
      endOffset: 1,
    }
    return this.doFormat(document, options, args, token)
  }
}

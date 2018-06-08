import {
  Command,
  MarkupKind,
  MarkupContent,
  TextEdit,
  CompletionItem,
  InsertTextFormat,
  CancellationToken,
  Position,
} from 'vscode-languageserver-protocol'
import commands, { Command as CommandItem } from '../../commands'
import { Uri } from '../../util'
import Document from '../../model/document'
import workspace from '../../workspace'
import {ITypeScriptServiceClient} from '../typescriptService'
import * as Previewer from '../utils/previewer'
import TypingsStatus from '../utils/typingsStatus'
import {applyCodeAction} from '../utils/codeAction'
import { showQuickpick } from '../../util/index'
import {warningMsg} from '../utils/nvimBinding'
import {
  convertCompletionEntry,
  resolveItem
} from '../utils/completionItem'
import FileConfigurationManager, {CompletionOptions} from './fileConfigurationManager'
import * as Proto from '../protocol'
import * as PConst from '../protocol.const'
import * as typeConverters from '../utils/typeConverters'

class ApplyCompletionCodeActionCommand implements CommandItem {
  public static readonly ID = '_typescript.applyCompletionCodeAction'
  public readonly id = ApplyCompletionCodeActionCommand.ID
  public constructor(
    private readonly client: ITypeScriptServiceClient
  ) {
  }

  // apply code action on complete
  public async execute(codeActions: Proto.CodeAction[]):Promise<boolean> {
    if (codeActions.length === 0) {
      return true
    }

    if (codeActions.length === 1) {
      return applyCodeAction(this.client, codeActions[0])
    }

    const idx = await showQuickpick(workspace.nvim, codeActions.map(o => o.description), 'Select code action to apply')
    if (idx < 0) return
    const action = codeActions[idx]
    return applyCodeAction(this.client, action)
  }
}

export default class TypeScriptCompletionItemProvider {

  // TODO should not be here
  public static readonly triggerCharacters = ['.', '@', '<']
  private readonly completeOption: CompletionOptions

  constructor(
    private readonly client: ITypeScriptServiceClient,
    private readonly typingsStatus: TypingsStatus,
    private readonly fileConfigurationManager: FileConfigurationManager,
  ) {
    commands.register(new ApplyCompletionCodeActionCommand(this.client))
    this.fileConfigurationManager.ensureConfigurationOptions().catch(err => {
      // noop
    })
    this.completeOption = this.fileConfigurationManager.getCompleteOptions()
  }

  /**
   * Get completionItems
   *
   * @public
   * @param {Document} document
   * @param {Position} position
   * @param {string} line
   * @param {CancellationToken} token
   * @param {string} triggerCharacter
   * @returns {Promise<CompletionItem[]>}
   */
  public async provideCompletionItems(
    document: Document,
    position: Position,
    line: string,
    token: CancellationToken,
    triggerCharacter: string
  ): Promise<CompletionItem[]> {
    if (this.typingsStatus.isAcquiringTypings) {
      warningMsg('Acquiring typings...')
      return []
    }
    let {uri} = document
    const file = this.client.normalizePath(Uri.parse(document.uri))
    if (!file) return []

    if (!this.shouldTrigger(triggerCharacter, line, position)) {
      return []
    }

    const {completeOption} = this

    const args: Proto.CompletionsRequestArgs = {
      ...typeConverters.Position.toFileLocationRequestArgs(file, position),
      includeExternalModuleExports: completeOption.autoImportSuggestions,
      includeInsertTextCompletions: true,
      triggerCharacter: triggerCharacter && triggerCharacter === '.' ? triggerCharacter : undefined
    }

    let msg: Proto.CompletionEntry[] | undefined
    try {
      const response = await this.client.execute('completions', args, token)
      msg = response.body
      if (!msg) {
        return []
      }
    } catch {
      return []
    }
    const enableDotCompletions = this.shouldEnableDotCompletions(
      line,
      position
    )

    const completionItems: CompletionItem[] = []
    for (const element of msg) {
      if (element.kind === PConst.Kind.warning && !completeOption.nameSuggestions) {
        continue
      }
      if (!completeOption.autoImportSuggestions && element.hasAction) {
        continue
      }
      const item = convertCompletionEntry(
        element,
        uri,
        line,
        position,
        enableDotCompletions,
        completeOption.useCodeSnippetsOnMethodSuggest,
      )
      completionItems.push(item)
    }

    return completionItems
  }

  /**
   * Resolve complete item, could have documentation added
   *
   * @public
   * @param {CompletionItem} item
   * @param {CancellationToken} token
   * @returns {Promise<CompletionItem | undefined>}
   */
  public async resolveCompletionItem(
    item: CompletionItem,
    token: CancellationToken
  ): Promise<CompletionItem | undefined> {
    if (item == null) return undefined

    let {uri, position, source} = item.data
    const filepath = this.client.normalizePath(Uri.parse(uri))
    if (!filepath) return undefined
    let document = workspace.getDocumentFromUri(uri)
    if (!document) return undefined
    resolveItem(item, document)
    const args: Proto.CompletionDetailsRequestArgs = {
      ...typeConverters.Position.toFileLocationRequestArgs(
        filepath,
        position
      ),
      entryNames: [
        source
          ? {name: item.label, source}
          : item.label
      ]
    }

    let response: Proto.CompletionDetailsResponse
    try {
      response = await this.client.execute(
        'completionEntryDetails',
        args,
        token
      )
    } catch {
      return item
    }

    const details = response.body
    if (!details || !details.length || !details[0]) {
      return item
    }
    const detail = details[0]
    item.detail = detail.displayParts.length
      ? Previewer.plain(detail.displayParts)
      : undefined

    item.documentation = this.getDocumentation(detail, item)
    const {command, additionalTextEdits} = this.getCodeActions(detail, filepath)
    if (command)  item.command = command
    item.additionalTextEdits = additionalTextEdits

    if (detail && item.insertTextFormat == InsertTextFormat.Snippet) {
      const shouldCompleteFunction = await this.isValidFunctionCompletionContext(
        filepath,
        position
      )
      if (shouldCompleteFunction) {
        this.createSnippetOfFunctionCall(item, detail)
      }
    }

    return item
  }

  private getCodeActions(
    detail: Proto.CompletionEntryDetails,
    filepath: string
  ): {command?: Command; additionalTextEdits?: TextEdit[]} {
    if (!detail.codeActions || !detail.codeActions.length) {
      return {}
    }
    // Try to extract out the additionalTextEdits for the current file.
    // Also check if we still have to apply other workspace edits
    const additionalTextEdits: TextEdit[] = []
    let hasReaminingCommandsOrEdits = false
    for (const tsAction of detail.codeActions) {
      if (tsAction.commands) {
        hasReaminingCommandsOrEdits = true
      }
      // Convert all edits in the current file using `additionalTextEdits`
      if (tsAction.changes) {
        for (const change of tsAction.changes) {
          if (change.fileName === filepath) {
            additionalTextEdits.push(
              ...change.textChanges.map(typeConverters.TextEdit.fromCodeEdit)
            )
          } else {
            hasReaminingCommandsOrEdits = true
          }
        }
      }
    }
    let command = null

    if (hasReaminingCommandsOrEdits) {
      // Create command that applies all edits not in the current file.
      command = {
        title: '',
        command: ApplyCompletionCodeActionCommand.ID,
        arguments: [
          detail.codeActions.map((x): Proto.CodeAction => ({
            commands: x.commands,
            description: x.description,
            changes: x.changes.filter(x => x.fileName !== filepath)
          }))
        ]
      }
    }

    return {
      command,
      additionalTextEdits: additionalTextEdits.length
        ? additionalTextEdits
        : undefined
    }
  }

  private shouldEnableDotCompletions(
    line: string,
    position: Position
  ): boolean {
    // TODO: Workaround for https://github.com/Microsoft/TypeScript/issues/13456
    if (position.character > 1) {
      let preText = line.slice(0, position.character)
      return preText.match(/[a-z_$\)\]\}]\s*$/gi) !== null
    }

    return true
  }

  private shouldTrigger(
    triggerCharacter: string,
    line: string,
    position: Position
  ): boolean {
    if (triggerCharacter === '@') {
      // make sure we are in something that looks like the start of a jsdoc comment
      const pre = line.slice(0, position.character)
      if (!pre.match(/^\s*\*[ ]?@/) && !pre.match(/\/\*\*+[ ]?@/)) {
        return false
      }
    }

    if (triggerCharacter === '<') {
      return this.client.apiVersion.has290Features()
    }

    return true
  }

  // complete item documentation
  private getDocumentation(
    detail: Proto.CompletionEntryDetails, item: CompletionItem
  ): MarkupContent | undefined {
    let documentation = ''
    if (detail.source) {
      const importPath = `'${Previewer.plain(detail.source)}'`
      const autoImportLabel = `Auto import from ${importPath}`
      documentation += `${autoImportLabel}\n${item.detail}\n`
    }
    let parts = [
      Previewer.plain(detail.documentation),
      Previewer.tagsMarkdownPreview(detail.tags)
    ]
    documentation += parts.join('\n')
    if (documentation.length) {
      return {
        kind: MarkupKind.Markdown,
        value: documentation
      }
    }
    return undefined
  }

  private async isValidFunctionCompletionContext(
    filepath: string,
    position: Position
  ): Promise<boolean> {
    // Workaround for https://github.com/Microsoft/TypeScript/issues/12677
    // Don't complete function calls inside of destructive assigments or imports
    try {
      const infoResponse = await this.client.execute(
        'quickinfo',
        typeConverters.Position.toFileLocationRequestArgs(filepath, position)
      )
      const info = infoResponse.body
      switch (info && info.kind) {
        case 'var':
        case 'let':
        case 'const':
        case 'alias':
          return false
        default:
          return true
      }
    } catch (e) {
      return true
    }
  }

  private createSnippetOfFunctionCall(
    item: CompletionItem,
    detail: Proto.CompletionEntryDetails
  ): void {
    let hasOptionalParameters = false
    let hasAddedParameters = false

    let snippet = ''
    const methodName = detail.displayParts.find(
      part => part.kind === 'methodName'
    )
    let {textEdit, data} = item
    let {position, uri} = data

    if (textEdit) {
      snippet += textEdit.newText
    } else {
      // we don't use insertText
      let document = workspace.getDocumentFromUri(uri)
      if (!document) return
      let range = document.getWordRangeAtPosition(position)
      textEdit = { range, newText: '' }
      snippet += (methodName && methodName.text) || item.label
    }
    snippet += '('

    let parenCount = 0
    let i = 0
    for (; i < detail.displayParts.length; ++i) {
      const part = detail.displayParts[i]
      // Only take top level paren names
      if (part.kind === 'parameterName' && parenCount === 1) {
        const next = detail.displayParts[i + 1]
        // Skip optional parameters
        const nameIsFollowedByOptionalIndicator = next && next.text === '?'
        if (!nameIsFollowedByOptionalIndicator) {
          if (hasAddedParameters) snippet += ', '
          hasAddedParameters = true
          snippet += part.text
        }
        hasOptionalParameters =
          hasOptionalParameters || nameIsFollowedByOptionalIndicator
      } else if (part.kind === 'punctuation') {
        if (part.text === '(') {
          ++parenCount
        } else if (part.text === ')') {
          --parenCount
        } else if (part.text === '...' && parenCount === 1) {
          // Found rest parmeter. Do not fill in any further arguments
          hasOptionalParameters = true
          break
        }
      }
    }
    if (hasOptionalParameters) {
      snippet += '$1'
    }
    snippet += ')'
    snippet += '$0'
    textEdit.newText = snippet
  }
}

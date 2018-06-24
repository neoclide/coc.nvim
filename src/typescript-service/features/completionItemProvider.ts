import {
  Command,
  TextDocument,
  MarkupKind,
  MarkupContent,
  TextEdit,
  CompletionItem,
  InsertTextFormat,
  CancellationToken,
  Position,
} from 'vscode-languageserver-protocol'
import {
  CompletionContext,
  CompletionItemProvider,
} from '../../provider'
import commands, { Command as CommandItem } from '../../commands'
import {
  Uri,
} from '../../types'
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
import {languageIds} from '../utils/languageModeIds'
import FileConfigurationManager, {CompletionOptions} from './fileConfigurationManager'
import * as Proto from '../protocol'
import * as PConst from '../protocol.const'
import * as typeConverters from '../utils/typeConverters'
const logger = require('../../util/logger')('typescript-completionItemProvider')

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

export default class TypeScriptCompletionItemProvider implements CompletionItemProvider {

  public static readonly triggerCharacters = ['.', '@', '<']
  private completeOption: CompletionOptions

  constructor(
    private readonly client: ITypeScriptServiceClient,
    private readonly typingsStatus: TypingsStatus,
    private readonly fileConfigurationManager: FileConfigurationManager,
  ) {

    workspace.nvim.eval('&filetype').then(filetype => {
      this.setCompleteOption(filetype as string)
    }).catch(() => {})// tslint:disable-line

    workspace.onDidEnterTextDocument(info => {
      this.setCompleteOption(info.languageId)
    })

    commands.register(new ApplyCompletionCodeActionCommand(this.client))
  }

  private setCompleteOption(languageId: string):void {
    if (languageIds.indexOf(languageId) !== -1) {
      this.completeOption = this.fileConfigurationManager.getCompleteOptions(languageId)
    }
  }

  /**
   * Get completionItems
   *
   * @public
   * @param {TextDocument} document
   * @param {Position} position
   * @param {CancellationToken} token
   * @param {string} triggerCharacter
   * @returns {Promise<CompletionItem[]>}
   */
  public async provideCompletionItems(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    context: CompletionContext,
  ): Promise<CompletionItem[]> {
    if (this.typingsStatus.isAcquiringTypings) {
      warningMsg('Acquiring typings...')
      return []
    }
    let {uri} = document
    const file = this.client.normalizePath(Uri.parse(document.uri))
    if (!file) return []
    let preText = document.getText({
      start: { line: position.line, character: 0 },
      end: position
    })
    let {triggerCharacter} = context

    if (!this.shouldTrigger(triggerCharacter, preText)) {
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
        position,
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
   * @returns {Promise<CompletionItem>}
   */
  public async resolveCompletionItem(
    item: CompletionItem,
    token: CancellationToken
  ): Promise<CompletionItem> {
    if (item == null) return undefined

    let {uri, position, source} = item.data
    const filepath = this.client.normalizePath(Uri.parse(uri))
    if (!filepath) return undefined
    let document = workspace.getDocument(uri)
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

    item.documentation = this.getDocumentation(detail)
    const {command, additionalTextEdits} = this.getCodeActions(detail, filepath)
    if (command)  item.command = command
    item.additionalTextEdits = additionalTextEdits
    if (detail && item.insertTextFormat == InsertTextFormat.Snippet) {
      this.createSnippetOfFunctionCall(item, detail)
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
    let {commaAfterImport} = this.completeOption
    logger.debug('detail:', JSON.stringify(detail.codeActions, null, 2))
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
    if (additionalTextEdits.length && !commaAfterImport) {
      // remove comma
      additionalTextEdits.forEach(o => {
        o.newText = o.newText.replace(/;\n$/, '\n')
      })
    }
    logger.debug('=======')
    logger.debug(JSON.stringify(additionalTextEdits))

    return {
      command,
      additionalTextEdits: additionalTextEdits.length
        ? additionalTextEdits
        : undefined
    }
  }

  private shouldTrigger(
    triggerCharacter: string,
    pre: string,
  ): boolean {
    if (triggerCharacter === '.') {
      if (pre.match(/[\s\.'"]\.$/)) {
        return false
      }
    } else if (triggerCharacter === '@') {
      // make sure we are in something that looks like the start of a jsdoc comment
      if (!pre.match(/^\s*\*[ ]?@/) && !pre.match(/\/\*\*+[ ]?@/)) {
        return false
      }
    } else if (triggerCharacter === '<') {
      return this.client.apiVersion.has290Features()
    }

    return true
  }

  // complete item documentation
  private getDocumentation(detail: Proto.CompletionEntryDetails): MarkupContent | undefined {
    let documentation = ''
    if (detail.source) {
      const importPath = `'${Previewer.plain(detail.source)}'`
      const autoImportLabel = `Auto import from ${importPath}`
      documentation += `${autoImportLabel}\n`
    }
    let parts = [
      Previewer.plain(detail.documentation),
      Previewer.tagsMarkdownPreview(detail.tags)
    ]
    parts = parts.filter(s => s && s.trim() != '')
    documentation += parts.join('\n\n')
    if (documentation.length) {
      return {
        kind: MarkupKind.Markdown,
        value: documentation
      }
    }
    return undefined
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
      snippet += item.insertText || textEdit.newText // tslint:disable-line
    } else {
      let document = workspace.getDocument(uri)
      if (!document) return
      let range = document.getWordRangeAtPosition(position)
      textEdit = { range, newText: '' }
      snippet += item.insertText || (methodName && methodName.text) || item.label // tslint:disable-line
    }
    snippet += '('
    let holderIndex = 1
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
          snippet += '${' +holderIndex+ ':' + part.text + '}'
          holderIndex = holderIndex + 1
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
      snippet += '${' + holderIndex + '}'
    }
    snippet += ')'
    snippet += '$0'
    textEdit.newText = snippet
    item.textEdit = textEdit
  }
}

import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, CodeAction, CodeActionContext, CodeActionKind, CodeLens, ColorInformation, ColorPresentation, CompletionItem, CompletionItemKind, CompletionList, CompletionTriggerKind, Disposable, DocumentHighlight, DocumentLink, DocumentSelector, DocumentSymbol, FoldingRange, FormattingOptions, Hover, InsertTextFormat, Location, LocationLink, MarkupContent, Position, Range, SignatureHelp, SymbolInformation, TextDocument, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import commands from './commands'
import diagnosticManager from './diagnostic/manager'
import Document from './model/document'
import { CodeActionProvider, CodeLensProvider, CompletionItemProvider, DeclarationProvider, DefinitionProvider, DocumentColorProvider, DocumentFormattingEditProvider, DocumentLinkProvider, DocumentRangeFormattingEditProvider, DocumentSymbolProvider, FoldingContext, FoldingRangeProvider, HoverProvider, ImplementationProvider, OnTypeFormattingEditProvider, ReferenceContext, ReferenceProvider, RenameProvider, SignatureHelpProvider, TypeDefinitionProvider, WorkspaceSymbolProvider } from './provider'
import CodeActionManager from './provider/codeActionmanager'
import CodeLensManager from './provider/codeLensManager'
import DeclarationManager from './provider/declarationManager'
import DefinitionManager from './provider/definitionManager'
import DocumentColorManager from './provider/documentColorManager'
import DocumentHighlightManager from './provider/documentHighlightManager'
import DocumentLinkManager from './provider/documentLinkManager'
import DocumentSymbolManager from './provider/documentSymbolManager'
import FoldingRangeManager from './provider/foldingRangeManager'
import FormatManager from './provider/formatManager'
import FormatRangeManager from './provider/formatRangeManager'
import HoverManager from './provider/hoverManager'
import ImplementationManager from './provider/implementatioinManager'
import OnTypeFormatManager from './provider/onTypeFormatManager'
import ReferenceManager from './provider/referenceManager'
import RenameManager from './provider/renameManager'
import SignatureManager from './provider/signatureManager'
import TypeDefinitionManager from './provider/typeDefinitionManager'
import WorkspaceSymbolManager from './provider/workspaceSymbolsManager'
import snippetManager from './snippets/manager'
import sources from './sources'
import { CompleteOption, CompleteResult, CompletionContext, DiagnosticCollection, ISource, SourceType, VimCompleteItem } from './types'
import { wait } from './util'
import * as complete from './util/complete'
import { getChangedPosition } from './util/position'
import workspace from './workspace'
const logger = require('./util/logger')('languages')

export interface CompletionSource {
  id: string
  source: ISource
  languageIds: string[]
}

interface CompleteConfig {
  priority: number
  echodocSupport: boolean
  waitTime: number
  invalidInsertCharacters: string[]
}

export function check<R extends (...args: any[]) => Promise<R>>(_target: any, key: string, descriptor: any): void {
  let fn = descriptor.value
  if (typeof fn !== 'function') {
    return
  }

  descriptor.value = function(...args: any[]): Promise<R> {
    let { cancelTokenSource } = this
    this.cancelTokenSource = new CancellationTokenSource()
    return new Promise((resolve, reject): void => { // tslint:disable-line
      let resolved = false
      let timer = setTimeout(() => {
        cancelTokenSource.cancel()
        if (!resolved) reject(new Error(`${key} timeout after 3s`))
      }, 3000)
      Promise.resolve(fn.apply(this, args)).then(res => {
        clearTimeout(timer)
        resolve(res)
      }, e => {
        clearTimeout(timer)
        reject(e)
      })
    })
  }
}

class Languages {
  private completeConfig: CompleteConfig
  private onTypeFormatManager = new OnTypeFormatManager()
  private documentLinkManager = new DocumentLinkManager()
  private documentColorManager = new DocumentColorManager()
  private foldingRangeManager = new FoldingRangeManager()
  private renameManager = new RenameManager()
  private formatManager = new FormatManager()
  private codeActionManager = new CodeActionManager()
  private workspaceSymbolsManager = new WorkspaceSymbolManager()
  private formatRangeManager = new FormatRangeManager()
  private hoverManager = new HoverManager()
  private signatureManager = new SignatureManager()
  private documentSymbolManager = new DocumentSymbolManager()
  private documentHighlightManager = new DocumentHighlightManager()
  private definitionManager = new DefinitionManager()
  private declarationManager = new DeclarationManager()
  private typeDefinitionManager = new TypeDefinitionManager()
  private referenceManager = new ReferenceManager()
  private implementatioinManager = new ImplementationManager()
  private codeLensManager = new CodeLensManager()
  private cancelTokenSource: CancellationTokenSource = new CancellationTokenSource()

  constructor() {
    workspace.onWillSaveUntil(event => {
      let config = workspace.getConfiguration('coc.preferences')
      let filetypes = config.get<string[]>('formatOnSaveFiletypes', [])
      let { languageId } = event.document
      if (filetypes.indexOf(languageId) !== -1) {
        let willSaveWaitUntil = async (): Promise<TextEdit[]> => {
          let options = await workspace.getFormatOptions(event.document.uri)
          let textEdits = await this.provideDocumentFormattingEdits(event.document, options)
          return textEdits
        }
        event.waitUntil(willSaveWaitUntil())
      }
    }, null, 'languageserver')
    workspace.ready.then(() => {
      this.loadCompleteConfig()
    })
    workspace.onDidChangeConfiguration(this.loadCompleteConfig, this)
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private loadCompleteConfig(): void {
    let config = workspace.getConfiguration('coc.preferences')
    let suggest = workspace.getConfiguration('suggest')
    function getConfig<T>(key, defaultValue: T): T {
      return config.get<T>(key, suggest.get<T>(key, defaultValue))
    }
    this.completeConfig = {
      priority: getConfig<number>('languageSourcePriority', 99),
      echodocSupport: getConfig<boolean>('echodocSupport', false),
      waitTime: getConfig<number>('triggerCompletionWait', 60),
      invalidInsertCharacters: getConfig<string[]>('invalidInsertCharacters', ["<", "(", ":", " "])
    }
  }

  public registerOnTypeFormattingEditProvider(
    selector: DocumentSelector,
    provider: OnTypeFormattingEditProvider,
    triggerCharacters: string[]
  ): Disposable {
    return this.onTypeFormatManager.register(selector, provider, triggerCharacters)
  }

  public registerCompletionItemProvider(
    name: string,
    shortcut: string,
    languageIds: string | string[] | null,
    provider: CompletionItemProvider,
    triggerCharacters: string[] = [],
    priority?: number
  ): Disposable {
    languageIds = typeof languageIds == 'string' ? [languageIds] : languageIds
    let source = this.createCompleteSource(name, shortcut, provider, languageIds, triggerCharacters, priority)
    sources.addSource(source)
    logger.debug('created service source', name)
    return {
      dispose: () => {
        sources.removeSource(source)
      }
    }
  }

  public registerCodeActionProvider(selector: DocumentSelector, provider: CodeActionProvider, clientId: string, codeActionKinds?: CodeActionKind[]): Disposable {
    return this.codeActionManager.register(selector, provider, clientId, codeActionKinds)
  }

  public registerHoverProvider(selector: DocumentSelector, provider: HoverProvider): Disposable {
    return this.hoverManager.register(selector, provider)
  }

  public registerSignatureHelpProvider(
    selector: DocumentSelector,
    provider: SignatureHelpProvider,
    triggerCharacters?: string[]): Disposable {
    return this.signatureManager.register(selector, provider, triggerCharacters)
  }

  public registerDocumentSymbolProvider(selector: DocumentSelector, provider: DocumentSymbolProvider): Disposable {
    return this.documentSymbolManager.register(selector, provider)
  }

  public registerFoldingRangeProvider(selector: DocumentSelector, provider: FoldingRangeProvider): Disposable {
    return this.foldingRangeManager.register(selector, provider)
  }

  public registerDocumentHighlightProvider(selector: DocumentSelector, provider: any): Disposable {
    return this.documentHighlightManager.register(selector, provider)
  }

  public registerCodeLensProvider(selector: DocumentSelector, provider: CodeLensProvider): Disposable {
    return this.codeLensManager.register(selector, provider)
  }

  public registerDocumentLinkProvider(selector: DocumentSelector, provider: DocumentLinkProvider): Disposable {
    return this.documentLinkManager.register(selector, provider)
  }

  public registerDocumentColorProvider(selector: DocumentSelector, provider: DocumentColorProvider): Disposable {
    return this.documentColorManager.register(selector, provider)
  }

  public registerDefinitionProvider(selector: DocumentSelector, provider: DefinitionProvider): Disposable {
    return this.definitionManager.register(selector, provider)
  }

  public registerDeclarationProvider(selector: DocumentSelector, provider: DeclarationProvider): Disposable {
    return this.declarationManager.register(selector, provider)
  }

  public registerTypeDefinitionProvider(selector: DocumentSelector, provider: TypeDefinitionProvider): Disposable {
    return this.typeDefinitionManager.register(selector, provider)
  }

  public registerImplementationProvider(selector: DocumentSelector, provider: ImplementationProvider): Disposable {
    return this.implementatioinManager.register(selector, provider)
  }

  public registerReferencesProvider(selector: DocumentSelector, provider: ReferenceProvider): Disposable {
    return this.referenceManager.register(selector, provider)
  }

  public registerRenameProvider(selector: DocumentSelector, provider: RenameProvider): Disposable {
    return this.renameManager.register(selector, provider)
  }

  public registerWorkspaceSymbolProvider(selector: DocumentSelector, provider: WorkspaceSymbolProvider): Disposable {
    return this.workspaceSymbolsManager.register(selector, provider)
  }

  public registerDocumentFormatProvider(selector: DocumentSelector, provider: DocumentFormattingEditProvider, priority = 0): Disposable {
    return this.formatManager.register(selector, provider, priority)
  }

  public registerDocumentRangeFormatProvider(selector: DocumentSelector, provider: DocumentRangeFormattingEditProvider, priority = 0): Disposable {
    return this.formatRangeManager.register(selector, provider, priority)
  }

  public shouldTriggerSignatureHelp(document: TextDocument, triggerCharacter: string): boolean {
    return this.signatureManager.shouldTrigger(document, triggerCharacter)
  }

  @check
  public async getHover(document: TextDocument, position: Position): Promise<Hover> {
    return await this.hoverManager.provideHover(document, position, this.token)
  }

  @check
  public async getSignatureHelp(document: TextDocument, position: Position): Promise<SignatureHelp> {
    return await this.signatureManager.provideSignatureHelp(document, position, this.token)
  }

  @check
  public async getDefinition(document: TextDocument, position: Position): Promise<Location[]> {
    if (!this.definitionManager.hasProvider(document)) {
      workspace.showMessage('Definition provider not found for current document', 'error')
      return null
    }
    return await this.definitionManager.provideDefinition(document, position, this.token)
  }

  @check
  public async getDeclaration(document: TextDocument, position: Position): Promise<Location[] | Location | LocationLink[] | null> {
    if (!this.declarationManager.hasProvider(document)) {
      workspace.showMessage('Declaration provider not found for current document', 'error')
      return null
    }
    return await this.declarationManager.provideDeclaration(document, position, this.token)
  }

  @check
  public async getTypeDefinition(document: TextDocument, position: Position): Promise<Location[]> {
    if (!this.typeDefinitionManager.hasProvider(document)) {
      workspace.showMessage('Type definition provider not found for current document', 'error')
      return null
    }
    return await this.typeDefinitionManager.provideTypeDefinition(document, position, this.token)
  }

  @check
  public async getImplementation(document: TextDocument, position: Position): Promise<Location[]> {
    if (!this.implementatioinManager.hasProvider(document)) {
      workspace.showMessage('Implementation provider not found for current document', 'error')
      return null
    }
    return await this.implementatioinManager.provideReferences(document, position, this.token)
  }

  @check
  public async getReferences(document: TextDocument, context: ReferenceContext, position: Position): Promise<Location[]> {
    if (!this.referenceManager.hasProvider(document)) {
      workspace.showMessage('References provider not found for current document', 'error')
      return null
    }
    return await this.referenceManager.provideReferences(document, position, context, this.token)
  }

  @check
  public async getDocumentSymbol(document: TextDocument): Promise<SymbolInformation[] | DocumentSymbol[]> {
    return await this.documentSymbolManager.provideDocumentSymbols(document, this.token)
  }

  @check
  public async getWorkspaceSymbols(document: TextDocument, query: string): Promise<SymbolInformation[]> {
    query = query || ''
    return await this.workspaceSymbolsManager.provideWorkspaceSymbols(document, query, this.token)
  }

  @check
  public async resolveWorkspaceSymbol(symbol: SymbolInformation): Promise<SymbolInformation> {
    return await this.workspaceSymbolsManager.resolveWorkspaceSymbol(symbol, this.token)
  }

  @check
  public async provideRenameEdits(document: TextDocument, position: Position, newName: string): Promise<WorkspaceEdit> {
    if (!this.renameManager.hasProvider(document)) {
      let doc = workspace.getDocument(document.uri)
      if (!doc) return null
      let range = doc.getWordRangeAtPosition(position)
      if (!range) return null
      let word = doc.textDocument.getText(range)
      let ranges = doc.getSymbolRanges(word)
      if (!ranges.length) return null
      return {
        changes: {
          [doc.uri]: ranges.map(r => {
            return {
              range: r,
              newText: newName
            }
          })
        }
      }
    }
    return await this.renameManager.provideRenameEdits(document, position, newName, this.token)
  }

  @check
  public async prepareRename(document: TextDocument, position: Position): Promise<Range | { range: Range; placeholder: string } | false> {
    return await this.renameManager.prepareRename(document, position, this.token)
  }

  @check
  public async provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions): Promise<TextEdit[]> {
    if (!this.formatManager.hasProvider(document)) {
      workspace.showMessage('Format provider not found for current document', 'error')
      return null
    }
    return await this.formatManager.provideDocumentFormattingEdits(document, options, this.token)
  }

  @check
  public async provideDocumentRangeFormattingEdits(document: TextDocument, range: Range, options: FormattingOptions): Promise<TextEdit[]> {
    if (!this.formatRangeManager.hasProvider(document)) {
      workspace.showMessage('Range format provider not found for current document', 'error')
      return null
    }
    return await this.formatRangeManager.provideDocumentRangeFormattingEdits(document, range, options, this.token)
  }

  /**
   * Get CodeAction list for current document
   *
   * @public
   * @param {TextDocument} document
   * @param {Range} range
   * @param {CodeActionContext} context
   * @returns {Promise<CodeAction[]>}
   */
  @check
  public async getCodeActions(document: TextDocument, range: Range, context: CodeActionContext, silent = false): Promise<Map<string, CodeAction[]>> {
    if (!silent && !this.codeActionManager.hasProvider(document)) {
      workspace.showMessage('Code action provider not found for current document', 'error')
      return null
    }
    return await this.codeActionManager.provideCodeActions(document, range, context, this.token)
  }

  @check
  public async getDocumentHighLight(document: TextDocument, position: Position): Promise<DocumentHighlight[]> {
    return await this.documentHighlightManager.provideDocumentHighlights(document, position, this.token)
  }

  @check
  public async getDocumentLinks(document: TextDocument): Promise<DocumentLink[]> {
    if (!this.documentLinkManager.hasProvider(document)) {
      return null
    }
    return (await this.documentLinkManager.provideDocumentLinks(document, this.token)) || []
  }

  @check
  public async resolveDocumentLink(link: DocumentLink): Promise<DocumentLink> {
    return await this.documentLinkManager.resolveDocumentLink(link, this.token)
  }

  @check
  public async provideDocumentColors(document: TextDocument): Promise<ColorInformation[] | null> {
    return await this.documentColorManager.provideDocumentColors(document, this.token)
  }

  @check
  public async provideFoldingRanges(document: TextDocument, context: FoldingContext): Promise<FoldingRange[] | null> {
    if (!this.formatRangeManager.hasProvider(document)) {
      workspace.showMessage('Folding ranges provider not found for current document', 'error')
      return null
    }
    return await this.foldingRangeManager.provideFoldingRanges(document, context, this.token)
  }

  @check
  public async provideColorPresentations(color: ColorInformation, document: TextDocument, ): Promise<ColorPresentation[]> {
    return await this.documentColorManager.provideColorPresentations(color, document, this.token)
  }

  @check
  public async getCodeLens(document: TextDocument): Promise<CodeLens[]> {
    return await this.codeLensManager.provideCodeLenses(document, this.token)
  }

  @check
  public async resolveCodeLens(codeLens: CodeLens): Promise<CodeLens> {
    return await this.codeLensManager.resolveCodeLens(codeLens, this.token)
  }

  @check
  public async provideDocumentOntTypeEdits(character: string, document: TextDocument, position: Position): Promise<TextEdit[] | null> {
    return this.onTypeFormatManager.onCharacterType(character, document, position, this.token)
  }

  public hasOnTypeProvider(character: string, document: TextDocument): boolean {
    return this.onTypeFormatManager.getProvider(document, character) != null
  }

  public dispose(): void {
    // noop
  }

  public createDiagnosticCollection(owner: string): DiagnosticCollection {
    return diagnosticManager.create(owner)
  }

  private createCompleteSource(
    name: string,
    shortcut: string,
    provider: CompletionItemProvider,
    languageIds: string[] | null,
    triggerCharacters: string[],
    priority?: number
  ): ISource {
    // track them for resolve
    let completeItems: CompletionItem[] = []
    // line used for TextEdit
    let hasResolve = typeof provider.resolveCompletionItem === 'function'
    priority = priority == null ? this.completeConfig.priority : priority
    // index set of resolved items
    let resolvedIndexes: Set<number> = new Set()
    let doc: Document = null
    let waitTime = Math.min(Math.max(50, this.completeConfig.waitTime), 300)
    let source: ISource = {
      name,
      priority,
      enable: true,
      sourceType: SourceType.Service,
      filetypes: languageIds,
      triggerCharacters: triggerCharacters || [],
      doComplete: async (opt: CompleteOption, token: CancellationToken): Promise<CompleteResult | null> => {
        let { triggerCharacter, bufnr } = opt
        doc = workspace.getDocument(bufnr)
        if (!doc) return null
        resolvedIndexes = new Set()
        let isTrigger = triggerCharacters && triggerCharacters.indexOf(triggerCharacter) != -1
        let triggerKind: CompletionTriggerKind = CompletionTriggerKind.Invoked
        if (opt.triggerForInComplete) {
          triggerKind = CompletionTriggerKind.TriggerForIncompleteCompletions
        } else if (isTrigger) {
          triggerKind = CompletionTriggerKind.TriggerCharacter
        }
        if (opt.triggerCharacter) await wait(waitTime)
        if (token.isCancellationRequested) return null
        let position = complete.getPosition(opt)
        let context: CompletionContext = { triggerKind, option: opt }
        if (isTrigger) context.triggerCharacter = triggerCharacter
        let result = await Promise.resolve(provider.provideCompletionItems(doc.textDocument, position, token, context))
        if (!result || token.isCancellationRequested) return null
        completeItems = Array.isArray(result) ? result : result.items
        if (!completeItems || completeItems.length == 0) return null
        // used for fixed col
        let option: CompleteOption = Object.assign({}, opt)
        if (typeof (result as any).startcol == 'number') {
          option.col = (result as any).startcol
        }
        let items: VimCompleteItem[] = completeItems.map((o, index) => {
          let item = this.convertVimCompleteItem(o, shortcut, option)
          item.index = index
          return item
        })
        return {
          startcol: (result as any).startcol,
          isIncomplete: !!(result as CompletionList).isIncomplete,
          items
        }
      },
      onCompleteResolve: async (item: VimCompleteItem, token: CancellationToken): Promise<void> => {
        let resolving = completeItems[item.index]
        if (!resolving) return
        if (hasResolve && !resolvedIndexes.has(item.index)) {
          let resolved = await Promise.resolve(provider.resolveCompletionItem(resolving, token))
          if (token.isCancellationRequested) return
          resolvedIndexes.add(item.index)
          if (resolved) Object.assign(resolving, resolved)
        }
        if (item.documentation == null) {
          let { documentation, detail } = resolving
          if (!documentation && !detail) return
          // detail should be single line
          if (detail) detail = detail.trim().replace(/\n\s*/g, ' ')
          let content = documentation && MarkupContent.is(documentation) ? documentation.value : documentation || ''
          let isMarkdown = documentation && MarkupContent.is(documentation) && documentation.kind == 'markdown'
          let sep = detail && content ? '\n---\n' : ''
          let value = `${detail || ''}${sep}${content || ''}`.trim()
          if (value == item.word) {
            item.documentation = { kind: 'plaintext', value: '' }
            return
          }
          item.documentation = { kind: isMarkdown ? 'markdown' : 'plaintext', value }
          item.hasDetail = detail && detail.length > 0
        }
      },
      onCompleteDone: async (vimItem: VimCompleteItem, opt: CompleteOption): Promise<void> => {
        let item = completeItems[vimItem.index]
        if (!item) return
        let line = opt.linenr - 1
        // use TextEdit for snippet item
        if (vimItem.isSnippet && !item.textEdit) {
          item.textEdit = {
            range: Range.create(line, opt.col, line, opt.colnr - 1),
            // tslint:disable-next-line: deprecation
            newText: item.insertText || item.label
          }
        }
        let snippet = await this.applyTextEdit(item, opt)
        let { additionalTextEdits } = item
        await this.applyAdditionalEdits(additionalTextEdits, opt.bufnr, snippet)
        if (snippet) await snippetManager.selectCurrentPlaceholder()
        if (item.command) commands.execute(item.command)
      },
      shouldCommit: (item: VimCompleteItem, character: string): boolean => {
        let completeItem = completeItems[item.index]
        if (!completeItem) return false
        let { commitCharacters } = completeItem
        if (commitCharacters && commitCharacters.indexOf(character) !== -1) {
          return true
        }
        return false
      }
    }
    return source
  }

  private get token(): CancellationToken {
    this.cancelTokenSource = new CancellationTokenSource()
    return this.cancelTokenSource.token
  }

  private async applyTextEdit(item: CompletionItem, option: CompleteOption): Promise<boolean> {
    let { nvim } = this
    let { textEdit } = item
    if (!textEdit) return false
    let { line, bufnr, linenr } = option
    let { range, newText } = textEdit
    let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet
    // replace inserted word
    let start = line.substr(0, range.start.character)
    let end = line.substr(range.end.character)
    if (isSnippet) {
      let doc = workspace.getDocument(bufnr)
      await doc.applyEdits(nvim, [{
        range: Range.create(linenr - 1, 0, linenr, 0),
        newText: `${start}${end}\n`
      }])
      // can't select, since additionalTextEdits would break selection
      return await snippetManager.insertSnippet(newText, false, Position.create(linenr - 1, range.start.character))
    }
    let newLines = `${start}${newText}${end}`.split('\n')
    if (newLines.length == 1) {
      await nvim.call('coc#util#setline', [linenr, newLines[0]])
      await workspace.moveTo(Position.create(linenr - 1, (start + newText).length))
    } else {
      let document = workspace.getDocument(bufnr)
      if (document) {
        await document.buffer.setLines(newLines, {
          start: linenr - 1,
          end: linenr,
          strictIndexing: false
        })
      }
      let line = linenr - 1 + newLines.length - 1
      let character = newLines[newLines.length - 1].length - end.length
      await workspace.moveTo({ line, character })
    }
    return false
  }

  private async applyAdditionalEdits(
    textEdits: TextEdit[],
    bufnr: number,
    snippet: boolean): Promise<void> {
    if (!textEdits || textEdits.length == 0) return
    let document = workspace.getDocument(bufnr)
    if (!document) return
    if (workspace.isVim) await document.fetchContent()
    let changed = { line: 0, character: 0 }
    let pos = await workspace.getCursorPosition()
    if (!snippet) {
      for (let edit of textEdits) {
        let d = getChangedPosition(pos, edit)
        changed = { line: changed.line + d.line, character: changed.character + d.character }
      }
    }
    await document.applyEdits(this.nvim, textEdits)
    if (changed.line != 0 || changed.character != 0) {
      await workspace.moveTo(Position.create(pos.line + changed.line, pos.character + changed.character))
    }
  }

  private convertVimCompleteItem(item: CompletionItem, shortcut: string, opt: CompleteOption): VimCompleteItem {
    let { echodocSupport } = this.completeConfig
    let hasAdditionalEdit = item.additionalTextEdits && item.additionalTextEdits.length > 0
    let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet || hasAdditionalEdit
    let label = item.label.trim()
    // tslint:disable-next-line:deprecation
    if (isSnippet && item.insertText && item.insertText.indexOf('$') == -1 && !hasAdditionalEdit) {
      // fix wrong insert format
      isSnippet = false
      item.insertTextFormat = InsertTextFormat.PlainText
    }
    let obj: VimCompleteItem = {
      word: complete.getWord(item, opt, this.completeConfig.invalidInsertCharacters),
      abbr: label,
      menu: `[${shortcut}]`,
      kind: complete.completionKindString(item.kind),
      sortText: item.sortText || null,
      filterText: item.filterText || label,
      isSnippet,
      dup: 1
    }
    if (item.kind == CompletionItemKind.Folder && !obj.abbr.endsWith('/')) {
      obj.abbr = obj.abbr + '/'
    }
    if (echodocSupport && item.kind >= 2 && item.kind <= 4) {
      let fields = [item.detail || '', obj.abbr, obj.word]
      for (let s of fields) {
        if (s.indexOf('(') !== -1) {
          obj.signature = s
          break
        }
      }
    }
    if (item.preselect) obj.preselect = true
    item.data = item.data || {}
    if (item.data.optional) obj.abbr = obj.abbr + '?'
    return obj
  }
}

export default new Languages()

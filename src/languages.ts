import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, CodeAction, CodeActionContext, CodeLens, ColorInformation, ColorPresentation, CompletionItem, CompletionList, Disposable, DocumentHighlight, DocumentLink, DocumentSelector, DocumentSymbol, FoldingRange, FormattingOptions, Hover, InsertTextFormat, Location, Position, Range, SignatureHelp, SymbolInformation, TextDocument, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import commands from './commands'
import completion from './completion'
import diagnosticManager from './diagnostic/manager'
import { CodeActionProvider, CodeLensProvider, CompletionContext, CompletionItemProvider, CompletionTriggerKind, DefinitionProvider, DocumentColorProvider, DocumentFormattingEditProvider, DocumentLinkProvider, DocumentRangeFormattingEditProvider, DocumentSymbolProvider, FoldingContext, FoldingRangeProvider, HoverProvider, ImplementationProvider, OnTypeFormattingEditProvider, ReferenceContext, ReferenceProvider, RenameProvider, SignatureHelpProvider, TypeDefinitionProvider, WorkspaceSymbolProvider } from './provider'
import CodeActionManager from './provider/codeActionmanager'
import CodeLensManager from './provider/codeLensManager'
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
import snippetManager from './snippet/manager'
import sources from './sources'
import { CompleteOption, CompleteResult, DiagnosticCollection, ISource, SourceType, VimCompleteItem } from './types'
import { echoMessage } from './util'
import workspace from './workspace'
const logger = require('./util/logger')('languages')

export interface CompletionSource {
  id: string
  source: ISource
  languageIds: string[]
}

export function check<R extends (...args: any[]) => Promise<R>>(_target: any, _key: string, descriptor: any): void {
  let fn = descriptor.value
  if (typeof fn !== 'function') {
    return
  }

  descriptor.value = function(...args): Promise<R> {
    let { cancelTokenSource } = this
    this.cancelTokenSource = new CancellationTokenSource()
    return new Promise((resolve, reject): void => { // tslint:disable-line
      let resolved = false
      let timer = setTimeout(() => {
        cancelTokenSource.cancel()
        if (!resolved) reject(new Error('timeout after 3s'))
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
  private DocumentHighlightManager = new DocumentHighlightManager()
  private definitionManager = new DefinitionManager()
  private typeDefinitionManager = new TypeDefinitionManager()
  private referenceManager = new ReferenceManager()
  private implementatioinManager = new ImplementationManager()
  private codeLensManager = new CodeLensManager()
  private cancelTokenSource: CancellationTokenSource = new CancellationTokenSource()

  private get nvim(): Neovim {
    return workspace.nvim
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
    languageIds: string | string[],
    provider: CompletionItemProvider,
    triggerCharacters?: string[]
  ): Disposable {
    languageIds = typeof languageIds == 'string' ? [languageIds] : languageIds
    let source = this.createCompleteSource(name, shortcut, provider, languageIds, triggerCharacters)
    sources.addSource(name, source)
    logger.debug('created service source', name)
    return {
      dispose: () => {
        sources.removeSource(source)
      }
    }
  }

  public registerCodeActionProvider(selector: DocumentSelector, provider: CodeActionProvider): Disposable {
    return this.codeActionManager.register(selector, provider)
  }

  public registerHoverProvider(selector, provider: HoverProvider): Disposable {
    return this.hoverManager.register(selector, provider)
  }

  public registerSignatureHelpProvider(
    selector: DocumentSelector,
    provider: SignatureHelpProvider,
    triggerCharacters?: string[]): Disposable {
    return this.signatureManager.register(selector, provider, triggerCharacters)
  }

  public registerDocumentSymbolProvider(selector, provider: DocumentSymbolProvider): Disposable {
    return this.documentSymbolManager.register(selector, provider)
  }

  public registerFoldingRangeProvider(selector: DocumentSelector, provider: FoldingRangeProvider): Disposable {
    return this.foldingRangeManager.register(selector, provider)
  }

  public registerDocumentHighlightProvider(selector, provider: any): Disposable {
    return this.DocumentHighlightManager.register(selector, provider)
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

  public registerDocumentFormatProvider(selector: DocumentSelector, provider: DocumentFormattingEditProvider): Disposable {
    return this.formatManager.register(selector, provider)
  }

  public registerDocumentRangeFormatProvider(selector: DocumentSelector, provider: DocumentRangeFormattingEditProvider): Disposable {
    return this.formatRangeManager.register(selector, provider)
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
    return await this.definitionManager.provideDefinition(document, position, this.token)
  }

  @check
  public async getTypeDefinition(document: TextDocument, position: Position): Promise<Location[]> {
    return await this.typeDefinitionManager.provideTypeDefinition(document, position, this.token)
  }

  @check
  public async getImplementation(document: TextDocument, position: Position): Promise<Location[]> {
    return await this.implementatioinManager.provideReferences(document, position, this.token)
  }

  @check
  public async getReferences(document: TextDocument, context: ReferenceContext, position: Position): Promise<Location[]> {
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
    return await this.renameManager.provideRenameEdits(document, position, newName, this.token)
  }

  @check
  public async prepareRename(document: TextDocument, position: Position): Promise<Range | { range: Range; placeholder: string }> {
    return await this.renameManager.prepareRename(document, position, this.token)
  }

  @check
  public async provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions): Promise<TextEdit[]> {
    return await this.formatManager.provideDocumentFormattingEdits(document, options, this.token)
  }

  @check
  public async provideDocumentRangeFormattingEdits(document: TextDocument, range: Range, options: FormattingOptions): Promise<TextEdit[]> {
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
  public async getCodeActions(document: TextDocument, range: Range, context: CodeActionContext): Promise<CodeAction[]> {
    return await this.codeActionManager.provideCodeActions(document, range, context, this.token)
  }

  @check
  public async getDocumentHighLight(document: TextDocument, position: Position): Promise<DocumentHighlight[]> {
    return await this.DocumentHighlightManager.provideDocumentHighlights(document, position, this.token)
  }

  @check
  public async getDocumentLinks(document: TextDocument): Promise<DocumentLink[]> {
    return await this.documentLinkManager.provideDocumentLinks(document, this.token)
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
  public async provideDocumentTypeEdits(character: string, document: TextDocument, position: Position): Promise<TextEdit[] | null> {
    return this.onTypeFormatManager.onCharacterType(character, document, position, this.token)
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
    languageIds: string[],
    triggerCharacters: string[],
  ): ISource {
    // track them for resolve
    let completeItems: CompletionItem[] = []
    let hasResolve = typeof provider.resolveCompletionItem === 'function'
    let resolving: string
    let option: CompleteOption
    let preferences = workspace.getConfiguration('coc.preferences')
    let priority = preferences.get('languageSourcePriority', 9)

    function resolveItem(item: VimCompleteItem): CompletionItem {
      if (!completeItems || completeItems.length == 0) return null
      let { word } = item
      return completeItems.find(o => {
        return word == o.insertText || word == o.label // tslint:disable-line
      })
    }
    return {
      name,
      enable: true,
      priority,
      sourceType: SourceType.Service,
      filetypes: languageIds,
      triggerCharacters: triggerCharacters || [],
      onCompleteResolve: async (item: VimCompleteItem): Promise<void> => {
        if (!hasResolve) return
        if (completeItems.length == 0) return
        if (resolving) {
          this.cancelTokenSource.cancel()
        }
        resolving = item.word
        let resolved: CompletionItem
        let prevItem = resolveItem(item)
        if (!prevItem) return
        prevItem.data = prevItem.data || {}
        if (!prevItem) return
        if (prevItem.data.resolved) {
          resolved = prevItem
        } else {
          prevItem.data.resolving = true
          let token = this.token
          resolved = await Promise.resolve(provider.resolveCompletionItem(prevItem, this.token))
          prevItem.data.resolving = false
          if (!resolved || token.isCancellationRequested) return
          resolved.data = Object.assign(resolved.data || {}, {
            resolving: false,
            resolved: true
          })
        }
        let visible = await this.nvim.call('pumvisible')
        if (visible != 0 && resolving == item.word) {
          // vim have no suppport for update complete item
          let str = resolved.detail ? resolved.detail.trim() : ''
          echoMessage(this.nvim, str)
          let doc = completion.getDocumentation(resolved)
          if (doc) str += '\n\n' + doc
          if (str.length) {
            // TODO vim has bug with layout change on pumvisible
            // this.nvim.call('coc#util#preview_info', [str]) // tslint:disable-line
          }
        }
        resolving = null
      },
      onCompleteDone: async (item: VimCompleteItem): Promise<void> => {
        let completeItem = resolveItem(item)
        if (!completeItem) return
        let timeout = workspace.isVim ? 100 : 30
        setTimeout(async () => {
          try {
            let isConfirm = await this.checkConfirm(completeItem, option)
            if (!isConfirm) return
            let hasSnippet = await this.applyTextEdit(completeItem, option)
            let { additionalTextEdits } = completeItem
            await this.applyAdditionaLEdits(additionalTextEdits, option.bufnr)
            // start snippet listener after additionalTextEdits
            if (hasSnippet) await snippetManager.attach()
            let { command } = completeItem
            if (command) commands.execute(command)
          } catch (e) {
            logger.error(e.stack)
          }
          option = null
          completeItems = []
          resolving = ''
        }, timeout)
        return
      },
      doComplete: async (opt: CompleteOption): Promise<CompleteResult | null> => {
        option = opt
        let { triggerCharacter, bufnr } = opt
        let doc = workspace.getDocument(bufnr)
        let document = doc.textDocument
        let position = completion.getPosition(opt)
        let context: CompletionContext = {
          triggerKind: triggerCharacter ? CompletionTriggerKind.Invoke : CompletionTriggerKind.TriggerCharacter,
          triggerCharacter
        }
        let cancellSource = new CancellationTokenSource()
        let result = await Promise.resolve(provider.provideCompletionItems(document, position, cancellSource.token, context))
        if (!result) return null
        let isIncomplete = (result as CompletionList).isIncomplete || false
        completeItems = Array.isArray(result) ? result : result.items
        let res = {
          isIncomplete,
          items: completeItems.map(o => completion.convertVimCompleteItem(o, shortcut))
        }
        if (typeof (result as any).startcol === 'number' && (result as any).startcol != opt.col) {
          (res as any).startcol = (result as any).startcol
          option.col = (result as any).startcol
        }
        return res
      }
    }
  }

  public match(documentSelector: DocumentSelector, document: TextDocument): boolean {
    if (documentSelector.length == 0) {
      return false
    }
    let languageIds = documentSelector.map(filter => {
      if (typeof filter == 'string') {
        return filter
      }
      return filter.language
    })
    languageIds = languageIds.filter(s => s != null)
    if (languageIds.length == 0) return false
    let { languageId } = document
    return languageIds.indexOf(languageId) != -1
  }

  private get token(): CancellationToken {
    let token = this.cancelTokenSource.token
    if (token.isCancellationRequested) {
      this.cancelTokenSource = new CancellationTokenSource()
      token = this.cancelTokenSource.token
    }
    return token
  }

  private async checkConfirm(item: CompletionItem, option: CompleteOption): Promise<boolean> {
    let { col } = option
    let { nvim } = this
    let mode = await nvim.call('mode')
    if (mode !== 'i') return false
    let curcol = await nvim.call('col', ['.'])
    let label = item.insertText || item.label // tslint:disable-line
    if (curcol != col + label.length + 1) return false
    return true
  }

  private async applyTextEdit(item: CompletionItem, option: CompleteOption): Promise<boolean> {
    let { nvim } = this
    let { textEdit } = item
    if (!textEdit) return false
    let { range, newText } = textEdit
    let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet
    let document = workspace.getDocument(option.bufnr)
    if (!document) return false
    let line = document.getline(option.linenr - 1)
    let deleteCount = range.end.character - option.colnr + 1
    let character = range.start.character
    // replace inserted word
    let start = line.substr(0, character)
    let label = item.insertText || item.label // tslint:disable-line
    let end = line.substr(option.col + label.length + deleteCount)
    let newLine = `${start}${newText}${end}`
    if (isSnippet) {
      await snippetManager.insertSnippet(document, option.linenr - 1, newText, start, end)
      return true
    }
    if (newLine != line) {
      await nvim.call('setline', [option.linenr, newLine])
    }
    return false
  }

  private async applyAdditionaLEdits(textEdits: TextEdit[], bufnr: number): Promise<void> {
    if (!textEdits || textEdits.length == 0) return
    let document = workspace.getDocument(bufnr)
    if (!document) return
    await document.applyEdits(this.nvim, textEdits)
  }
}

export default new Languages()

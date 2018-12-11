import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, CodeAction, CodeActionContext, CodeActionKind, CodeLens, ColorInformation, ColorPresentation, CompletionItem, CompletionList, CompletionTriggerKind, Disposable, DocumentHighlight, DocumentLink, DocumentSelector, DocumentSymbol, FoldingRange, FormattingOptions, Hover, InsertTextFormat, Location, Position, Range, SignatureHelp, SymbolInformation, TextDocument, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import commands from './commands'
import diagnosticManager from './diagnostic/manager'
import { CodeActionProvider, CodeLensProvider, CompletionItemProvider, DefinitionProvider, DocumentColorProvider, DocumentFormattingEditProvider, DocumentLinkProvider, DocumentRangeFormattingEditProvider, DocumentSymbolProvider, FoldingContext, FoldingRangeProvider, HoverProvider, ImplementationProvider, OnTypeFormattingEditProvider, ReferenceContext, ReferenceProvider, RenameProvider, SignatureHelpProvider, TypeDefinitionProvider, WorkspaceSymbolProvider } from './provider'
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
import snippetManager from './snippets/manager'
import { ExtensionSnippetProvider } from './snippets/provider'
import sources from './sources'
import { CompleteOption, CompleteResult, CompletionContext, DiagnosticCollection, ISource, SourceType, VimCompleteItem } from './types'
import { echoMessage, wait } from './util'
import * as complete from './util/complete'
import { mixin } from './util/object'
import { byteLength } from './util/string'
import workspace from './workspace'
const logger = require('./util/logger')('languages')

export interface CompletionSource {
  id: string
  source: ISource
  languageIds: string[]
}

export function check<R extends (...args: any[]) => Promise<R>>(_target: any, key: string, descriptor: any): void {
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
  private typeDefinitionManager = new TypeDefinitionManager()
  private referenceManager = new ReferenceManager()
  private implementatioinManager = new ImplementationManager()
  private codeLensManager = new CodeLensManager()
  private cancelTokenSource: CancellationTokenSource = new CancellationTokenSource()
  private resolveTokenSource: CancellationTokenSource

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

    workspace.onDidWorkspaceInitialized(() => {
      let provider = new ExtensionSnippetProvider()
      snippetManager.registerSnippetProvider(provider)
      let completionProvider: CompletionItemProvider = {
        provideCompletionItems: async (
          document: TextDocument,
          position: Position,
          _token: CancellationToken,
          context: CompletionContext
        ): Promise<CompletionItem[]> => {
          let { languageId } = document
          let { synname, input } = context.option!
          if (input.length == 0 || /string/i.test(synname) || /comment/i.test(synname)) {
            return []
          }
          let snippets = await snippetManager.getSnippetsForLanguage(languageId)
          let res: CompletionItem[] = []
          for (let snip of snippets) {
            res.push({
              label: snip.prefix,
              detail: snip.description,
              filterText: snip.prefix,
              documentation: complete.getSnippetDocumentation(document.languageId, snip.body),
              insertTextFormat: InsertTextFormat.Snippet,
              textEdit: TextEdit.replace(
                Range.create({ line: position.line, character: context.option!.col }, position), snip.body
              )
            })
          }
          return res
        }
      }
      this.registerCompletionItemProvider('snippets', 'S', null, completionProvider, [], 100)
    })
  }

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
    if (!this.documentSymbolManager.hasProvider(document)) {
      workspace.showMessage('Document symbol provider not found for current document', 'error')
      return null
    }
    return await this.documentSymbolManager.provideDocumentSymbols(document, this.token)
  }

  @check
  public async getWorkspaceSymbols(document: TextDocument, query: string): Promise<SymbolInformation[]> {
    query = query || ''
    if (!this.workspaceSymbolsManager.hasProvider(document)) {
      workspace.showMessage('Workspace symbols provider not found for current document', 'error')
      return null
    }
    return await this.workspaceSymbolsManager.provideWorkspaceSymbols(document, query, this.token)
  }

  @check
  public async resolveWorkspaceSymbol(symbol: SymbolInformation): Promise<SymbolInformation> {
    return await this.workspaceSymbolsManager.resolveWorkspaceSymbol(symbol, this.token)
  }

  @check
  public async provideRenameEdits(document: TextDocument, position: Position, newName: string): Promise<WorkspaceEdit> {
    if (!this.renameManager.hasProvider(document)) {
      workspace.showMessage('Rename provider not found for current document', 'error')
      return null
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
  public async getCodeActions(document: TextDocument, range: Range, context: CodeActionContext): Promise<Map<string, CodeAction[]>> {
    if (!this.codeActionManager.hasProvider(document)) {
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
      workspace.showMessage('Document link provider not found for current document', 'error')
      return null
    }
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
    let resolveInput: string
    let option: CompleteOption
    // column number on doComplete
    let colnr: number
    // line used for TextEdit
    let currLine: string
    let preferences = workspace.getConfiguration('coc.preferences')
    priority = priority == null ? preferences.get<number>('languageSourcePriority', 99) : priority
    let echodocSupport = preferences.get<boolean>('echodocSupport', false)
    let waitTime = preferences.get<number>('triggerCompletionWait', 60)
    let source = {
      name,
      priority,
      enable: true,
      duplicate: false,
      sourceType: SourceType.Service,
      filetypes: languageIds,
      triggerCharacters: triggerCharacters || [],
      doComplete: async (opt: CompleteOption): Promise<CompleteResult | null> => {
        option = opt
        let { triggerCharacter, bufnr } = opt
        let doc = workspace.getDocument(bufnr)
        if (!doc) return null
        colnr = option.colnr
        currLine = option.line
        let isTrigger = triggerCharacters && triggerCharacters.indexOf(triggerCharacter) != -1
        let triggerKind: CompletionTriggerKind = CompletionTriggerKind.Invoked
        if (opt.triggerForInComplete) {
          triggerKind = CompletionTriggerKind.TriggerForIncompleteCompletions
        } else if (isTrigger) {
          triggerKind = CompletionTriggerKind.TriggerCharacter
        }
        if (triggerKind != CompletionTriggerKind.Invoked) await wait(waitTime)
        let position = complete.getPosition(opt)
        let context: CompletionContext = { triggerKind, option: opt }
        if (isTrigger) context.triggerCharacter = triggerCharacter
        let cancellSource = new CancellationTokenSource()
        let result = await Promise.resolve(provider.provideCompletionItems(doc.textDocument, position, cancellSource.token, context))
        if (!result) return null
        completeItems = Array.isArray(result) ? result : result.items
        if (!completeItems) return null
        let items: VimCompleteItem[] = completeItems.map((o, index) => {
          let item = complete.convertVimCompleteItem(o, shortcut, echodocSupport, opt)
          item.index = index
          return item
        })
        return { isIncomplete: !!(result as CompletionList).isIncomplete, items }
      },
      onCompleteResolve: async (item: VimCompleteItem): Promise<void> => {
        if (completeItems.length == 0) return
        resolveInput = item.word
        let resolving = completeItems[item.index]
        if (!resolving) return
        await source.resolveCompletionItem(resolving, provider)
        let visible = await this.nvim.call('pumvisible')
        if (visible != 0 && resolveInput == item.word) {
          // vim have no suppport for update complete item
          let str = resolving.detail ? resolving.detail.trim() : ''
          if (str) echoMessage(this.nvim, str)
          let doc = complete.getDocumentation(resolving)
          if (doc) str += '\n\n' + doc
          if (str.length) {
            // TODO vim has bug with layout change on pumvisible
            // this.nvim.call('coc#util#preview_info', [str]) // tslint:disable-line
          }
        }
      },
      onCompleteDone: async (item: VimCompleteItem, opt: CompleteOption): Promise<void> => {
        let completeItem = completeItems[item.index]
        if (!completeItem) return
        await source.resolveCompletionItem(completeItem, provider)
        // use TextEdit for snippet item
        if (item.isSnippet && !completeItem.textEdit) {
          let line = opt.linenr - 1
          completeItem.textEdit = {
            range: Range.create(line, opt.col, line, colnr - 1),
            // tslint:disable-next-line: deprecation
            newText: completeItem.insertText || completeItem.label
          }
        }
        opt = Object.assign({}, opt, { line: currLine })
        let snippet = await this.applyTextEdit(completeItem, opt)
        let { additionalTextEdits } = completeItem
        await this.applyAdditionaLEdits(additionalTextEdits, opt.bufnr)
        if (snippet) await snippetManager.selectCurrentPlaceholder()
        let { command, kind } = completeItem
        if (snippet
          && !echodocSupport
          && !command && kind >= 2 && kind <= 4) {
          command = { title: 'triggerParameterHints', command: 'editor.action.triggerParameterHints' }
        }
        if (command) commands.execute(command)
        completeItems = []
      },
      shouldCommit: (item: VimCompleteItem, character: string): boolean => {
        let completeItem = completeItems[item.index]
        if (!completeItem) return false
        let { commitCharacters } = completeItem
        if (commitCharacters && commitCharacters.indexOf(character) !== -1) {
          return true
        }
        return false
      },
      resolveCompletionItem: async (item: any, provider: CompletionItemProvider): Promise<CompletionItem> => {
        if (this.resolveTokenSource) {
          this.resolveTokenSource.cancel()
        }
        let hasResolve = typeof provider.resolveCompletionItem === 'function'
        if (hasResolve && !item.resolved) {
          let cancelTokenSource = this.resolveTokenSource = new CancellationTokenSource()
          let token = cancelTokenSource.token
          let resolved = await Promise.resolve(provider.resolveCompletionItem(item, token))
          if (token.isCancellationRequested) return
          this.resolveTokenSource = null
          item.resolved = true
          // textEdit send on resolve
          if (item.textEdit == null && resolved.textEdit != null) {
            let doc = workspace.getDocument(option.bufnr)
            // use the line send to server
            if (doc) currLine = doc.getline(option.linenr - 1, false)
          }
          if (resolved) mixin(item, resolved)
        }
        return item
      }
    }
    return source as ISource
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
      await nvim.call('coc#util#setline', [linenr, `${start}${end}`])
      await nvim.call('cursor', [linenr, byteLength(start) + 1])
      // force vim sync
      let doc = workspace.getDocument(bufnr)
      await doc.patchChange()
      doc.forceSync()
      // can't select, since additionalTextEdits would break selection
      return await snippetManager.insertSnippet(newText, false)
    }
    let newLines = `${start}${newText}${end}`.split('\n')
    if (newLines.length == 1) {
      await nvim.call('coc#util#setline', [linenr, newLines[0]])
      await nvim.call('cursor', [linenr, byteLength(start + newText) + 1])
    } else {
      let document = workspace.getDocument(bufnr)
      if (document) {
        await document.buffer.setLines(newLines, {
          start: linenr - 1,
          end: linenr,
          strictIndexing: false
        })
      }
    }
    return false
  }

  private async applyAdditionaLEdits(textEdits: TextEdit[], bufnr: number): Promise<void> {
    if (!textEdits || textEdits.length == 0) return
    let document = workspace.getDocument(bufnr)
    if (!document) return
    if (workspace.isNvim) await this.nvim.input('<C-g>u')
    if (workspace.isVim) {
      await document.fetchContent()
      await wait(50)
    }
    await document.applyEdits(this.nvim, textEdits)
    if (workspace.isVim) await document.fetchContent()
    await wait(50)
  }
}

export default new Languages()

import { Neovim } from '@chemzqm/neovim'
import { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, CancellationToken, CancellationTokenSource, CodeAction, CodeActionContext, CodeActionKind, CodeLens, ColorInformation, ColorPresentation, CompletionItem, CompletionItemKind, CompletionList, CompletionTriggerKind, Disposable, DocumentHighlight, DocumentLink, DocumentSelector, DocumentSymbol, Emitter, Event, FoldingRange, FormattingOptions, Hover, InsertReplaceEdit, InsertTextFormat, LinkedEditingRanges, Location, LocationLink, Position, Range, SelectionRange, SemanticTokens, SemanticTokensDelta, SemanticTokensLegend, SignatureHelp, SignatureHelpContext, SymbolInformation, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import commands from './commands'
import diagnosticManager from './diagnostic/manager'
import { CallHierarchyProvider, CodeActionProvider, CodeLensProvider, CompletionItemProvider, DeclarationProvider, DefinitionProvider, DocumentColorProvider, DocumentFormattingEditProvider, DocumentHighlightProvider, DocumentLinkProvider, DocumentRangeFormattingEditProvider, DocumentRangeSemanticTokensProvider, DocumentSemanticTokensProvider, DocumentSymbolProvider, FoldingContext, FoldingRangeProvider, HoverProvider, ImplementationProvider, LinkedEditingRangeProvider, OnTypeFormattingEditProvider, ReferenceContext, ReferenceProvider, RenameProvider, SelectionRangeProvider, SignatureHelpProvider, TypeDefinitionProvider, WorkspaceSymbolProvider } from './provider'
import CodeActionManager from './provider/codeActionManager'
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
import ImplementationManager from './provider/implementationManager'
import OnTypeFormatManager from './provider/onTypeFormatManager'
import SelectionRangeManager from './provider/selectionRangeManager'
import ReferenceManager from './provider/referenceManager'
import RenameManager from './provider/renameManager'
import SignatureManager from './provider/signatureManager'
import TypeDefinitionManager from './provider/typeDefinitionManager'
import WorkspaceSymbolManager from './provider/workspaceSymbolsManager'
import CallHierarchyManager from './provider/callHierarchyManager'
import SemanticTokensManager from './provider/semanticTokensManager'
import SemanticTokensRangeManager from './provider/semanticTokensRangeManager'
import LinkedEditingRangeManager from './provider/linkedEditingRangeManager'
import snippetManager from './snippets/manager'
import sources from './sources'
import { CompleteOption, CompleteResult, ISource, SourceType, ExtendedCompleteItem } from './types'
import DiagnosticCollection from './diagnostic/collection'
import * as complete from './util/complete'
import { getChangedFromEdits, rangeOverlap } from './util/position'
import { byteIndex, byteLength, byteSlice } from './util/string'
import window from './window'
import workspace from './workspace'
const logger = require('./util/logger')('languages')

export interface CompletionSource {
  id: string
  source: ISource
  languageIds: string[]
}

interface CompleteConfig {
  snippetsSupport: boolean
  defaultKindText: string
  priority: number
  echodocSupport: boolean
  detailMaxLength: number
  detailField: string
  invalidInsertCharacters: string[]
  floatEnable: boolean
}

export interface DocumentSymbolProviderMetadata {
  /**
   * A human-readable string that is shown when multiple outlines trees show for one document.
   */
  label?: string
}

class Languages {
  private _onDidSemanticTokensRefresh = new Emitter<DocumentSelector>()
  public readonly onDidSemanticTokensRefresh: Event<DocumentSelector> = this._onDidSemanticTokensRefresh.event
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
  private implementationManager = new ImplementationManager()
  private codeLensManager = new CodeLensManager()
  private selectionRangeManager = new SelectionRangeManager()
  private callHierarchyManager = new CallHierarchyManager()
  private semanticTokensManager = new SemanticTokensManager()
  private semanticTokensRangeManager = new SemanticTokensRangeManager()
  private linkedEditingManager = new LinkedEditingRangeManager()
  private cancelTokenSource: CancellationTokenSource = new CancellationTokenSource()
  private completionItemKindMap: Map<CompletionItemKind, string>

  public init(): void {
    this.loadCompleteConfig()
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('suggest')) {
        this.loadCompleteConfig()
      }
    }, this)
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private get detailField(): string {
    let { detailField, floatEnable } = this.completeConfig
    if (detailField == 'preview' && (!floatEnable || !workspace.floatSupported)) {
      return 'menu'
    }
    return 'preview'
  }

  private loadCompleteConfig(): void {
    let suggest = workspace.getConfiguration('suggest')
    let labels = suggest.get<{ [key: string]: string }>('completionItemKindLabels', {})
    this.completionItemKindMap = new Map([
      [CompletionItemKind.Text, labels['text'] || 'v'],
      [CompletionItemKind.Method, labels['method'] || 'f'],
      [CompletionItemKind.Function, labels['function'] || 'f'],
      [CompletionItemKind.Constructor, typeof labels['constructor'] == 'function' ? 'f' : labels['con' + 'structor']],
      [CompletionItemKind.Field, labels['field'] || 'm'],
      [CompletionItemKind.Variable, labels['variable'] || 'v'],
      [CompletionItemKind.Class, labels['class'] || 'C'],
      [CompletionItemKind.Interface, labels['interface'] || 'I'],
      [CompletionItemKind.Module, labels['module'] || 'M'],
      [CompletionItemKind.Property, labels['property'] || 'm'],
      [CompletionItemKind.Unit, labels['unit'] || 'U'],
      [CompletionItemKind.Value, labels['value'] || 'v'],
      [CompletionItemKind.Enum, labels['enum'] || 'E'],
      [CompletionItemKind.Keyword, labels['keyword'] || 'k'],
      [CompletionItemKind.Snippet, labels['snippet'] || 'S'],
      [CompletionItemKind.Color, labels['color'] || 'v'],
      [CompletionItemKind.File, labels['file'] || 'F'],
      [CompletionItemKind.Reference, labels['reference'] || 'r'],
      [CompletionItemKind.Folder, labels['folder'] || 'F'],
      [CompletionItemKind.EnumMember, labels['enumMember'] || 'm'],
      [CompletionItemKind.Constant, labels['constant'] || 'v'],
      [CompletionItemKind.Struct, labels['struct'] || 'S'],
      [CompletionItemKind.Event, labels['event'] || 'E'],
      [CompletionItemKind.Operator, labels['operator'] || 'O'],
      [CompletionItemKind.TypeParameter, labels['typeParameter'] || 'T'],
    ])
    // let useFloat = workspace.floatSupported && suggest.get
    this.completeConfig = {
      defaultKindText: labels['default'] || '',
      priority: suggest.get<number>('languageSourcePriority', 99),
      echodocSupport: suggest.get<boolean>('echodocSupport', false),
      snippetsSupport: suggest.get<boolean>('snippetsSupport', true),
      detailField: suggest.get<string>('detailField', 'preview'),
      detailMaxLength: suggest.get<number>('detailMaxLength', 100),
      floatEnable: suggest.get<boolean>('floatEnable', true),
      invalidInsertCharacters: suggest.get<string[]>('invalidInsertCharacters', ['(', '<', '{', '[', '\r', '\n']),
    }
  }

  public hasFormatProvider(doc: TextDocument): boolean {
    if (this.formatManager.hasProvider(doc)) {
      return true
    }
    if (this.formatRangeManager.hasProvider(doc)) {
      return true
    }
    return false
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
    selector: DocumentSelector | null,
    provider: CompletionItemProvider,
    triggerCharacters: string[] = [],
    priority?: number,
    allCommitCharacters?: string[]
  ): Disposable {
    selector = typeof selector == 'string' ? [selector] : selector
    let source = this.createCompleteSource(name, shortcut, provider, selector, triggerCharacters, allCommitCharacters || [], priority)
    sources.addSource(source)
    logger.debug('created service source', name)
    return {
      dispose: () => {
        sources.removeSource(name)
      }
    }
  }

  public registerCodeActionProvider(selector: DocumentSelector, provider: CodeActionProvider, clientId: string | undefined, codeActionKinds?: CodeActionKind[]): Disposable {
    return this.codeActionManager.register(selector, provider, clientId, codeActionKinds)
  }

  public registerHoverProvider(selector: DocumentSelector, provider: HoverProvider): Disposable {
    return this.hoverManager.register(selector, provider)
  }

  public registerSelectionRangeProvider(selector: DocumentSelector, provider: SelectionRangeProvider): Disposable {
    return this.selectionRangeManager.register(selector, provider)
  }

  public registerSignatureHelpProvider(
    selector: DocumentSelector,
    provider: SignatureHelpProvider,
    triggerCharacters?: string[]): Disposable {
    return this.signatureManager.register(selector, provider, triggerCharacters)
  }

  public registerDocumentSymbolProvider(selector: DocumentSelector, provider: DocumentSymbolProvider, metadata?: DocumentSymbolProviderMetadata): Disposable {
    return this.documentSymbolManager.register(selector, provider, metadata?.label)
  }

  public registerFoldingRangeProvider(selector: DocumentSelector, provider: FoldingRangeProvider): Disposable {
    return this.foldingRangeManager.register(selector, provider)
  }

  public registerDocumentHighlightProvider(selector: DocumentSelector, provider: DocumentHighlightProvider): Disposable {
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
    return this.implementationManager.register(selector, provider)
  }

  public registerReferencesProvider(selector: DocumentSelector, provider: ReferenceProvider): Disposable {
    return this.referenceManager.register(selector, provider)
  }

  public registerRenameProvider(selector: DocumentSelector, provider: RenameProvider): Disposable {
    return this.renameManager.register(selector, provider)
  }

  public registerWorkspaceSymbolProvider(provider: WorkspaceSymbolProvider): Disposable {
    if (arguments.length > 1 && typeof arguments[1].provideWorkspaceSymbols === 'function') {
      provider = arguments[1]
    }
    return this.workspaceSymbolsManager.register(provider)
  }

  public registerDocumentFormatProvider(selector: DocumentSelector, provider: DocumentFormattingEditProvider, priority = 0): Disposable {
    return this.formatManager.register(selector, provider, priority)
  }

  public registerDocumentRangeFormatProvider(selector: DocumentSelector, provider: DocumentRangeFormattingEditProvider, priority = 0): Disposable {
    return this.formatRangeManager.register(selector, provider, priority)
  }

  public registerCallHierarchyProvider(selector: DocumentSelector, provider: CallHierarchyProvider): Disposable {
    return this.callHierarchyManager.register(selector, provider)
  }

  public registerDocumentSemanticTokensProvider(selector: DocumentSelector, provider: DocumentSemanticTokensProvider, legend: SemanticTokensLegend): Disposable {
    this._onDidSemanticTokensRefresh.fire(selector)
    return this.semanticTokensManager.register(selector, provider, legend, () => {
      this._onDidSemanticTokensRefresh.fire(selector)
    })
  }

  public registerDocumentRangeSemanticTokensProvider(selector: DocumentSelector, provider: DocumentRangeSemanticTokensProvider, legend: SemanticTokensLegend): Disposable {
    this._onDidSemanticTokensRefresh.fire(selector)
    return this.semanticTokensRangeManager.register(selector, provider, legend)
  }

  public registerLinkedEditingRangeProvider(selector: DocumentSelector, provider: LinkedEditingRangeProvider): Disposable {
    return this.linkedEditingManager.register(selector, provider)
  }

  public shouldTriggerSignatureHelp(document: TextDocument, triggerCharacter: string): boolean {
    return this.signatureManager.shouldTrigger(document, triggerCharacter)
  }

  public async getHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover[]> {
    return await this.hoverManager.provideHover(document, position, token)
  }

  public async getSignatureHelp(document: TextDocument, position: Position, token: CancellationToken, context: SignatureHelpContext): Promise<SignatureHelp> {
    return await this.signatureManager.provideSignatureHelp(document, position, token, context)
  }

  public async getDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<Location[]> {
    if (!this.definitionManager.hasProvider(document)) return null
    return await this.definitionManager.provideDefinition(document, position, token)
  }

  public async getDeclaration(document: TextDocument, position: Position, token: CancellationToken): Promise<Location[] | Location | LocationLink[] | null> {
    if (!this.declarationManager.hasProvider(document)) return null
    return await this.declarationManager.provideDeclaration(document, position, token)
  }

  public async getTypeDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<Location[]> {
    if (!this.typeDefinitionManager.hasProvider(document)) return null
    return await this.typeDefinitionManager.provideTypeDefinition(document, position, token)
  }

  public async getImplementation(document: TextDocument, position: Position, token: CancellationToken): Promise<Location[]> {
    if (!this.implementationManager.hasProvider(document)) return null
    return await this.implementationManager.provideReferences(document, position, token)
  }

  public async getReferences(document: TextDocument, context: ReferenceContext, position: Position, token: CancellationToken): Promise<Location[]> {
    if (!this.referenceManager.hasProvider(document)) return null
    return await this.referenceManager.provideReferences(document, position, context, token)
  }

  public async getDocumentSymbol(document: TextDocument, token: CancellationToken): Promise<SymbolInformation[] | DocumentSymbol[]> {
    return await this.documentSymbolManager.provideDocumentSymbols(document, token)
  }

  public async getSelectionRanges(document: TextDocument, positions: Position[], token): Promise<SelectionRange[] | null> {
    return await this.selectionRangeManager.provideSelectionRanges(document, positions, token)
  }

  public async getWorkspaceSymbols(query: string, token: CancellationToken): Promise<SymbolInformation[]> {
    query = query || ''
    return await this.workspaceSymbolsManager.provideWorkspaceSymbols(query, token)
  }

  public async resolveWorkspaceSymbol(symbol: SymbolInformation, token: CancellationToken): Promise<SymbolInformation> {
    return await this.workspaceSymbolsManager.resolveWorkspaceSymbol(symbol, token)
  }

  public async prepareRename(document: TextDocument, position: Position, token: CancellationToken): Promise<Range | { range: Range; placeholder: string } | false> {
    return await this.renameManager.prepareRename(document, position, token)
  }

  public async provideRenameEdits(document: TextDocument, position: Position, newName: string, token: CancellationToken): Promise<WorkspaceEdit> {
    return await this.renameManager.provideRenameEdits(document, position, newName, token)
  }

  public async provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]> {
    if (!this.formatManager.hasProvider(document)) {
      let hasRangeFormater = this.formatRangeManager.hasProvider(document)
      if (!hasRangeFormater) return null
      let end = document.positionAt(document.getText().length)
      let range = Range.create(Position.create(0, 0), end)
      return await this.provideDocumentRangeFormattingEdits(document, range, options, token)
    }
    return await this.formatManager.provideDocumentFormattingEdits(document, options, token)
  }

  public async provideDocumentRangeFormattingEdits(document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]> {
    if (!this.formatRangeManager.hasProvider(document)) return null
    return await this.formatRangeManager.provideDocumentRangeFormattingEdits(document, range, options, token)
  }

  public async getCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Promise<CodeAction[]> {
    return await this.codeActionManager.provideCodeActions(document, range, context, token)
  }

  public async getDocumentHighLight(document: TextDocument, position: Position, token: CancellationToken): Promise<DocumentHighlight[]> {
    return await this.documentHighlightManager.provideDocumentHighlights(document, position, token)
  }

  public async getDocumentLinks(document: TextDocument, token: CancellationToken): Promise<DocumentLink[]> {
    if (!this.documentLinkManager.hasProvider(document)) {
      return null
    }
    return (await this.documentLinkManager.provideDocumentLinks(document, token)) || []
  }

  public async resolveDocumentLink(link: DocumentLink): Promise<DocumentLink> {
    return await this.documentLinkManager.resolveDocumentLink(link, this.token)
  }

  public async provideDocumentColors(document: TextDocument, token: CancellationToken): Promise<ColorInformation[] | null> {
    return await this.documentColorManager.provideDocumentColors(document, token)
  }

  public async provideFoldingRanges(document: TextDocument, context: FoldingContext, token: CancellationToken): Promise<FoldingRange[] | null> {
    if (!this.foldingRangeManager.hasProvider(document)) {
      return null
    }
    return await this.foldingRangeManager.provideFoldingRanges(document, context, token)
  }

  public async provideColorPresentations(color: ColorInformation, document: TextDocument, token: CancellationToken): Promise<ColorPresentation[]> {
    return await this.documentColorManager.provideColorPresentations(color, document, token)
  }

  public async getCodeLens(document: TextDocument, token: CancellationToken): Promise<(CodeLens | null)[]> {
    return await this.codeLensManager.provideCodeLenses(document, token)
  }

  public async resolveCodeLens(codeLens: CodeLens, token: CancellationToken): Promise<CodeLens> {
    if (codeLens.command != null) return codeLens
    return await this.codeLensManager.resolveCodeLens(codeLens, token)
  }

  public async resolveCodeAction(codeAction: CodeAction, token: CancellationToken): Promise<CodeAction> {
    return await this.codeActionManager.resolveCodeAction(codeAction, token)
  }

  public async provideDocumentOnTypeEdits(
    character: string,
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<TextEdit[] | null> {
    return this.onTypeFormatManager.onCharacterType(character, document, position, token)
  }

  public canFormatOnType(character: string, document: TextDocument): boolean {
    return this.onTypeFormatManager.getProvider(document, character) != null
  }

  public async prepareCallHierarchy(document: TextDocument, position: Position, token: CancellationToken): Promise<CallHierarchyItem | CallHierarchyItem[]> {
    return this.callHierarchyManager.prepareCallHierarchy(document, position, token)
  }

  public async provideIncomingCalls(item: CallHierarchyItem, token: CancellationToken): Promise<CallHierarchyIncomingCall[]> {
    return this.callHierarchyManager.provideCallHierarchyIncomingCalls(item, token)
  }

  public async provideOutgoingCalls(item: CallHierarchyItem, token: CancellationToken): Promise<CallHierarchyOutgoingCall[]> {
    return this.callHierarchyManager.provideCallHierarchyOutgoingCalls(item, token)
  }

  public getLegend(document: TextDocument, range?: boolean): SemanticTokensLegend | undefined {
    if (range) return this.semanticTokensRangeManager.getLegend(document)
    return this.semanticTokensManager.getLegend(document)
  }

  public hasSemanticTokensEdits(document: TextDocument): boolean {
    return this.semanticTokensManager.hasSemanticTokensEdits(document)
  }

  public async provideDocumentSemanticTokens(document: TextDocument, token: CancellationToken): Promise<SemanticTokens> {
    return this.semanticTokensManager.provideDocumentSemanticTokens(document, token)
  }

  public async provideDocumentSemanticTokensEdits(document: TextDocument, previousResultId: string, token: CancellationToken): Promise<SemanticTokens | SemanticTokensDelta> {
    return this.semanticTokensManager.provideDocumentSemanticTokensEdits(document, previousResultId, token)
  }

  public async provideDocumentRangeSemanticTokens(document: TextDocument, range: Range, token: CancellationToken): Promise<SemanticTokens> {
    return this.semanticTokensRangeManager.provideDocumentRangeSemanticTokens(document, range, token)
  }

  public hasLinkedEditing(document: TextDocument): boolean {
    return this.linkedEditingManager.hasProvider(document)
  }

  public async provideLinkedEdits(document: TextDocument, position: Position, token: CancellationToken): Promise<LinkedEditingRanges> {
    return this.linkedEditingManager.provideLinkedEditingRanges(document, position, token)
  }

  public hasProvider(id: string, document: TextDocument): boolean {
    switch (id) {
      case 'formatOnType':
        return this.onTypeFormatManager.hasProvider(document)
      case 'rename':
        return this.renameManager.hasProvider(document)
      case 'onTypeEdit':
        return this.onTypeFormatManager.hasProvider(document)
      case 'documentLink':
        return this.documentLinkManager.hasProvider(document)
      case 'documentColor':
        return this.documentColorManager.hasProvider(document)
      case 'foldingRange':
        return this.foldingRangeManager.hasProvider(document)
      case 'format':
        return this.formatManager.hasProvider(document) || this.formatRangeManager.hasProvider(document)
      case 'codeAction':
        return this.codeActionManager.hasProvider(document)
      case 'workspaceSymbols':
        return this.workspaceSymbolsManager.hasProvider()
      case 'formatRange':
        return this.formatRangeManager.hasProvider(document)
      case 'hover':
        return this.hoverManager.hasProvider(document)
      case 'signature':
        return this.signatureManager.hasProvider(document)
      case 'documentSymbol':
        return this.documentSymbolManager.hasProvider(document)
      case 'documentHighlight':
        return this.documentHighlightManager.hasProvider(document)
      case 'definition':
        return this.definitionManager.hasProvider(document)
      case 'declaration':
        return this.declarationManager.hasProvider(document)
      case 'typeDefinition':
        return this.typeDefinitionManager.hasProvider(document)
      case 'reference':
        return this.referenceManager.hasProvider(document)
      case 'implementation':
        return this.implementationManager.hasProvider(document)
      case 'codeLens':
        return this.codeLensManager.hasProvider(document)
      case 'selectionRange':
        return this.selectionRangeManager.hasProvider(document)
      case 'callHierarchy':
        return this.callHierarchyManager.hasProvider(document)
      case 'semanticTokens':
        return this.semanticTokensManager.hasProvider(document)
      case 'linkedEditing':
        return this.linkedEditingManager.hasProvider(document)
      default:
        throw new Error(`Invalid provider name: ${id}`)
    }
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
    selector: DocumentSelector,
    triggerCharacters: string[],
    allCommitCharacters: string[],
    priority?: number | undefined
  ): ISource {
    let filetype: string
    // track them for resolve
    let completeItems: CompletionItem[] = []
    // line used for TextEdit
    let hasResolve = typeof provider.resolveCompletionItem === 'function'
    priority = priority == null ? this.completeConfig.priority : priority
    // index set of resolved items
    let resolvedIndexes: Set<number> = new Set()
    let source: ISource = {
      name,
      priority,
      shortcut,
      enable: true,
      sourceType: SourceType.Service,
      documentSelector: selector,
      triggerCharacters: triggerCharacters || [],
      toggle: () => {
        source.enable = !source.enable
      },
      doComplete: async (opt: CompleteOption, token: CancellationToken): Promise<CompleteResult | null> => {
        let { triggerCharacter, bufnr } = opt
        filetype = opt.filetype
        resolvedIndexes = new Set()
        let isTrigger = triggerCharacters && triggerCharacters.includes(triggerCharacter)
        let triggerKind: CompletionTriggerKind = CompletionTriggerKind.Invoked
        if (opt.triggerForInComplete) {
          triggerKind = CompletionTriggerKind.TriggerForIncompleteCompletions
        } else if (isTrigger) {
          triggerKind = CompletionTriggerKind.TriggerCharacter
        }
        if (token.isCancellationRequested) return null
        let position = complete.getPosition(opt)
        let context: any = { triggerKind, option: opt }
        if (isTrigger) context.triggerCharacter = triggerCharacter
        let result
        try {
          let doc = workspace.getDocument(bufnr)
          result = await Promise.resolve(provider.provideCompletionItems(doc.textDocument, position, token, context))
        } catch (e) {
          // don't disturb user
          logger.error(`Complete "${name}" error:`, e)
          return null
        }
        if (!result || token.isCancellationRequested) return null
        completeItems = Array.isArray(result) ? result : result.items
        if (!completeItems || completeItems.length == 0) return null
        let startcol = this.getStartColumn(opt.line, completeItems)
        let option: CompleteOption = Object.assign({}, opt)
        let prefix: string
        if (startcol != null) {
          if (startcol < option.col) {
            prefix = byteSlice(opt.line, startcol, option.col)
          }
          option.col = startcol
        }
        let items: ExtendedCompleteItem[] = completeItems.map((o, index) => {
          let item = this.convertVimCompleteItem(o, shortcut, option, prefix)
          item.index = index
          return item
        })
        return {
          startcol,
          isIncomplete: !!(result as CompletionList).isIncomplete,
          items
        }
      },
      onCompleteResolve: async (item: ExtendedCompleteItem, token: CancellationToken): Promise<void> => {
        let { index } = item
        let resolving = completeItems[index]
        if (!resolving || resolvedIndexes.has(index)) return
        if (hasResolve) {
          token.onCancellationRequested(() => {
            resolvedIndexes.delete(index)
          })
          resolvedIndexes.add(index)
          try {
            let resolved = await Promise.resolve(provider.resolveCompletionItem(Object.assign({}, resolving), token))
            if (token.isCancellationRequested) return
            if (resolved) {
              Object.assign(resolving, resolved)
            } else {
              resolvedIndexes.delete(index)
            }
          } catch (e) {
            resolvedIndexes.delete(index)
            logger.error(`Error on complete resolve: ${e.message}`, e.stack)
          }
        }
        if (item.documentation == null) {
          let { documentation, detail } = resolving
          if (!documentation && !detail) return
          let docs = []
          if (detail && !item.detailShown && detail != item.word) {
            detail = detail.replace(/\n\s*/g, ' ')
            if (detail.length) {
              let isText = /^[\w-\s.,\t]+$/.test(detail)
              docs.push({ filetype: isText ? 'txt' : filetype, content: detail })
            }
          }
          if (documentation) {
            if (typeof documentation == 'string') {
              docs.push({
                filetype: 'markdown',
                content: documentation
              })
            } else if (documentation.value) {
              docs.push({
                filetype: documentation.kind == 'markdown' ? 'markdown' : 'txt',
                content: documentation.value
              })
            }
          }
          item.documentation = docs
        }
      },
      onCompleteDone: async (vimItem: ExtendedCompleteItem, opt: CompleteOption): Promise<void> => {
        let item = completeItems[vimItem.index]
        if (!item) return
        let line = opt.linenr - 1
        if (item.insertText != null && !item.textEdit) {
          item.textEdit = {
            range: Range.create(line, opt.col, line, opt.colnr - 1),
            newText: item.insertText
          }
        }
        if (vimItem.line) Object.assign(opt, { line: vimItem.line })
        try {
          let isSnippet = await this.applyTextEdit(item, vimItem.word, opt)
          let { additionalTextEdits } = item
          if (additionalTextEdits && item.textEdit) {
            let r = InsertReplaceEdit.is(item.textEdit) ? item.textEdit.replace : item.textEdit.range
            additionalTextEdits = additionalTextEdits.filter(edit => {
              let er = InsertReplaceEdit.is(edit) ? edit.replace : edit.range
              if (rangeOverlap(r, er)) {
                logger.error('Filtered overlap additionalTextEdit:', edit)
                return false
              }
              return true
            })
          }
          await this.applyAdditionalEdits(additionalTextEdits, opt.bufnr, isSnippet)
          if (isSnippet) await snippetManager.selectCurrentPlaceholder()
          if (item.command && commands.has(item.command.command)) {
            void commands.execute(item.command)
          }
        } catch (e) {
          logger.error('Error on CompleteDone:', e)
        }
      },
      shouldCommit: (item: ExtendedCompleteItem, character: string): boolean => {
        let completeItem = completeItems[item.index]
        if (!completeItem) return false
        let commitCharacters = completeItem.commitCharacters || allCommitCharacters
        return commitCharacters.includes(character)
      }
    }
    return source
  }

  private get token(): CancellationToken {
    this.cancelTokenSource = new CancellationTokenSource()
    return this.cancelTokenSource.token
  }

  private async applyTextEdit(item: CompletionItem, word: string, option: CompleteOption): Promise<boolean> {
    let { nvim } = this
    let { textEdit } = item
    if (!textEdit) return false
    let { line, bufnr, linenr } = option
    let doc = workspace.getDocument(bufnr)
    if (!doc) return false
    let newText = textEdit.newText
    let range = InsertReplaceEdit.is(textEdit) ? textEdit.replace : textEdit.range
    let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet
    // replace inserted word
    let start = line.substr(0, range.start.character)
    let end = line.substr(range.end.character)
    if (isSnippet && this.completeConfig.snippetsSupport === false) {
      // could be wrong, but maybe best we can do.
      isSnippet = false
      newText = word
    }
    if (isSnippet) {
      let currline = doc.getline(linenr - 1)
      let endCharacter = currline.length - end.length
      let r = Range.create(linenr - 1, range.start.character, linenr - 1, endCharacter)
      // can't select, since additionalTextEdits would break selection
      return await snippetManager.insertSnippet(newText, false, r, item.insertTextMode)
    }
    let newLines = `${start}${newText}${end}`.split(/\r?\n/)
    if (newLines.length == 1) {
      await nvim.call('coc#util#setline', [linenr, newLines[0]])
      await window.moveTo(Position.create(linenr - 1, (start + newText).length))
    } else {
      let buffer = nvim.createBuffer(bufnr)
      await buffer.setLines(newLines, {
        start: linenr - 1,
        end: linenr,
        strictIndexing: false
      })
      let line = linenr - 1 + newLines.length - 1
      let character = newLines[newLines.length - 1].length - end.length
      await window.moveTo({ line, character })
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
    await document.patchChange(true)
    // move cursor after edit
    let changed = null
    let pos = await window.getCursorPosition()
    if (!snippet) changed = getChangedFromEdits(pos, textEdits)
    await document.applyEdits(textEdits)
    if (changed) await window.moveTo(Position.create(pos.line + changed.line, pos.character + changed.character))
  }

  private getStartColumn(line: string, items: CompletionItem[]): number | null {
    let first = items[0]
    if (!first.textEdit) return null
    let { newText } = first.textEdit
    let range = InsertReplaceEdit.is(first.textEdit) ? first.textEdit.replace : first.textEdit.range
    let { character } = range.start
    if (newText.length < range.end.character - character) {
      return null
    }
    for (let i = 0; i < 10; i++) {
      let o = items[i]
      if (!o) break
      if (!o.textEdit) return null
      if (InsertReplaceEdit.is(o.textEdit)) return null
      let r = InsertReplaceEdit.is(o.textEdit) ? o.textEdit.replace : o.textEdit.range
      if (r.start.character !== character) return null
    }
    return byteIndex(line, character)
  }

  private convertVimCompleteItem(item: CompletionItem, shortcut: string, opt: CompleteOption, prefix: string): ExtendedCompleteItem {
    let { echodocSupport, detailMaxLength, invalidInsertCharacters } = this.completeConfig
    let { detailField } = this
    let hasAdditionalEdit = item.additionalTextEdits && item.additionalTextEdits.length > 0
    let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet || hasAdditionalEdit
    let label = item.label.trim()
    let obj: ExtendedCompleteItem = {
      word: complete.getWord(item, opt, invalidInsertCharacters),
      abbr: label,
      menu: `[${shortcut}]`,
      kind: complete.completionKindString(item.kind, this.completionItemKindMap, this.completeConfig.defaultKindText),
      sortText: item.sortText || null,
      sourceScore: item['score'] || null,
      filterText: item.filterText || label,
      isSnippet,
      dup: item.data && item.data.dup == 0 ? 0 : 1
    }
    if (prefix) {
      if (!obj.filterText.startsWith(prefix)) {
        if (item.textEdit && item.textEdit.newText.startsWith(prefix)) {
          obj.filterText = item.textEdit.newText.split(/\r?\n/)[0]
        }
      }
      if (!item.textEdit && !obj.word.startsWith(prefix)) {
        // fix remains completeItem that should not change startcol
        obj.word = `${prefix}${obj.word}`
      }
    }
    if (item && item.detail && detailField != 'preview') {
      let detail = item.detail.replace(/\n\s*/g, ' ')
      if (byteLength(detail) < detailMaxLength) {
        if (detailField == 'menu') {
          obj.menu = `${detail} ${obj.menu}`
        } else if (detailField == 'abbr') {
          obj.abbr = `${obj.abbr} - ${detail}`
        }
        obj.detailShown = 1
      }
    }
    if (item.documentation) {
      obj.info = typeof item.documentation == 'string' ? item.documentation : item.documentation.value
    } else {
      obj.info = ''
    }
    if (obj.word == '') obj.empty = 1
    if (item.textEdit) obj.line = opt.line
    if (item.kind == CompletionItemKind.Folder && !obj.abbr.endsWith('/')) {
      obj.abbr = obj.abbr + '/'
    }
    if (echodocSupport && item.kind >= 2 && item.kind <= 4) {
      let fields = [item.detail || '', obj.abbr, obj.word]
      for (let s of fields) {
        if (s.includes('(')) {
          obj.signature = s
          break
        }
      }
    }
    if (item.preselect) obj.preselect = true
    if (item.data?.optional) obj.abbr = obj.abbr + '?'
    return obj
  }
}

export default new Languages()

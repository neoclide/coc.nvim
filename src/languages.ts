'use strict'
import type { LinkedEditingRanges, SignatureHelpContext } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, CodeAction, CodeActionContext, CodeActionKind, CodeLens, ColorInformation, ColorPresentation, DefinitionLink, DocumentHighlight, DocumentLink, DocumentSymbol, FoldingRange, FormattingOptions, Hover, InlineValue, InlineValueContext, Position, Range, SelectionRange, SemanticTokens, SemanticTokensDelta, SemanticTokensLegend, SignatureHelp, SymbolInformation, TextEdit, TypeHierarchyItem, WorkspaceEdit, WorkspaceSymbol } from 'vscode-languageserver-types'
import type { Sources } from './completion/sources'
import DiagnosticCollection from './diagnostic/collection'
import diagnosticManager from './diagnostic/manager'
import { CallHierarchyProvider, CodeActionProvider, CodeLensProvider, CompletionItemProvider, DeclarationProvider, DefinitionProvider, DocumentColorProvider, DocumentFormattingEditProvider, DocumentHighlightProvider, DocumentLinkProvider, DocumentRangeFormattingEditProvider, DocumentRangeSemanticTokensProvider, DocumentSelector, DocumentSemanticTokensProvider, DocumentSymbolProvider, DocumentSymbolProviderMetadata, FoldingContext, FoldingRangeProvider, HoverProvider, ImplementationProvider, InlayHintsProvider, InlineValuesProvider, LinkedEditingRangeProvider, OnTypeFormattingEditProvider, ReferenceContext, ReferenceProvider, RenameProvider, SelectionRangeProvider, SignatureHelpProvider, TypeDefinitionProvider, TypeHierarchyProvider, WorkspaceSymbolProvider } from './provider'
import CallHierarchyManager from './provider/callHierarchyManager'
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
import InlayHintManger, { InlayHintWithProvider } from './provider/inlayHintManager'
import InlineValueManager from './provider/inlineValueManager'
import LinkedEditingRangeManager from './provider/linkedEditingRangeManager'
import OnTypeFormatManager from './provider/onTypeFormatManager'
import ReferenceManager from './provider/referenceManager'
import RenameManager from './provider/renameManager'
import SelectionRangeManager from './provider/selectionRangeManager'
import SemanticTokensManager from './provider/semanticTokensManager'
import SemanticTokensRangeManager from './provider/semanticTokensRangeManager'
import SignatureManager from './provider/signatureManager'
import TypeDefinitionManager from './provider/typeDefinitionManager'
import TypeHierarchyManager, { TypeHierarchyItemWithSource } from './provider/typeHierarchyManager'
import WorkspaceSymbolManager from './provider/workspaceSymbolsManager'
import { LocationWithTarget, TextDocumentMatch } from './types'
import { disposeAll, getConditionValue } from './util'
import * as Is from './util/is'
import { CancellationToken, Disposable, Emitter, Event } from './util/protocol'
import { toText } from './util/string'

const eventDebounce = getConditionValue(500, 10)

type withKey<K extends string> = {
  [k in K]?: Event<void>
}

interface Mannger<P, A> {
  register: (selector: DocumentSelector, provider: P, extra?: A) => Disposable
}

export enum ProviderName {
  FormatOnType = 'formatOnType',
  Rename = 'rename',
  OnTypeEdit = 'onTypeEdit',
  DocumentLink = 'documentLink',
  DocumentColor = 'documentColor',
  FoldingRange = 'foldingRange',
  Format = 'format',
  CodeAction = 'codeAction',
  FormatRange = 'formatRange',
  Hover = 'hover',
  Signature = 'signature',
  WorkspaceSymbols = 'workspaceSymbols',
  DocumentSymbol = 'documentSymbol',
  DocumentHighlight = 'documentHighlight',
  Definition = 'definition',
  Declaration = 'declaration',
  TypeDefinition = 'typeDefinition',
  Reference = 'reference',
  Implementation = 'implementation',
  CodeLens = 'codeLens',
  SelectionRange = 'selectionRange',
  CallHierarchy = 'callHierarchy',
  SemanticTokens = 'semanticTokens',
  SemanticTokensRange = 'semanticTokensRange',
  LinkedEditing = 'linkedEditing',
  InlayHint = 'inlayHint',
  InlineValue = 'inlineValue',
  TypeHierarchy = 'typeHierarchy'
}

class Languages {
  private readonly _onDidSemanticTokensRefresh = new Emitter<DocumentSelector>()
  private readonly _onDidInlayHintRefresh = new Emitter<DocumentSelector>()
  private readonly _onDidCodeLensRefresh = new Emitter<DocumentSelector>()
  private readonly _onDidColorsRefresh = new Emitter<DocumentSelector>()
  private readonly _onDidLinksRefresh = new Emitter<DocumentSelector>()
  public readonly onDidSemanticTokensRefresh: Event<DocumentSelector> = this._onDidSemanticTokensRefresh.event
  public readonly onDidInlayHintRefresh: Event<DocumentSelector> = this._onDidInlayHintRefresh.event
  public readonly onDidCodeLensRefresh: Event<DocumentSelector> = this._onDidCodeLensRefresh.event
  public readonly onDidColorsRefresh: Event<DocumentSelector> = this._onDidColorsRefresh.event
  public readonly onDidLinksRefresh: Event<DocumentSelector> = this._onDidLinksRefresh.event
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
  private typeHierarchyManager = new TypeHierarchyManager()
  private referenceManager = new ReferenceManager()
  private implementationManager = new ImplementationManager()
  private codeLensManager = new CodeLensManager()
  private selectionRangeManager = new SelectionRangeManager()
  private callHierarchyManager = new CallHierarchyManager()
  private semanticTokensManager = new SemanticTokensManager()
  private semanticTokensRangeManager = new SemanticTokensRangeManager()
  private linkedEditingManager = new LinkedEditingRangeManager()
  private inlayHintManager = new InlayHintManger()
  private inlineValueManager = new InlineValueManager()

  public registerReferenceProvider: (selector: DocumentSelector, provider: ReferenceProvider) => Disposable

  constructor() {
    this.registerReferenceProvider = this.registerReferencesProvider
  }

  public hasFormatProvider(doc: TextDocumentMatch): boolean {
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
    triggerCharacters?: string[]
  ): Disposable {
    return this.onTypeFormatManager.register(selector, provider, triggerCharacters)
  }

  public registerCompletionItemProvider(
    name: string,
    shortcut: string,
    selector: DocumentSelector | string | null,
    provider: CompletionItemProvider,
    triggerCharacters: string[] = [],
    priority?: number,
    allCommitCharacters?: string[]
  ): Disposable {
    selector = Is.string(selector) ? [{ language: selector }] : selector
    let sources = require('./completion/sources').default as Sources
    sources.removeSource(name)
    return sources.createLanguageSource(name, shortcut, selector, provider, triggerCharacters, priority, allCommitCharacters)
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
    if (metadata) provider.meta = metadata
    return this.documentSymbolManager.register(selector, provider)
  }

  public registerFoldingRangeProvider(selector: DocumentSelector, provider: FoldingRangeProvider): Disposable {
    return this.foldingRangeManager.register(selector, provider)
  }

  public registerDocumentHighlightProvider(selector: DocumentSelector, provider: DocumentHighlightProvider): Disposable {
    return this.documentHighlightManager.register(selector, provider)
  }

  public registerDocumentLinkProvider(selector: DocumentSelector, provider: DocumentLinkProvider): Disposable {
    this._onDidLinksRefresh.fire(selector)
    let disposable = this.documentLinkManager.register(selector, provider)
    return Disposable.create(() => {
      disposable.dispose()
      this._onDidLinksRefresh.fire(selector)
    })
  }

  public registerDocumentColorProvider(selector: DocumentSelector, provider: DocumentColorProvider): Disposable {
    this._onDidColorsRefresh.fire(selector)
    let disposable = this.documentColorManager.register(selector, provider)
    return Disposable.create(() => {
      disposable.dispose()
      this._onDidColorsRefresh.fire(selector)
    })
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

  public registerTypeHierarchyProvider(selector: DocumentSelector, provider: TypeHierarchyProvider): Disposable {
    return this.typeHierarchyManager.register(selector, provider)
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
    if (arguments.length > 1 && Is.func(arguments[1].provideWorkspaceSymbols)) {
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

  public registerCodeLensProvider(selector: DocumentSelector, provider: CodeLensProvider): Disposable {
    return this.registerProviderWithEvent(selector, provider, 'onDidChangeCodeLenses', this.codeLensManager, this._onDidCodeLensRefresh)
  }

  public registerDocumentSemanticTokensProvider(selector: DocumentSelector, provider: DocumentSemanticTokensProvider, legend: SemanticTokensLegend): Disposable {
    return this.registerProviderWithEvent(selector, provider, 'onDidChangeSemanticTokens', this.semanticTokensManager, this._onDidSemanticTokensRefresh, legend)
  }

  public registerDocumentRangeSemanticTokensProvider(selector: DocumentSelector, provider: DocumentRangeSemanticTokensProvider, legend: SemanticTokensLegend): Disposable {
    let timer = setTimeout(() => {
      this._onDidSemanticTokensRefresh.fire(selector)
    }, eventDebounce)
    let disposable = this.semanticTokensRangeManager.register(selector, provider, legend)
    return Disposable.create(() => {
      clearTimeout(timer)
      disposable.dispose()
      this._onDidSemanticTokensRefresh.fire(selector)
    })
  }

  public registerInlayHintsProvider(selector: DocumentSelector, provider: InlayHintsProvider): Disposable {
    return this.registerProviderWithEvent(selector, provider, 'onDidChangeInlayHints', this.inlayHintManager, this._onDidInlayHintRefresh)
  }

  public registerInlineValuesProvider(selector: DocumentSelector, provider: InlineValuesProvider): Disposable {
    // TODO onDidChangeInlineValues
    return this.inlineValueManager.register(selector, provider)
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

  public async getDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<LocationWithTarget[]> {
    return await this.definitionManager.provideDefinition(document, position, token)
  }

  public async getDefinitionLinks(document: TextDocument, position: Position, token: CancellationToken): Promise<DefinitionLink[]> {
    return await this.definitionManager.provideDefinitionLinks(document, position, token)
  }

  public async getDeclaration(document: TextDocument, position: Position, token: CancellationToken): Promise<LocationWithTarget[]> {
    return await this.declarationManager.provideDeclaration(document, position, token)
  }

  public async getTypeDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<LocationWithTarget[]> {
    return await this.typeDefinitionManager.provideTypeDefinition(document, position, token)
  }

  public async getImplementation(document: TextDocument, position: Position, token: CancellationToken): Promise<LocationWithTarget[]> {
    return await this.implementationManager.provideImplementations(document, position, token)
  }

  public async getReferences(document: TextDocument, context: ReferenceContext, position: Position, token: CancellationToken): Promise<LocationWithTarget[]> {
    return await this.referenceManager.provideReferences(document, position, context, token)
  }

  public async getDocumentSymbol(document: TextDocument, token: CancellationToken): Promise<DocumentSymbol[] | null> {
    return await this.documentSymbolManager.provideDocumentSymbols(document, token)
  }

  public getDocumentSymbolMetadata(document: TextDocument): DocumentSymbolProviderMetadata | null {
    return this.documentSymbolManager.getMetaData(document)
  }

  public async getSelectionRanges(document: TextDocument, positions: Position[], token): Promise<SelectionRange[] | null> {
    return await this.selectionRangeManager.provideSelectionRanges(document, positions, token)
  }

  public async getWorkspaceSymbols(query: string, token: CancellationToken): Promise<WorkspaceSymbol[]> {
    return await this.workspaceSymbolsManager.provideWorkspaceSymbols(toText(query), token)
  }

  public async resolveWorkspaceSymbol(symbol: WorkspaceSymbol, token: CancellationToken): Promise<WorkspaceSymbol> {
    return await this.workspaceSymbolsManager.resolveWorkspaceSymbol(symbol, token)
  }

  public async prepareRename(document: TextDocument, position: Position, token: CancellationToken): Promise<Range | { range: Range; placeholder: string } | false> {
    return await this.renameManager.prepareRename(document, position, token)
  }

  public async provideRenameEdits(document: TextDocument, position: Position, newName: string, token: CancellationToken): Promise<WorkspaceEdit> {
    return await this.renameManager.provideRenameEdits(document, position, newName, token)
  }

  public async provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]> {
    let res = await this.formatManager.provideDocumentFormattingEdits(document, options, token)
    if (res == null) {
      let hasRangeFormatter = this.formatRangeManager.hasProvider(document)
      if (!hasRangeFormatter) return null
      let end = document.positionAt(document.getText().length)
      let range = Range.create(Position.create(0, 0), end)
      return await this.provideDocumentRangeFormattingEdits(document, range, options, token)
    }
    return res
  }

  public async provideDocumentRangeFormattingEdits(document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]> {
    return await this.formatRangeManager.provideDocumentRangeFormattingEdits(document, range, options, token)
  }

  public async getCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Promise<CodeAction[]> {
    return await this.codeActionManager.provideCodeActions(document, range, context, token)
  }

  public async getDocumentHighLight(document: TextDocument, position: Position, token: CancellationToken): Promise<DocumentHighlight[]> {
    return await this.documentHighlightManager.provideDocumentHighlights(document, position, token)
  }

  public async getDocumentLinks(document: TextDocument, token: CancellationToken): Promise<DocumentLink[] | null> {
    return await this.documentLinkManager.provideDocumentLinks(document, token)
  }

  public async resolveDocumentLink(link: DocumentLink, token: CancellationToken): Promise<DocumentLink> {
    return await this.documentLinkManager.resolveDocumentLink(link, token)
  }

  public async provideDocumentColors(document: TextDocument, token: CancellationToken): Promise<ColorInformation[]> {
    return await this.documentColorManager.provideDocumentColors(document, token)
  }

  public async provideFoldingRanges(document: TextDocument, context: FoldingContext, token: CancellationToken): Promise<FoldingRange[]> {
    return await this.foldingRangeManager.provideFoldingRanges(document, context, token)
  }

  public async provideColorPresentations(color: ColorInformation, document: TextDocument, token: CancellationToken): Promise<ColorPresentation[] | null> {
    return await this.documentColorManager.provideColorPresentations(color, document, token)
  }

  public async getCodeLens(document: TextDocument, token: CancellationToken): Promise<(CodeLens | null)[]> {
    return await this.codeLensManager.provideCodeLenses(document, token)
  }

  public async resolveCodeLens(codeLens: CodeLens, token: CancellationToken): Promise<CodeLens> {
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
    return this.onTypeFormatManager.couldTrigger(document, character) != null
  }

  public async prepareCallHierarchy(document: TextDocument, position: Position, token: CancellationToken): Promise<CallHierarchyItem | CallHierarchyItem[]> {
    return this.callHierarchyManager.prepareCallHierarchy(document, position, token)
  }

  public async provideIncomingCalls(document: TextDocument, item: CallHierarchyItem, token: CancellationToken): Promise<CallHierarchyIncomingCall[]> {
    return this.callHierarchyManager.provideCallHierarchyIncomingCalls(document, item, token)
  }

  public async provideOutgoingCalls(document: TextDocument, item: CallHierarchyItem, token: CancellationToken): Promise<CallHierarchyOutgoingCall[]> {
    return this.callHierarchyManager.provideCallHierarchyOutgoingCalls(document, item, token)
  }

  public getLegend(document: TextDocument, range?: boolean): SemanticTokensLegend | undefined {
    if (range) return this.semanticTokensRangeManager.getLegend(document)
    return this.semanticTokensManager.getLegend(document)
  }

  public hasSemanticTokensEdits(document: TextDocument): boolean {
    return this.semanticTokensManager.hasSemanticTokensEdits(document)
  }

  public async provideDocumentSemanticTokens(document: TextDocument, token: CancellationToken): Promise<SemanticTokens | null> {
    return this.semanticTokensManager.provideDocumentSemanticTokens(document, token)
  }

  public async provideDocumentSemanticTokensEdits(document: TextDocument, previousResultId: string, token: CancellationToken): Promise<SemanticTokens | SemanticTokensDelta | null> {
    return this.semanticTokensManager.provideDocumentSemanticTokensEdits(document, previousResultId, token)
  }

  public async provideDocumentRangeSemanticTokens(document: TextDocument, range: Range, token: CancellationToken): Promise<SemanticTokens> {
    return this.semanticTokensRangeManager.provideDocumentRangeSemanticTokens(document, range, token)
  }

  public async provideInlayHints(document: TextDocument, range: Range, token: CancellationToken): Promise<InlayHintWithProvider[] | null> {
    return this.inlayHintManager.provideInlayHints(document, range, token)
  }

  public async resolveInlayHint(hint: InlayHintWithProvider, token: CancellationToken): Promise<InlayHintWithProvider> {
    return this.inlayHintManager.resolveInlayHint(hint, token)
  }

  public async provideLinkedEdits(document: TextDocument, position: Position, token: CancellationToken): Promise<LinkedEditingRanges> {
    return this.linkedEditingManager.provideLinkedEditingRanges(document, position, token)
  }

  public async provideInlineValues(document: TextDocument, viewPort: Range, context: InlineValueContext, token: CancellationToken): Promise<InlineValue[]> {
    return this.inlineValueManager.provideInlineValues(document, viewPort, context, token)
  }

  public async prepareTypeHierarchy(document: TextDocument, position: Position, token: CancellationToken): Promise<TypeHierarchyItem[]> {
    return this.typeHierarchyManager.prepareTypeHierarchy(document, position, token)
  }

  public async provideTypeHierarchySupertypes(item: TypeHierarchyItemWithSource, token: CancellationToken): Promise<TypeHierarchyItem[]> {
    return this.typeHierarchyManager.provideTypeHierarchySupertypes(item, token)
  }

  public async provideTypeHierarchySubtypes(item: TypeHierarchyItemWithSource, token: CancellationToken): Promise<TypeHierarchyItem[]> {
    return this.typeHierarchyManager.provideTypeHierarchySubtypes(item, token)
  }

  public createDiagnosticCollection(owner: string): DiagnosticCollection {
    return diagnosticManager.create(owner)
  }

  public registerProviderWithEvent<K extends string, P extends withKey<K>, A>(
    selector: DocumentSelector,
    provider: P,
    key: K,
    manager: Mannger<P, A>,
    emitter: Emitter<DocumentSelector>,
    extra?: A): Disposable {
    let disposables: Disposable[] = []
    // Wait the server finish initialize
    let timer = setTimeout(() => {
      emitter.fire(selector)
    }, eventDebounce)
    disposables.push(Disposable.create(() => {
      clearTimeout(timer)
    }))
    Is.func(provider[key]) && disposables.push(provider[key](() => {
      clearTimeout(timer)
      emitter.fire(selector)
    }))
    disposables.push(manager.register(selector, provider, extra))
    return Disposable.create(() => {
      disposeAll(disposables)
      emitter.fire(selector)
    })
  }

  public hasProvider(id: ProviderName, document: TextDocumentMatch): boolean {
    switch (id) {
      case ProviderName.OnTypeEdit:
      case ProviderName.FormatOnType:
        return this.onTypeFormatManager.hasProvider(document)
      case ProviderName.Rename:
        return this.renameManager.hasProvider(document)
      case ProviderName.DocumentLink:
        return this.documentLinkManager.hasProvider(document)
      case ProviderName.DocumentColor:
        return this.documentColorManager.hasProvider(document)
      case ProviderName.FoldingRange:
        return this.foldingRangeManager.hasProvider(document)
      case ProviderName.Format:
        return this.formatManager.hasProvider(document) || this.formatRangeManager.hasProvider(document)
      case ProviderName.CodeAction:
        return this.codeActionManager.hasProvider(document)
      case ProviderName.WorkspaceSymbols:
        return this.workspaceSymbolsManager.hasProvider()
      case ProviderName.FormatRange:
        return this.formatRangeManager.hasProvider(document)
      case ProviderName.Hover:
        return this.hoverManager.hasProvider(document)
      case ProviderName.Signature:
        return this.signatureManager.hasProvider(document)
      case ProviderName.DocumentSymbol:
        return this.documentSymbolManager.hasProvider(document)
      case ProviderName.DocumentHighlight:
        return this.documentHighlightManager.hasProvider(document)
      case ProviderName.Definition:
        return this.definitionManager.hasProvider(document)
      case ProviderName.Declaration:
        return this.declarationManager.hasProvider(document)
      case ProviderName.TypeDefinition:
        return this.typeDefinitionManager.hasProvider(document)
      case ProviderName.Reference:
        return this.referenceManager.hasProvider(document)
      case ProviderName.Implementation:
        return this.implementationManager.hasProvider(document)
      case ProviderName.CodeLens:
        return this.codeLensManager.hasProvider(document)
      case ProviderName.SelectionRange:
        return this.selectionRangeManager.hasProvider(document)
      case ProviderName.CallHierarchy:
        return this.callHierarchyManager.hasProvider(document)
      case ProviderName.SemanticTokens:
        return this.semanticTokensManager.hasProvider(document)
      case ProviderName.SemanticTokensRange:
        return this.semanticTokensRangeManager.hasProvider(document)
      case ProviderName.LinkedEditing:
        return this.linkedEditingManager.hasProvider(document)
      case ProviderName.InlayHint:
        return this.inlayHintManager.hasProvider(document)
      case ProviderName.InlineValue:
        return this.inlineValueManager.hasProvider(document)
      case ProviderName.TypeHierarchy:
        return this.typeHierarchyManager.hasProvider(document)
      default:
        return false
    }
  }
}

export default new Languages()

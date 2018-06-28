import {Neovim} from 'neovim'
import {
  CompletionItemProvider,
  DefinitionProvider,
  TypeDefinitionProvider,
  ImplementationProvider,
  HoverProvider,
  SignatureHelpProvider,
  DocumentSymbolProvider,
  WorkspaceSymbolProvider,
  RenameProvider,
  DocumentFormattingEditProvider,
  DocumentRangeFormattingEditProvider,
  CodeActionProvider,
} from './provider'
import {
  ISource,
  VimCompleteItem,
  CompleteOption,
  CompleteResult,
  SourceType,
  DiagnosticCollection,
} from './types'
import {
  Definition,
  Position,
  CancellationTokenSource,
  CancellationToken,
  CompletionList,
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  TextEdit,
  Location,
  TextDocument,
  Hover,
  SignatureHelp,
  SymbolInformation,
  WorkspaceEdit,
  Range,
  FormattingOptions,
  CodeAction,
  CodeActionContext,
  DocumentSelector,
} from 'vscode-languageserver-protocol'
import {
  CompletionContext,
  CompletionTriggerKind,
  ReferenceProvider,
  ReferenceContext,
} from './provider'
import {
  Disposable,
  echoMessage,
  EventEmitter,
  rangeOfLine,
  Event,
} from './util'
import {
  byteSlice,
} from './util/string'
import diagnosticManager from './diagnostic/manager'
import workspace from './workspace'
import uuid = require('uuid/v4')
import snippetManager from './snippet/manager'
import {diffLines} from './util/diff'
import commands from './commands'
const logger = require('./util/logger')('languages')

export interface CompletionSource {
  id: string
  source: ISource
  languageIds: string[]
}

export function check(_target: any, _key: string, descriptor: any) {
  let fn = descriptor.value
  if (typeof fn !== 'function') {
    return
  }

  descriptor.value = function(...args):any {
    if (this._requesting) this.cancelTokenSource.cancel()
    this._requesting = true
    return Promise.resolve(fn.apply(this, args)).then(res => {
      this._requesting = false
      return res
    })
  }
}

class Languages {
  public nvim:Neovim
  private _onDidCompletionSourceCreated = new EventEmitter<ISource>()
  private completionProviders: CompletionSource[] = []
  private workspaceSymbolMap: Map<string, WorkspaceSymbolProvider> = new Map()
  private renameProviderMap: Map<string, RenameProvider> = new Map()
  private documentFormattingMap: Map<string, DocumentFormattingEditProvider> = new Map()
  private documentRangeFormattingMap: Map<string, DocumentRangeFormattingEditProvider> = new Map()
  private definitionMap: Map<string, DefinitionProvider> = new Map()
  private typeDefinitionMap: Map<string, TypeDefinitionProvider> = new Map()
  private implementationMap: Map<string, ImplementationProvider> = new Map()
  private referencesMap: Map<string, ReferenceProvider> = new Map()
  private hoverProviderMap: Map<string, HoverProvider> = new Map()
  private documentSymbolMap: Map<string, DocumentSymbolProvider> = new Map()
  private signatureHelpProviderMap: Map<string, SignatureHelpProvider> = new Map()
  private codeActionProviderMap: Map<string, CodeActionProvider[]> = new Map()
  private cancelTokenSource: CancellationTokenSource = new CancellationTokenSource()
  public readonly onDidCompletionSourceCreated: Event<ISource> = this._onDidCompletionSourceCreated.event

  public registerCompletionItemProvider(
    name: string,
    shortcut: string,
    languageIds: string | string[],
    provider: CompletionItemProvider,
    triggerCharacters?: string[]
  ):Disposable {
    let id = uuid()
    languageIds = typeof languageIds == 'string' ? [languageIds] : languageIds
    let source = this.createCompleteSource(name, shortcut, provider, languageIds, triggerCharacters)
    this.completionProviders.push({
      id,
      source,
      languageIds: typeof languageIds == 'string' ? [languageIds] : languageIds,
    })
    this._onDidCompletionSourceCreated.fire(source)
    return {
      dispose: () => {
        this.unregisterCompletionItemProvider(id)
      }
    }
  }

  private registerProvider<T>(languageIds: string| string[], provider: T, map:Map<string, T>):Disposable {
    languageIds = typeof languageIds == 'string' ? [languageIds] : languageIds
    for (let languageId of languageIds) {
      map.set(languageId, provider)
    }
    return {
      dispose: () => {
        for (let languageId of languageIds) {
          map.delete(languageId)
        }
      }
    }
  }

  public registerCodeActionProvider(languageIds: string|string[], provider:CodeActionProvider) {
    languageIds = typeof languageIds == 'string' ? [languageIds] : languageIds
    let map = this.codeActionProviderMap
    for (let languageId of languageIds) {
      let providers = map.get(languageId) || []
      providers.push(provider)
      map.set(languageId, providers)
    }
    return {
      dispose: () => {
        for (let languageId of languageIds) {
          let providers = map.get(languageId) || []
          let idx = providers.findIndex(o => o == provider)
          if (idx != -1) {
            providers.splice(idx, 1)
          }
        }
      }
    }
  }

  public registerHoverProvider(languageIds: string| string[], provider:HoverProvider):Disposable {
    return this.registerProvider(languageIds, provider, this.hoverProviderMap)
  }

  public registerDocumentSymbolProvider(languageIds: string| string[], provider:DocumentSymbolProvider):Disposable {
    return this.registerProvider(languageIds, provider, this.documentSymbolMap)
  }

  public registerSignatureHelpProvider(languageIds: string| string[], provider:SignatureHelpProvider):Disposable {
    return this.registerProvider(languageIds, provider, this.signatureHelpProviderMap)
  }

  public registerDefinitionProvider(languageIds: string| string[], provider:DefinitionProvider):Disposable {
    return this.registerProvider(languageIds, provider, this.definitionMap)
  }

  public registerTypeDefinitionProvider(languageIds: string| string[], provider:TypeDefinitionProvider):Disposable {
    return this.registerProvider(languageIds, provider, this.typeDefinitionMap)
  }

  public registerImplementationProvider(languageIds: string| string[], provider:ImplementationProvider):Disposable {
    return this.registerProvider(languageIds, provider, this.implementationMap)
  }

  public registerReferencesProvider(languageIds: string| string[], provider:ReferenceProvider):Disposable {
    return this.registerProvider(languageIds, provider, this.referencesMap)
  }

  public registerRenameProvider(languageIds: string| string[], provider:RenameProvider):Disposable {
    return this.registerProvider(languageIds, provider, this.renameProviderMap)
  }

  public registerWorkspaceSymbolProvider(languageIds: string| string[], provider:WorkspaceSymbolProvider):Disposable {
    return this.registerProvider(languageIds, provider, this.workspaceSymbolMap)
  }

  public registerDocumentFormatProvider(languageIds: string| string[], provider:DocumentFormattingEditProvider):Disposable {
    return this.registerProvider(languageIds, provider, this.documentFormattingMap)
  }

  public registerDocumentRangeFormatProvider(languageIds: string| string[], provider:DocumentRangeFormattingEditProvider):Disposable {
    return this.registerProvider(languageIds, provider, this.documentRangeFormattingMap)
  }

  @check
  public getDeifinition(document:TextDocument, position:Position):Promise<Definition> {
    let provider = this.getProvider(document, this.definitionMap)
    if (!provider) return
    return provider.provideDefinition(document, position, this.token)
  }

  @check
  public getTypeDefinition(document:TextDocument, position:Position):Promise<Definition> {
    let provider = this.getProvider(document, this.typeDefinitionMap)
    if (!provider) return
    return Promise.resolve(provider.provideTypeDefinition(document, position, this.token))
  }

  @check
  public getImplementation(document:TextDocument, position:Position):Promise<Definition> {
    let provider = this.getProvider(document, this.implementationMap)
    if (!provider) return
    return Promise.resolve(provider.provideImplementation(document, position, this.token))
  }

  @check
  public getReferences(document:TextDocument, context:ReferenceContext, position:Position):Promise<Location[]> {
    let provider = this.getProvider(document, this.referencesMap)
    if (!provider) return
    return provider.provideReferences(document, position, context, this.token)
  }

  @check
  public getHover(document:TextDocument, position:Position):Promise<Hover> {
    let provider = this.getProvider(document, this.hoverProviderMap)
    if (!provider) return
    return provider.provideHover(document, position, this.token)
  }

  @check
  public getSignatureHelp(document:TextDocument, position:Position):Promise<SignatureHelp> {
    let provider = this.getProvider(document, this.signatureHelpProviderMap)
    if (!provider) return
    return provider.provideSignatureHelp(document, position, this.token)
  }

  @check
  public getDocumentSymbol(document:TextDocument):Promise<SymbolInformation[]> {
    let provider = this.getProvider(document, this.documentSymbolMap)
    if (!provider) return
    return provider.provideDocumentSymbols(document, this.token)
  }

  @check
  public async getWorkspaceSymbols(document:TextDocument, query: string):Promise<SymbolInformation[]> {
    query = query || ''
    let provider = this.getProvider(document, this.workspaceSymbolMap)
    if (!provider) return
    return provider.provideWorkspaceSymbols(query, this.token)
  }

  @check
  public async resolveWorkspaceSymbol(document:TextDocument, symbol:SymbolInformation):Promise<SymbolInformation> {
    let provider = this.getProvider(document, this.workspaceSymbolMap)
    if (!provider) return
    if (typeof provider.resolveWorkspaceSymbol === 'function') {
      return provider.resolveWorkspaceSymbol(symbol, this.token)
    }
  }

  @check
  public async provideRenameEdits(document:TextDocument, position:Position, newName: string):Promise<WorkspaceEdit> {
    let provider = this.getProvider(document, this.renameProviderMap)
    if (!provider) return
    return await Promise.resolve(provider.provideRenameEdits(document, position, newName, this.token))
  }

  @check
  public async prepareRename(document:TextDocument, position:Position):Promise<Range|false> {
    let provider = this.getProvider(document, this.renameProviderMap)
    if (!provider) return
    if (typeof provider.prepareRename != 'function') return false
    let res = await Promise.resolve(provider.prepareRename(document, position, this.token))
    if (Range.is(res)) return res
    if (Range.is(res.range)) return res.range
  }

  @check
  public async provideDocumentFormattingEdits(document:TextDocument, options:FormattingOptions):Promise<TextEdit[]> {
    let provider = this.getProvider(document, this.documentFormattingMap)
    if (!provider) return
    return await Promise.resolve(provider.provideDocumentFormattingEdits(document, options, this.token))
  }

  @check
  public async provideDocumentRangeFormattingEdits(document:TextDocument, range:Range, options:FormattingOptions):Promise<TextEdit[]> {
    let provider = this.getProvider(document, this.documentRangeFormattingMap)
    if (!provider) return
    return await Promise.resolve(provider.provideDocumentRangeFormattingEdits(document, range, options, this.token))
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
  public async getCodeActions(document:TextDocument, range:Range, context:CodeActionContext):Promise<CodeAction[]> {
    let providers = this.codeActionProviderMap.get(document.languageId)
    if (!providers || providers.length == 0) return []
    let res:CodeAction[] = []
    for (let provider of providers) {
      let actions =  await Promise.resolve(provider.provideCodeActions(document, range, context, this.token))
      for (let action of actions) {
        if (CodeAction.is(action)) {
          res.push(action)
        } else {
          res.push(CodeAction.create(action.title, action))
        }
      }
    }
    return res
  }

  public dispose():void {
    // noop
  }

  public createDiagnosticCollection(owner: string):DiagnosticCollection {
    return diagnosticManager.create(owner)
  }

  public getCompleteSource(languageId: string):ISource | null {
    let {completionProviders} = this
    // only one for each filetype
    let item = completionProviders.find(o => o.languageIds.indexOf(languageId) !== -1)
    return item ? item.source : null
  }

  private createCompleteSource(
    name: string,
    shortcut: string,
    provider: CompletionItemProvider,
    languageIds: string[],
    triggerCharacters: string[],
  ):ISource {
    // track them for resolve
    let completeItems: CompletionItem[] = []
    let hasResolve = typeof provider.resolveCompletionItem === 'function'
    let resolving:string
    let option: CompleteOption

    function resolveItem(item: VimCompleteItem):CompletionItem {
      if (!completeItems || completeItems.length == 0) return null
      let {word} = item
      return completeItems.find(o => {
        let insertText = o.insertText || o.label // tslint:disable-line
        return word == insertText
      })
    }
    return {
      name,
      disabled: false,
      priority: 99,
      sourceType: SourceType.Service,
      filetypes: languageIds,
      triggerCharacters: triggerCharacters || [],
      onCompleteResolve: async (item: VimCompleteItem):Promise<void> => {
        if (!hasResolve) return
        if (completeItems.length == 0) return
        if (resolving) {
          this.cancelTokenSource.cancel()
        }
        resolving = item.word
        let resolved:CompletionItem
        let prevItem = resolveItem(item)
        prevItem.data = prevItem.data || {}
        if (!prevItem) return
        if (prevItem.data.resolved) {
          resolved = prevItem
        } else {
          prevItem.data.resolving = true
          let token = this.token
          resolved = await provider.resolveCompletionItem(prevItem, this.token)
          prevItem.data.resolving = false
          if (!resolved || token.isCancellationRequested) return
          resolved.data = Object.assign(resolved.data || {}, {
            resolving: false,
            resolved: true
          })
        }
        logger.trace('Resolved complete item', resolved)
        let visible = await this.nvim.call('pumvisible')
        if (visible != 0 && resolving == item.word) {
          // vim have no suppport for update complete item
          let str = resolved.detail ? resolved.detail.trim() : ''
          await echoMessage(this.nvim, str)
          let doc = getDocumentation(resolved)
          if (doc) str += '\n\n' + doc
          if (str.length) {
            // TODO vim has bug with layout change on pumvisible
            // this.nvim.call('coc#util#preview_info', [str]) // tslint:disable-line
          }
        }
        resolving = null
      },
      onCompleteDone: async (item: VimCompleteItem):Promise<void> => {
        let completeItem = resolveItem(item)
        if (!completeItem) return
        setTimeout(async () => {
          try {
            let isConfirm = await this.checkConfirm(completeItem, option)
            if (!isConfirm) return
            let hasSnippet = await this.applyTextEdit(completeItem, option)
            let {additionalTextEdits} = completeItem
            await this.applyAdditionaLEdits(additionalTextEdits, option.bufnr)
            // start snippet listener after additionalTextEdits
            if (hasSnippet) await snippetManager.attach()
            let {command} = completeItem
            if (command) commands.execute(command)
          } catch (e) {
            logger.error(e.stack)
          }
          option = null
          completeItems = []
          resolving = ''
        }, 30)
        return
      },
      doComplete: async (opt:CompleteOption):Promise<CompleteResult|null> => {
        option = opt
        let {triggerCharacter, bufnr, input} = opt
        let firstChar = input.length ? input[0]: ''
        let doc = workspace.getDocument(bufnr)
        let document = doc.textDocument
        let position = getPosition(opt)
        let context:CompletionContext = {
          triggerKind: triggerCharacter ? CompletionTriggerKind.Invoke : CompletionTriggerKind.TriggerCharacter,
          triggerCharacter
        }
        let cancellSource = new CancellationTokenSource()
        let result = await provider.provideCompletionItems(document, position, cancellSource.token, context)
        let isIncomplete = (result as CompletionList).isIncomplete || false
        completeItems = Array.isArray(result) ? result : result.items
        if (firstChar) {
          completeItems = completeItems.filter(item => {
            return item.label[0] == firstChar
          })
        }
        return {
          isIncomplete,
          items: completeItems.map(o => convertVimCompleteItem(o, shortcut))
        }
      }
    }
  }

  public match(documentSelector:DocumentSelector, document:TextDocument):boolean {
    if (documentSelector.length == 0) {
      throw new Error('Invliad document selector')
    }
    let languageIds = documentSelector.map(filter => {
      if (typeof filter == 'string') {
        return filter
      }
      return filter.language
    })
    languageIds = languageIds.filter(s => s != null)
    if (languageIds.length == 0) {
      throw new Error('Invliad document selector')
    }
    let {languageId} = document
    return languageIds.indexOf(languageId) != -1
  }

  private get token():CancellationToken {
    let token = this.cancelTokenSource.token
    if (token.isCancellationRequested) {
      this.cancelTokenSource = new CancellationTokenSource()
      token = this.cancelTokenSource.token
    }
    return token
  }

  private unregisterCompletionItemProvider(id:string):void {
    let idx = this.completionProviders.findIndex(o => o.id == id)
    if (idx !== -1) {
      this.completionProviders.splice(idx, 1)
    }
  }

  private async checkConfirm(item:CompletionItem, option: CompleteOption):Promise<boolean> {
    let {col} = option
    let {nvim} = this
    let mode = await nvim.call('mode')
    if (mode !== 'i') return false
    let inserted = item.insertText || item.label // tslint:disable-line
    let curcol = await nvim.call('col', ['.'])
    if (curcol != col + inserted.length + 1) return false
    return true
  }

  private async applyTextEdit(item:CompletionItem, option: CompleteOption):Promise<boolean> {
    let {nvim} = this
    let {textEdit} = item
    if (!textEdit) return false
    let inserted = item.insertText || item.label // tslint:disable-line
    let {range, newText} = textEdit
    let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet
    let valid = rangeOfLine(range, option.linenr - 1)
    if (!valid) return false
    let document = workspace.getDocument(option.bufnr)
    if (!document) return false
    let line = document.getline(option.linenr - 1)
    let deleteCount = range.end.character - option.colnr + 1
    let character = range.start.character
    // replace inserted word
    let start = line.substr(0, character)
    let end = line.substr(option.col + inserted.length + deleteCount)
    let newLine = `${start}${newText}${end}`
    if (!isSnippet) {
      await nvim.call('setline', [option.linenr, newLine])
      return false
    }
    await snippetManager.insertSnippet(document, option.linenr - 1, newLine)
    return true
  }

  private async applyAdditionaLEdits(textEdits:TextEdit[], bufnr:number):Promise<void> {
    if (!textEdits || textEdits.length == 0) return
    let document = workspace.getDocument(bufnr)
    let orig = document.content
    let text = TextDocument.applyEdits(document.textDocument, textEdits)
    let changedLines = diffLines(orig, text)
    let buffer = await this.nvim.buffer
    await buffer.setLines(changedLines.replacement, {
      start: changedLines.start,
      end: changedLines.end,
      strictIndexing: false,
    })
  }

  private getProvider<T>(document:TextDocument, map:Map<string, T>):T {
    return map.get(document.languageId)
  }
}

function validString(str:any):boolean {
  if (typeof str !== 'string') return false
  return str.length > 0
}

function convertVimCompleteItem(item: CompletionItem, shortcut: string):VimCompleteItem {
  let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet
  let obj: VimCompleteItem = {
    word: item.insertText ? item.insertText : item.label, // tslint:disable-line
    menu: item.detail ? `${item.detail.replace(/\n/, ' ')} [${shortcut}]` : `[${shortcut}]`,
    kind: completionKindString(item.kind),
    sortText: validString(item.sortText) ? item.sortText : item.label,
    filterText: validString(item.filterText) ? item.filterText : item.label,
    isSnippet
  }
  obj.abbr = obj.filterText
  if (isSnippet) obj.abbr = obj.abbr + '~'
  let document = getDocumentation(item)
  if (document) obj.info = document
  // item.commitCharacters not necessary for vim
  return obj
}

function getDocumentation(item: CompletionItem):string | null {
  let { documentation } = item
  if (!documentation) return null
  if (typeof documentation === 'string') return documentation
  return documentation.value
}

function getPosition(opt: CompleteOption):Position {
  let {line, linenr, col} = opt
  let part = byteSlice(line, 0, col - 1)
  return {
    line: linenr - 1,
    character: part.length + 1
  }
}

function completionKindString(kind: CompletionItemKind):string {
  switch (kind) {
    case CompletionItemKind.Text:
      return 'Text'
    case CompletionItemKind.Method:
      return 'Method'
    case CompletionItemKind.Function:
      return 'Function'
    case CompletionItemKind.Constructor:
      return 'Constructor'
    case CompletionItemKind.Field:
      return 'Field'
    case CompletionItemKind.Variable:
      return 'Variable'
    case CompletionItemKind.Class:
      return 'Class'
    case CompletionItemKind.Interface:
      return 'Interface'
    case CompletionItemKind.Module:
      return 'Module'
    case CompletionItemKind.Property:
      return 'Property'
    case CompletionItemKind.Unit:
      return 'Unit'
    case CompletionItemKind.Value:
      return 'Value'
    case CompletionItemKind.Enum:
      return 'Enum'
    case CompletionItemKind.Keyword:
      return 'Keyword'
    case CompletionItemKind.Snippet:
      return 'Snippet'
    case CompletionItemKind.Color:
      return 'Color'
    case CompletionItemKind.File:
      return 'File'
    case CompletionItemKind.Reference:
      return 'Reference'
    case CompletionItemKind.Folder:
      return 'Folder'
    case CompletionItemKind.EnumMember:
      return 'EnumMember'
    case CompletionItemKind.Constant:
      return 'Constant'
    case CompletionItemKind.Struct:
      return 'Struct'
    case CompletionItemKind.Event:
      return 'Event'
    case CompletionItemKind.Operator:
      return 'Operator'
    case CompletionItemKind.TypeParameter:
      return 'TypeParameter'
    default:
      return ''
  }
}

export default new Languages()

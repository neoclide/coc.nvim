import {Neovim} from 'neovim'
import {
  CompletionItemProvider,
} from './provider'
import {
  ISource,
  ILanguage,
  VimCompleteItem,
  CompleteOption,
  CompleteResult,
  SourceType,
  DiagnosticCollection,
} from './types'
import {
  Position,
  CancellationTokenSource,
  CancellationToken,
  CompletionList,
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  TextEdit,
  TextDocument,
} from 'vscode-languageserver-protocol'
import {
  CompletionContext,
  CompletionTriggerKind,
} from './provider'
import {
  Disposable,
  echoMessage,
  EventEmitter,
  rangeOfLine,
  Event,
  wait,
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
import { setTimeout } from 'timers'
const logger = require('./util/logger')('languages')

export interface CompletionProvider {
  id: string
  source: ISource
  languageIds: string[]
}

class Languages implements ILanguage {

  public nvim:Neovim
  private _onDidCompletionSourceCreated = new EventEmitter<ISource>()
  private completionProviders: CompletionProvider[] = []
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
        resolving = item.word
        let resolved:CompletionItem
        let prevItem = resolveItem(item)
        if (!prevItem || prevItem.data.resolving) return
        if (prevItem.data.resolved) {
          resolved = prevItem
        } else {
          prevItem.data.resolving = true
          let token = this.token
          resolved = await provider.resolveCompletionItem(prevItem, this.token)
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
          let str = resolved.detail.trim() || ''
          await echoMessage(this.nvim, str)
          let doc = getDocumentation(resolved)
          if (doc) str += '\n\n' + doc
          if (str.length) {
            // TODO vim has bug with layout change on pumvisible
            // this.nvim.call('coc#util#preview_info', [str]) // tslint:disable-line
          }
        }
      },
      onCompleteDone: async (item: VimCompleteItem):Promise<void> => {
        this.cancelRequest()
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
        // mark items unresolved
        completeItems.forEach(item => {
          let data = item.data || {}
          item.data = Object.assign(data, {resolved: false})
        })
        return {
          isIncomplete,
          items: completeItems.map(o => convertVimCompleteItem(o, shortcut))
        }
      }
    }
  }

  private get token():CancellationToken {
    return this.cancelTokenSource.token
  }

  private cancelRequest():void {
    this.cancelTokenSource.cancel()
    this.cancelTokenSource = new CancellationTokenSource()
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
    logger.debug(0)
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

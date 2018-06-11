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
} from './types'
import {
  Position,
  CancellationTokenSource,
  CompletionList,
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
} from 'vscode-languageserver-protocol'
import {
  CompletionContext,
  CompletionTriggerKind,
} from './provider'
import {
  Disposable,
  echoMessage,
} from './util'
import {byteSlice} from './util/string'
import workspace from './workspace'
import uuid = require('uuid/v4')
const logger = require('./util/logger')('languages')

export interface CompletionProvider {
  id: string
  source: ISource
  languageIds: string[]
  triggerCharacters: string[]
}

class Languages implements ILanguage {

  public nvim:Neovim
  private completionProviders: CompletionProvider[] = []

  // constructor() {
  // }

  public registerCompletionItemProvider(
    name: string,
    shortcut: string,
    languageIds: string | string[],
    provider: CompletionItemProvider,
    triggerCharacters?: string[]
  ):Disposable {
    let id = uuid()
    this.completionProviders.push({
      id,
      source: this.createCompleteSource(name, shortcut, provider),
      languageIds: typeof languageIds == 'string' ? [languageIds] : languageIds,
      triggerCharacters,
    })
    return {
      dispose: () => {
        this.unregisterCompletionItemProvider(id)
      }
    }
  }

  public dispose():void {
    // noop
  }

  public shouldTriggerCompletion(character:string, languageId: string):boolean {
    let {completionProviders} = this
    let item = completionProviders.find(o => o.languageIds.indexOf(languageId) !== -1)
    return item ? item.triggerCharacters.indexOf(character) !== -1 : false
  }

  public getCompleteSource(languageId: string):ISource | null {
    let {completionProviders} = this
    let item = completionProviders.find(o => o.languageIds.indexOf(languageId) !== -1)
    return item ? item.source : null
  }

  private createCompleteSource(name: string, shortcut: string, provider: CompletionItemProvider):ISource {
    // track them for resolve
    let completeItems: CompletionItem[] = null
    let hasResolve = typeof provider.resolveCompletionItem === 'function'
    let cancellSource = null
    return {
      name,
      priority: 9,
      onCompleteResolve: async (item: VimCompleteItem):Promise<void> => {
        if (!hasResolve) return
        if (!completeItems || completeItems.length == 0) return
        let {user_data, word} = item
        let {source} = JSON.parse(user_data)
        // check if this source
        if (source !== name) return
        let origItem = completeItems.find(o => o.label == word)
        if (!origItem) return
        if (cancellSource) cancellSource.cancel()
        cancellSource = new CancellationTokenSource()
        let token = cancellSource.token
        let resolved = origItem.data.resolved? origItem :  await provider.resolveCompletionItem(origItem, token)
        if (!resolved || token.isCancellationRequested) return
        cancellSource = null
        resolved.data.resolved = true
        let visible = await this.nvim.call('pumvisible')
        if (visible == 0) return
        let {detail} = resolved
        // TODO vim should support update completion item
        if (detail) echoMessage(this.nvim, detail) // tslint:disable-line
        let doc = getDocumentation(resolved)
        if (doc) this.nvim.call('coc#util#preview_info', [doc]) // tslint:disable-line
        let idx = completeItems.findIndex(o => word == o.label)
        // save for complete done
        if (idx !== -1) completeItems[idx] = resolved
      },
      onCompleteDone: (item: VimCompleteItem):Promise<void> => {
        return
      },
      async doComplete(opt:CompleteOption):Promise<CompleteResult|null> {
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
          filter: 'abbr',
          items: completeItems.map(o => convertVimCompleteItem(o, shortcut))
        }
      }
    }
  }

  private unregisterCompletionItemProvider(id:string):void {
    let idx = this.completionProviders.findIndex(o => o.id == id)
    if (idx !== -1) {
      this.completionProviders.splice(idx, 1)
    }
  }
}

function convertVimCompleteItem(item: CompletionItem, shortcut: string):VimCompleteItem {
  let obj: VimCompleteItem = {
    abbr: item.label,
    word: item.insertText ? item.insertText : item.label, // tslint:disable-line
    menu: item.detail ? `${item.detail.replace(/\n/, ' ')} [${shortcut}]` : `[${shortcut}]`,
    kind: completionKindString(item.kind),
  }
  let data: any = {}
  let document = getDocumentation(item)
  if (document) obj.info = document
  if (item.insertTextFormat) {
    data.isSnippet = item.insertTextFormat === InsertTextFormat.Snippet
  }
  if (item.filterText) {
    data.filter = item.filterText
  }
  if (item.sortText) {
    data.sortText = item.sortText
  }
  if (item.commitCharacters) {
    data.commitCharacters = item.commitCharacters
  }
  obj.dup = 1
  obj.user_data = JSON.stringify(data)
  return obj
}

function getDocumentation(item: CompletionItem):string {
  let { documentation } = item
  if (!documentation) return ''
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

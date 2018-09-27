import { Neovim } from '@chemzqm/neovim'
import { Range, CompletionItem, CompletionItemKind, Disposable, InsertTextFormat, Position } from 'vscode-languageserver-protocol'
import completes from './completes'
import events from './events'
import Increment from './increment'
import Document from './model/document'
import sources from './sources'
import { CompleteOption, SourceStat, SourceType, VimCompleteItem } from './types'
import { disposeAll, echoErr, isCocItem } from './util'
import { byteSlice, isWord } from './util/string'
import workspace from './workspace'
const logger = require('./util/logger')('completion')

export class Completion implements Disposable {
  private increment: Increment
  private lastChangedI: number
  private nvim: Neovim
  private completing = false
  private disposeables: Disposable[] = []

  public init(nvim): void {
    this.nvim = nvim
    let increment = this.increment = new Increment(nvim)
    this.disposeables.push(events.on('InsertCharPre', this.onInsertCharPre, this))
    this.disposeables.push(events.on('InsertLeave', this.onInsertLeave, this))
    this.disposeables.push(events.on('InsertEnter', this.onInsertEnter, this))
    this.disposeables.push(events.on('TextChangedP', this.onTextChangedP, this))
    this.disposeables.push(events.on('TextChangedI', this.onTextChangedI, this))
    this.disposeables.push(events.on('CompleteDone', this.onCompleteDone, this))

    // stop change emit on completion
    let document: Document = null
    increment.on('start', option => {
      let { bufnr } = option
      document = workspace.getDocument(bufnr)
      if (document) document.paused = true
    })
    increment.on('stop', () => {
      if (!document) return
      document.paused = false
    })
  }

  private getPreference(name: string, defaultValue: any): any {
    return workspace.getConfiguration('coc.preferences').get(name, defaultValue)
  }

  public get hasLatestChangedI(): boolean {
    let { lastChangedI } = this
    return lastChangedI && Date.now() - lastChangedI < 30
  }

  public get option(): CompleteOption | null {
    return completes.option
  }

  public startCompletion(option: CompleteOption): void {
    this._doComplete(option).then(() => {
      this.completing = false
    }).catch(e => {
      echoErr(this.nvim, e.message)
      logger.error('Error happens on complete: ', e.stack)
    })
  }

  public async resumeCompletion(resumeInput: string): Promise<void> {
    let { nvim, increment } = this
    let oldComplete = completes.complete
    try {
      let { colnr, input } = oldComplete.option
      let opt = Object.assign({}, oldComplete.option, {
        input: resumeInput,
        colnr: colnr + resumeInput.length - input.length
      })
      logger.trace(`Resume options: ${JSON.stringify(opt)}`)
      let items = completes.filterCompleteItems(opt)
      logger.trace(`Filtered item length: ${items.length}`)
      if (!items || items.length === 0) {
        increment.stop()
        return
      }
      // make sure input not changed
      if (increment.search == resumeInput) {
        nvim.call('coc#_set_context', [opt.col, items], true)
        await nvim.call('coc#_do_complete', [])
      }
    } catch (e) {
      echoErr(nvim, `completion error: ${e.message}`)
      logger.error(e.stack)
    }
  }

  public toggleSource(name: string): void {
    if (!name) return
    let source = sources.getSource(name)
    if (!source) return
    if (typeof source.toggle === 'function') {
      source.toggle()
    }
  }

  public async sourceStat(): Promise<SourceStat[]> {
    let res: SourceStat[] = []
    let filetype = await this.nvim.eval('&filetype') as string
    let items = sources.getSourcesForFiletype(filetype)
    for (let item of items) {
      res.push({
        name: item.name,
        filepath: item.filepath || '',
        type: item.sourceType == SourceType.Native
          ? 'native' : item.sourceType == SourceType.Remote
            ? 'remote' : 'service',
        disabled: !item.enable
      })
    }
    return res
  }

  private async _doComplete(option: CompleteOption): Promise<void> {
    if (this.completing) return
    this.completing = true
    let { nvim, increment } = this
    // could happen for auto trigger
    increment.start(option)
    let { input } = option
    logger.trace(`options: ${JSON.stringify(option)}`)
    let arr = sources.getCompleteSources(option)
    logger.trace(`Activted sources: ${arr.map(o => o.name).join(',')}`)
    let items = await completes.doComplete(arr, option)
    if (items.length == 0) {
      increment.stop()
      return
    }
    let { search } = increment
    if (search === input) {
      nvim.call('coc#_set_context', [option.col, items], true)
      await nvim.call('coc#_do_complete', [])
    } else {
      if (search) {
        await this.resumeCompletion(search)
      } else {
        increment.stop()
      }
    }
  }

  private async onTextChangedP(): Promise<void> {
    let { increment } = this
    if (increment.latestInsert) {
      if (!increment.isActivted || this.completing) return
      let search = await increment.getResumeInput()
      if (search) await this.resumeCompletion(search)
      return
    }
    if (this.completing || this.hasLatestChangedI) return
    let { option } = completes
    let search = await this.nvim.call('coc#util#get_search', [option.col])
    if (search == null) return
    let item = completes.getCompleteItem(search)
    if (item) await sources.doCompleteResolve(item)
  }

  private async onTextChangedI(): Promise<void> {
    this.lastChangedI = Date.now()
    let { nvim, increment } = this
    let { latestInsertChar } = increment
    if (increment.isActivted) {
      if (this.completing) return
      let search = await increment.getResumeInput()
      if (search != null) return await this.resumeCompletion(search)
      if (latestInsertChar && isWord(latestInsertChar)) return
    } else if (increment.search && !latestInsertChar) {
      // restart when user correct search
      let [, lnum] = await nvim.call('getcurpos')
      let { option } = completes
      if (lnum == option.linenr) {
        let search = await this.nvim.call('coc#util#get_search', [option.col])
        if (search.length < increment.search.length) {
          option.input = search
          increment.start(option)
          await this.resumeCompletion(search)
          return
        }
      }
    }
    if (increment.isActivted || !latestInsertChar) return
    // check trigger
    let shouldTrigger = await this.shouldTrigger(latestInsertChar)
    if (!shouldTrigger) return
    let option = await nvim.call('coc#util#get_complete_option')
    Object.assign(option, { triggerCharacter: latestInsertChar })
    logger.trace('trigger completion with', option)
    this.startCompletion(option)
  }

  private async onCompleteDone(item: VimCompleteItem): Promise<void> {
    if (!isCocItem(item)) return
    let { increment } = this
    try {
      increment.stop()
      completes.addRecent(item.word)
      await sources.doCompleteDone(item)
      completes.reset()
    } catch (e) {
      logger.error(`error on complete done`, e.message)
    }
  }

  private async onInsertLeave(): Promise<void> {
    await this.nvim.call('coc#_hide')
    this.increment.stop()
  }

  private async onInsertEnter(): Promise<void> {
    let autoTrigger = this.getPreference('autoTrigger', 'always')
    if (autoTrigger !== 'always') return
    let trigger = this.getPreference('triggerAfterInsertEnter', true)
    if (trigger) {
      let option = await this.nvim.call('coc#util#get_complete_option')
      this.startCompletion(option)
    }
  }

  private onInsertCharPre(character: string): void {
    let { increment } = this
    increment.lastInsert = {
      character,
      timestamp: Date.now(),
    }
  }

  private async shouldTrigger(character: string): Promise<boolean> {
    if (!character || character == ' ') return false
    let { nvim } = this
    let autoTrigger = this.getPreference('autoTrigger', 'always')
    if (autoTrigger == 'none') return false
    if (isWord(character)) {
      let input = await nvim.call('coc#util#get_input') as string
      return input.length > 0
    } else {
      let buffer = await nvim.buffer
      let languageId = await buffer.getOption('filetype') as string
      return sources.shouldTrigger(character, languageId)
    }
    return false
  }

  public dispose(): void {
    if (this.increment) {
      this.increment.removeAllListeners()
      this.increment.stop()
    }
    disposeAll(this.disposeables)
  }

  public completionKindString(kind: CompletionItemKind): string {
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

  public convertVimCompleteItem(item: CompletionItem, shortcut: string, opt: CompleteOption): VimCompleteItem {
    let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet
    let obj: VimCompleteItem = {
      word: this.getWord(item),
      menu: item.detail ? `${item.detail.replace(/\n/, ' ')} [${shortcut}]` : `[${shortcut}]`,
      kind: this.completionKindString(item.kind),
      sortText: validString(item.sortText) ? item.sortText : item.label,
      filterText: validString(item.filterText) ? item.filterText : item.label,
      isSnippet
    }
    if (item.preselect) obj.sortText = '\0' + obj.sortText
    // tslint:disable-next-line: deprecation
    if (!isSnippet && !item.insertText && item.textEdit) {
      obj.word = item.textEdit.newText
      // make sure we can find it on CompleteDone
      // tslint:disable-next-line: deprecation
      item.insertText = obj.word
    }
    // tslint:disable-next-line: deprecation
    if (isSnippet && item.insertText && !item.textEdit) {
      let line = opt.linenr - 1
      // use textEdit for snippet
      item.textEdit = {
        range: Range.create(line, opt.col - 1, line, opt.colnr - 1),
        // tslint:disable-next-line: deprecation
        newText: item.insertText
      }
    }
    obj.abbr = item.data && item.data.abbr ? item.data.abbr : obj.filterText
    if (item.data && item.data.optional) {
      obj.abbr = obj.abbr + '?'
    }
    if (isSnippet) obj.abbr = obj.abbr + '~'
    let document = this.getDocumentation(item)
    if (document) obj.info = document
    // item.commitCharacters not necessary for vim
    return obj
  }

  public getDocumentation(item: CompletionItem): string | null {
    let { documentation } = item
    if (!documentation) return null
    if (typeof documentation === 'string') return documentation
    return documentation.value
  }

  public getPosition(opt: CompleteOption): Position {
    let { line, linenr, col, colnr } = opt
    let part = byteSlice(line, 0, col - 1)
    return {
      line: linenr - 1,
      character: part.length + 1 + (colnr - col > 1 ? 1 : 0)
    }
  }

  public getWord(item: CompletionItem): string {
    // tslint:disable-next-line: deprecation
    let { label, insertTextFormat, insertText } = item
    if (insertTextFormat == InsertTextFormat.Snippet) {
      return label
    }
    return insertText || label
  }
}

function validString(str: any): boolean {
  if (typeof str !== 'string') return false
  return str.length > 0
}

export default new Completion()

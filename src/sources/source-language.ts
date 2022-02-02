import { CancellationToken, CompletionItem, CompletionItemKind, CompletionList, CompletionTriggerKind, DocumentSelector, InsertReplaceEdit, InsertTextFormat, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import commands from '../commands'
import { CompletionItemProvider } from '../provider'
import snippetManager from '../snippets/manager'
import { SnippetParser } from '../snippets/parser'
import { CompleteOption, CompleteResult, ExtendedCompleteItem, ISource, SourceType } from '../types'
import { getChangedFromEdits, rangeOverlap } from '../util/position'
import { byteIndex, byteLength, byteSlice, characterIndex } from '../util/string'
import { getCharCodes, fuzzyMatch } from '../util/fuzzy'
import window from '../window'
import workspace from '../workspace'
const logger = require('../util/logger')('source-language')

export interface CompleteConfig {
  labels: Map<CompletionItemKind, string>
  snippetsSupport: boolean
  defaultKindText: string
  priority: number
  echodocSupport: boolean
  detailMaxLength: number
  detailField: string
  invalidInsertCharacters: string[]
  floatEnable: boolean
}

export default class LanguageSource implements ISource {
  public priority: number
  public sourceType: SourceType.Service
  private _enabled = true
  private filetype: string
  private resolvedIndexes: Set<number> = new Set()
  private completeItems: CompletionItem[] = []
  constructor(
    public readonly name: string,
    public readonly shortcut: string,
    private provider: CompletionItemProvider,
    public readonly documentSelector: DocumentSelector,
    public readonly triggerCharacters: string[],
    public readonly allCommitCharacters: string[],
    priority: number | undefined,
    private readonly completeConfig: CompleteConfig,
  ) {
    this.priority = typeof priority === 'number' ? priority : completeConfig.priority
  }

  public get enable(): boolean {
    return this._enabled
  }

  public toggle(): void {
    this._enabled = !this._enabled
  }

  public shouldCommit?(item: ExtendedCompleteItem, character: string): boolean {
    let completeItem = this.completeItems[item.index]
    if (!completeItem) return false
    let commitCharacters = [...this.allCommitCharacters, ...(completeItem.commitCharacters || [])]
    return commitCharacters.includes(character)
  }

  public async doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult | null> {
    let { provider, name } = this
    let { triggerCharacter, bufnr } = opt
    this.filetype = opt.filetype
    this.resolvedIndexes.clear()
    this.completeItems = []
    let triggerKind: CompletionTriggerKind = this.getTriggerKind(opt)
    let position = this.getPosition(opt)
    let context: any = { triggerKind, option: opt }
    if (triggerKind == CompletionTriggerKind.TriggerCharacter) context.triggerCharacter = triggerCharacter
    let result: CompletionItem[] | CompletionList | undefined
    try {
      let doc = workspace.getDocument(bufnr)
      result = await Promise.resolve(provider.provideCompletionItems(doc.textDocument, position, token, context))
    } catch (e) {
      // don't disturb user
      logger.error(`Complete "${name}" error:`, e)
      return null
    }
    if (!result || token.isCancellationRequested) return null
    let completeItems = Array.isArray(result) ? result : result.items
    if (!completeItems || completeItems.length == 0) return null
    this.completeItems = completeItems
    let startcol = getStartColumn(opt.line, completeItems)
    let option: CompleteOption = Object.assign({}, opt)
    let prefix: string
    let isIncomplete = typeof result['isIncomplete'] === 'boolean' ? result['isIncomplete'] : false
    if (startcol == null && isIncomplete && this.triggerCharacters.includes(opt.input.slice(-1))) {
      if (completeItems.every(o => o.insertText && !o.insertText.startsWith(opt.input))) {
        startcol = option.col + option.input.length
      }
    }
    if (startcol != null) {
      if (startcol < option.col) {
        prefix = byteSlice(opt.line, startcol, option.col)
      }
      option.col = startcol
    }
    let items: ExtendedCompleteItem[] = completeItems.map((o, index) => {
      let item = this.convertVimCompleteItem(o, this.shortcut, option, prefix)
      item.index = index
      return item
    })
    return { startcol, isIncomplete, items }
  }

  public async onCompleteResolve(item: ExtendedCompleteItem, token: CancellationToken): Promise<void> {
    let { index } = item
    let resolving = this.completeItems[index]
    if (!resolving || this.resolvedIndexes.has(index)) return
    let hasResolve = typeof this.provider.resolveCompletionItem === 'function'
    if (hasResolve) {
      this.resolvedIndexes.add(index)
      try {
        let resolved = await Promise.resolve(this.provider.resolveCompletionItem(Object.assign({}, resolving), token))
        if (!resolved || token.isCancellationRequested) {
          this.resolvedIndexes.delete(index)
        } else if (resolved !== resolving) {
          Object.assign(resolving, resolved)
        }
      } catch (e) {
        this.resolvedIndexes.delete(index)
        logger.error(`Error on complete resolve: ${e.message}`, e.stack)
      }
    }
    if (typeof item.documentation === 'undefined') {
      let { documentation, detail } = resolving
      if (!documentation && !detail) return
      let docs = []
      if (detail && !item.detailShown && detail != item.word) {
        detail = detail.replace(/\n\s*/g, ' ')
        if (detail.length) {
          let isText = /^[\w-\s.,\t\n]+$/.test(detail)
          docs.push({ filetype: isText ? 'txt' : this.filetype, content: detail })
        }
      }
      if (documentation) {
        if (typeof documentation == 'string') {
          docs.push({ filetype: 'markdown', content: documentation })
        } else if (documentation.value) {
          docs.push({
            filetype: documentation.kind == 'markdown' ? 'markdown' : 'txt',
            content: documentation.value
          })
        }
      }
      item.documentation = docs
    }
  }

  public async onCompleteDone(vimItem: ExtendedCompleteItem, opt: CompleteOption): Promise<void> {
    let item = this.completeItems[vimItem.index]
    if (!item) return
    let line = opt.linenr - 1
    if (item.insertText && !item.textEdit) {
      item.textEdit = {
        range: Range.create(line, characterIndex(opt.line, opt.col), line, characterIndex(opt.line, opt.colnr - 1)),
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
  }

  private async applyTextEdit(item: CompletionItem, word: string, option: CompleteOption): Promise<boolean> {
    let { nvim } = workspace
    let { textEdit } = item
    if (!textEdit) return false
    let { line, bufnr, linenr, colnr } = option
    let doc = workspace.getDocument(bufnr)
    if (!doc) return false
    let newText = textEdit.newText
    let range = InsertReplaceEdit.is(textEdit) ? textEdit.replace : textEdit.range
    let characterIndex = byteSlice(line, 0, colnr - 1).length
    // attampt to fix range from textEdit, range should include trigger position
    if (range.end.character < characterIndex) {
      range.end.character = characterIndex
    }
    let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet
    // replace inserted word
    let start = line.slice(0, range.start.character)
    let end = line.slice(range.end.character)
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

  private getTriggerKind(opt: CompleteOption): CompletionTriggerKind {
    let { triggerCharacters } = this
    let isTrigger = triggerCharacters.includes(opt.triggerCharacter)
    let triggerKind: CompletionTriggerKind = CompletionTriggerKind.Invoked
    if (opt.triggerForInComplete) {
      triggerKind = CompletionTriggerKind.TriggerForIncompleteCompletions
    } else if (isTrigger) {
      triggerKind = CompletionTriggerKind.TriggerCharacter
    }
    return triggerKind
  }

  private async applyAdditionalEdits(textEdits: TextEdit[], bufnr: number, snippet: boolean): Promise<void> {
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

  private convertVimCompleteItem(item: CompletionItem, shortcut: string, opt: CompleteOption, prefix: string): ExtendedCompleteItem {
    let { echodocSupport, detailMaxLength, invalidInsertCharacters, detailField, labels, defaultKindText } = this.completeConfig
    let hasAdditionalEdit = item.additionalTextEdits != null && item.additionalTextEdits.length > 0
    let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet || hasAdditionalEdit
    let label = item.label.trim()
    let obj: ExtendedCompleteItem = {
      word: getWord(item, opt, invalidInsertCharacters),
      abbr: label,
      menu: `[${shortcut}]`,
      kind: getKindString(item.kind, labels, defaultKindText),
      sortText: item.sortText || null,
      sourceScore: item['score'] || null,
      filterText: item.filterText || label,
      isSnippet,
      dup: item.data && item.data.dup == 0 ? 0 : 1
    }
    if (prefix) {
      if (!obj.filterText.startsWith(prefix)) {
        if (item.textEdit && fuzzyMatch(getCharCodes(prefix), item.textEdit.newText)) {
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

  private getPosition(opt: CompleteOption): Position {
    let { line, linenr, colnr } = opt
    let part = byteSlice(line, 0, colnr - 1)
    return {
      line: linenr - 1,
      character: part.length
    }
  }
}

/*
 * Check new startcol by check start characters.
 */
export function getStartColumn(line: string, items: CompletionItem[]): number | null {
  let first = items[0]
  if (!first.textEdit) return null
  let range = InsertReplaceEdit.is(first.textEdit) ? first.textEdit.replace : first.textEdit.range
  let { character } = range.start
  for (let i = 1; i < Math.min(10, items.length); i++) {
    let o = items[i]
    if (!o.textEdit) return null
    let r = InsertReplaceEdit.is(o.textEdit) ? o.textEdit.replace : o.textEdit.range
    if (r.start.character !== character) return null
  }
  return byteIndex(line, character)
}

export function getKindString(kind: CompletionItemKind, map: Map<CompletionItemKind, string>, defaultValue = ''): string {
  return map.get(kind) || defaultValue
}

export function getWord(item: CompletionItem, opt: CompleteOption, invalidInsertCharacters: string[]): string {
  let { label, data, insertTextFormat, insertText, textEdit } = item
  let word: string
  let newText: string
  if (data && typeof data.word === 'string') return data.word
  if (textEdit) {
    let range = InsertReplaceEdit.is(textEdit) ? textEdit.replace : textEdit.range
    newText = textEdit.newText
    if (range && range.start.line == range.end.line) {
      let { line, col, colnr } = opt
      let character = characterIndex(line, col)
      if (range.start.character > character) {
        let before = line.slice(character, range.start.character)
        newText = before + newText
      } else {
        let start = line.slice(range.start.character, character)
        if (start.length && newText.startsWith(start)) {
          newText = newText.slice(start.length)
        }
      }
      character = characterIndex(line, colnr - 1)
      if (range.end.character > character) {
        let end = line.slice(character, range.end.character)
        if (newText.endsWith(end)) {
          newText = newText.slice(0, - end.length)
        }
      }
    }
  } else if (insertText) {
    newText = insertText
  }
  if (insertTextFormat == InsertTextFormat.Snippet && newText && newText.includes('$')) {
    let parser = new SnippetParser()
    let text = parser.text(newText)
    word = text ? getValidWord(text, invalidInsertCharacters) : label
  } else {
    word = getValidWord(newText, invalidInsertCharacters) || label
  }
  return word || ''
}

export function getValidWord(text: string, invalidChars: string[], start = 2): string {
  if (!text) return ''
  if (!invalidChars.length) return text
  for (let i = start; i < text.length; i++) {
    let c = text[i]
    if (invalidChars.includes(c)) {
      return text.slice(0, i)
    }
  }
  return text
}

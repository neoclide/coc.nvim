'use strict'
import { Range } from 'vscode-languageserver-types'
import { getLineAndPosition } from '../core/ui'
import snippetManager from '../snippets/manager'
import { CancellationToken } from '../util/protocol'
import { byteSlice, characterIndex } from '../util/string'
import workspace from '../workspace'
import Source from './source'
import * as Is from '../util/is'
import { CompleteOption, CompleteResult, ExtendedCompleteItem } from './types'

export default class VimSource extends Source {

  private async callOptionalFunc(fname: string, args: any[]): Promise<any> {
    let exists = this.optionalFns.includes(fname)
    if (!exists) return null
    let name = `coc#source#${this.name}#${fname}`
    return await this.nvim.call(name, args)
  }

  public async checkComplete(opt: CompleteOption): Promise<boolean> {
    let shouldRun = await super.checkComplete(opt)
    if (!shouldRun) return false
    if (!this.optionalFns.includes('should_complete')) return true
    let res = await this.callOptionalFunc('should_complete', [opt])
    return !!res
  }

  public async refresh(): Promise<void> {
    await this.callOptionalFunc('refresh', [])
  }

  public async insertSnippet(insertText: string, opt: CompleteOption): Promise<void> {
    let pos = await getLineAndPosition(this.nvim)
    let { line, col } = opt
    let oldIndent = line.match(/^\s*/)[0]
    let newIndent = pos.text.match(/^\s*/)[0]
    // current insert range
    let range = Range.create(pos.line, characterIndex(line, col) + newIndent.length - oldIndent.length, pos.line, pos.character)
    await snippetManager.insertSnippet(insertText, true, range)
  }

  public async onCompleteDone(item: ExtendedCompleteItem, opt: CompleteOption): Promise<void> {
    if (this.optionalFns.includes('on_complete')) {
      await this.callOptionalFunc('on_complete', [item])
    } else if (item.isSnippet && item.insertText) {
      await this.insertSnippet(item.insertText, opt)
    }
  }

  public onEnter(bufnr: number): void {
    if (!this.optionalFns.includes('on_enter')) return
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    let { filetypes } = this
    if (filetypes && !filetypes.includes(doc.filetype)) return
    void this.callOptionalFunc('on_enter', [{
      bufnr,
      uri: doc.uri,
      languageId: doc.filetype
    }])
  }

  public async doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult<ExtendedCompleteItem> | null> {
    let shouldRun = await this.checkComplete(opt)
    if (!shouldRun) return null
    let startcol: number | undefined = await this.callOptionalFunc('get_startcol', [opt])
    if (token.isCancellationRequested) return null
    let { col, input, line, colnr } = opt
    if (Is.number(startcol) && startcol >= 0 && startcol !== col) {
      input = byteSlice(line, startcol, colnr - 1)
      opt = Object.assign({}, opt, {
        col: startcol,
        changed: col - startcol,
        input
      })
    }
    let vimItems = await this.nvim.callAsync('coc#_do_complete', [this.name, opt]) as (ExtendedCompleteItem | string)[]
    if (!vimItems || vimItems.length == 0 || token.isCancellationRequested) return null
    let checkFirst = this.firstMatch && input.length > 0
    let inputFirst = checkFirst ? input[0].toLowerCase() : ''
    let items: ExtendedCompleteItem[] = []
    vimItems.forEach(item => {
      let obj: ExtendedCompleteItem = Is.string(item) ? { word: item } : item
      if (checkFirst) {
        let ch = (obj.filterText ?? obj.word)[0]
        if (inputFirst && ch.toLowerCase() !== inputFirst) return
      }
      if (this.isSnippet) obj.isSnippet = true
      items.push(obj)
    })
    return { items, startcol: Is.number(startcol) ? startcol : undefined }
  }
}

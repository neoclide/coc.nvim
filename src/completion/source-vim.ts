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

export function getMethodName(name: string, names: ReadonlyArray<string>): string | undefined {
  if (names.includes(name)) return name
  let key = name[0].toUpperCase() + name.slice(1)
  if (names.includes(key)) return key
  throw new Error(`${name} not exists`)
}

export function checkInclude(name: string, fns: ReadonlyArray<string>): boolean {
  if (fns.includes(name)) return true
  let key = name[0].toUpperCase() + name.slice(1)
  return fns.includes(key)
}

export default class VimSource extends Source {

  private async callOptionalFunc(fname: string, args: any[], isNotify = false): Promise<any> {
    let exists = checkInclude(fname, this.remoteFns)
    if (!exists) return null
    let name = `coc#source#${this.name}#${getMethodName(fname, this.remoteFns)}`
    if (isNotify) return this.nvim.call(name, args, true)
    return await this.nvim.call(name, args)
  }

  public async checkComplete(opt: CompleteOption): Promise<boolean> {
    let shouldRun = await super.checkComplete(opt)
    if (!shouldRun) return false
    if (!checkInclude('should_complete', this.remoteFns)) return true
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
    if (checkInclude('on_complete', this.remoteFns)) {
      await this.callOptionalFunc('on_complete', [item], true)
    } else if (item.isSnippet && item.insertText) {
      await this.insertSnippet(item.insertText, opt)
    }
  }

  public onEnter(bufnr: number): void {
    let doc = workspace.getDocument(bufnr)
    if (!doc || !checkInclude('on_enter', this.remoteFns)) return
    let { filetypes } = this
    if (filetypes && !filetypes.includes(doc.filetype)) return
    void this.callOptionalFunc('on_enter', [{
      bufnr,
      uri: doc.uri,
      languageId: doc.filetype
    }], true)
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
    const vim9 = this.remoteFns.includes('Complete')
    let vimItems = await this.nvim.callAsync('coc#_do_complete', [this.name, { ...opt, vim9 }]) as (ExtendedCompleteItem | string)[]
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

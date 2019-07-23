import { CancellationToken } from 'vscode-languageserver-protocol'
import { CompleteOption, CompleteResult, VimCompleteItem } from '../types'
import { fuzzyChar } from '../util/fuzzy'
import { byteSlice } from '../util/string'
import workspace from '../workspace'
import Source from './source'
const logger = require('../util/logger')('model-source-vim')

export default class VimSource extends Source {

  private async callOptinalFunc(fname: string, args: any[]): Promise<any> {
    let exists = this.optionalFns.indexOf(fname) !== -1
    if (!exists) return null
    let name = `coc#source#${this.name}#${fname}`
    let res
    try {
      res = await this.nvim.call(name, args)
    } catch (e) {
      workspace.showMessage(`Vim error from source ${this.name}: ${e.message}`, 'error')
      return null
    }
    return res
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let shouldRun = await super.shouldComplete(opt)
    if (!shouldRun) return false
    if (this.optionalFns.indexOf('should_complete') === -1) return true
    let res = await this.callOptinalFunc('should_complete', [opt])
    return !!res
  }

  public async refresh(): Promise<void> {
    await this.callOptinalFunc('refresh', [])
  }

  public async onCompleteDone(item: VimCompleteItem, opt: CompleteOption): Promise<void> {
    await super.onCompleteDone(item, opt)
    if (this.optionalFns.indexOf('on_complete') === -1) return
    this.callOptinalFunc('on_complete', [item]) // tslint:disable-line
  }

  public onEnter(bufnr: number): void {
    if (this.optionalFns.indexOf('on_enter') === -1) return
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    let { filetypes } = this
    if (filetypes && filetypes.indexOf(doc.filetype) == -1) return
    this.callOptinalFunc('on_enter', [{
      bufnr,
      uri: doc.uri,
      languageId: doc.filetype
    }]) // tslint:disable-line
  }

  public async doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult | null> {
    let { col, input, line, colnr } = opt
    let startcol: number | null = await this.callOptinalFunc('get_startcol', [opt])
    if (token.isCancellationRequested) return
    if (startcol) {
      if (startcol < 0) return null
      startcol = Number(startcol)
      // invalid startcol
      if (isNaN(startcol) || startcol < 0) startcol = col
      if (startcol !== col) {
        input = byteSlice(line, startcol, colnr - 1)
        opt = Object.assign({}, opt, {
          col: startcol,
          changed: col - startcol,
          input
        })
      }
    }
    let items: VimCompleteItem[] = await this.nvim.callAsync('coc#util#do_complete', [this.name, opt])
    if (!items || items.length == 0 || token.isCancellationRequested) return null
    if (this.firstMatch && input.length) {
      let ch = input[0]
      items = items.filter(item => {
        let cfirst = item.filterText ? item.filterText[0] : item.word[0]
        return fuzzyChar(ch, cfirst)
      })
    }
    items = items.map(item => {
      if (typeof item == 'string') {
        return { word: item, menu: this.menu, isSnippet: this.isSnippet }
      }
      let menu = item.menu ? item.menu + ' ' : ''
      item.menu = `${menu}${this.menu}`
      item.isSnippet = this.isSnippet
      delete item.user_data
      return item
    })
    let res: CompleteResult = { items }
    if (startcol) res.startcol = startcol
    return res
  }
}

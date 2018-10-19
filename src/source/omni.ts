import { Disposable } from 'vscode-languageserver-protocol'
import Source from '../model/source'
import { CompleteOption, CompleteResult, ISource, VimCompleteItem } from '../types'
import { echoErr, echoMessage } from '../util/index'
import { byteSlice } from '../util/string'
const logger = require('../util/logger')('source-omni')

export default class OmniSource extends Source {
  constructor() {
    super({
      name: 'omni',
      filepath: __filename
    })
  }

  private convertToItems(list: any[], extra: any = {}): VimCompleteItem[] {
    let { menu } = this
    let res = []
    for (let item of list) {
      if (typeof item == 'string') {
        res.push(Object.assign({ word: item, menu }, extra))
      }
      if (item.hasOwnProperty('word')) {
        if (item.menu) extra.info = item.menu
        res.push(Object.assign(item, { menu }, extra))
      }
    }
    return res
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult | null> {
    let func = await this.nvim.eval('&omnifunc') as string
    if (!func) return null
    let { line, colnr, col } = opt
    let { nvim } = this
    if (['LanguageClient#complete'].indexOf('func') !== -1) {
      echoMessage(nvim, `omnifunc ${func} is broken, skipped!`)
      return null
    }
    let startcol: number = col
    try {
      startcol = await nvim.call(func, [1, ''])
      startcol = Number(startcol)
    } catch (e) {
      echoErr(nvim, `vim error from ${func} :${e.message}`)
      return null
    }
    // invalid startcol
    if (isNaN(startcol) || startcol < 0 || startcol > colnr) return null
    let text = byteSlice(line, startcol, colnr)
    let words = await nvim.call(func, [0, text])
    if (words.hasOwnProperty('words')) {
      words = words.words
    }
    let res: CompleteResult = {
      items: this.convertToItems(words)
    }
    if (startcol && startcol !== col && words.length != 0) {
      res.startcol = startcol
      res.engross = true
    }
    return res
  }
}

export function regist(sourceMap: Map<string, ISource>): Disposable {
  sourceMap.set('omni', new OmniSource())
  return Disposable.create(() => {
    sourceMap.delete('omni')
  })
}

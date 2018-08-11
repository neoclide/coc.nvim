import {Neovim} from '@chemzqm/neovim'
import Source from '../model/source'
import {CompleteOption, CompleteResult, SourceConfig, ISource} from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('source-around')

export default class Around extends Source {
  constructor(nvim: Neovim, opts: Partial<SourceConfig>) {
    super(nvim, {
      name: 'around',
      ...opts
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {input} = opt
    if (input.length === 0) return false
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {bufnr} = opt
    let document = workspace.getDocument(bufnr)
    if (!document) return
    let words = document!.words
    let moreWords = document!.getMoreWords()
    words.push(...moreWords)
    words = this.filterWords(words, opt)
    return {
      items: words.map(word => {
        return {
          word,
          menu: this.menu
        }
      })
    }
  }
}

export function regist(sourceMap:Map<string, ISource>):void {
  let {nvim} = workspace
  let config = workspace.getConfiguration('coc.source').get<SourceConfig>('around')
  sourceMap.set('around', new Around(nvim, config))
}

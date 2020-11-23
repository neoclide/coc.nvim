import LRUCache from 'lru-cache'
import { Disposable } from 'vscode-languageserver-protocol'
import Source from '../model/source'
import { CompleteOption, CompleteResult, ISource, VimCompleteItem } from '../types'
const logger = require('../util/logger')('source-lru')

export default class RecentlyUsed extends Source {
  private lru: LRUCache<string, string>

  constructor() {
    super({
      name: 'lru',
      filepath: __filename
    })
    this.lru = new LRUCache()
  }

  private key(opt: CompleteOption): string {
    return `${opt.filetype}/${opt.input}`
  }

  public async onCompleteDone(item: VimCompleteItem, opt: CompleteOption): Promise<void> {
    await super.onCompleteDone(item, opt)
    this.lru.set(this.key(opt), item.word)
  }

  public doComplete(opt: CompleteOption): Promise<CompleteResult> {
    const word = this.lru.get(this.key(opt))
    if (!word) return null

    return Promise.resolve({
      items: [{
        word,
        menu: this.menu,
        sourceScore: this.priority
      }],
    })
  }
}

export function regist(sourceMap: Map<string, ISource>): Disposable {
  sourceMap.set('lru', new RecentlyUsed())
  return Disposable.create(() => {
    sourceMap.delete('lru')
  })
}

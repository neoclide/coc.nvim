import { Neovim } from '@chemzqm/neovim'
import { IList, ListContext, ListItem } from '../../types'
import BasicList from '../basic'
import Mru from '../../model/mru'

export default class LinksList extends BasicList {
  public readonly name = 'lists'
  public readonly defaultAction = 'open'
  public readonly description = 'registed lists of coc.nvim'
  private mru: Mru = new Mru('lists')

  constructor(nvim: Neovim, private readonly listMap: Map<string, IList>) {
    super(nvim)

    this.addAction('open', async item => {
      let { name, interactive } = item.data
      await this.mru.add(name)
      await nvim.command(`CocList ${interactive ? '-I' : ''} ${name}`)
    })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let items: ListItem[] = []
    let mruList = await this.mru.load()
    for (let list of this.listMap.values()) {
      if (list.name == 'lists') continue
      items.push({
        label: `${list.name}\t${list.description || ''}`,
        data: {
          name: list.name,
          interactive: list.interactive,
          score: score(mruList, list.name)
        }
      })
    }
    items.sort((a, b) => {
      return b.data.score - a.data.score
    })
    return items
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocListsDesc /\\t.*$/ contained containedin=CocListsLine', true)
    nvim.command('highlight default link CocListsDesc Comment', true)
    nvim.resumeNotification().catch(_e => {
      // noop
    })
  }
}

function score(list: string[], key: string): number {
  let idx = list.indexOf(key)
  return idx == -1 ? -1 : list.length - idx
}

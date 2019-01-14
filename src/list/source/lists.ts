import { Neovim } from '@chemzqm/neovim'
import { IList, ListContext, ListItem } from '../../types'
import BasicList from '../basic'

export default class LinksList extends BasicList {
  public name = 'lists'
  public defaultAction = 'open'

  constructor(nvim: Neovim, private readonly listMap: Map<string, IList>) {
    super(nvim)

    this.addAction('open', async item => {
      let { name, interactive } = item.data
      nvim.command(`CocList ${interactive ? '-I' : ''} ${name}`)
    })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let items: ListItem[] = []
    for (let list of this.listMap.values()) {
      if (list.name == 'lists') continue
      items.push({
        label: `${list.name}\t${list.description || ''}`,
        data: { name: list.name, interactive: list.interactive }
      })
    }
    return items
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocListsDesc /\\t.*$/ contained containedin=CocListsLine', true)
    nvim.command('highlight default link CocListsDesc Comment', true)
    nvim.resumeNotification()
  }
}

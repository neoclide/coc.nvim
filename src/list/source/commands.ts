import { Neovim } from '@chemzqm/neovim'
import commandManager from '../../commands'
import events from '../../events'
import Mru from '../../model/mru'
import { ListContext, ListItem } from '../../types'
import workspace from '../../workspace'
import BasicList from '../basic'

export default class CommandsList extends BasicList {
  public defaultAction = 'run'
  public description = 'registered commands of coc.nvim'
  public readonly name = 'commands'
  private mru: Mru

  constructor(nvim: Neovim) {
    super(nvim)
    this.mru = workspace.createMru('commands')
    this.addAction('run', async item => {
      let { cmd } = item.data
      await events.fire('Command', [cmd])
      await commandManager.executeCommand(cmd)
      await commandManager.addRecent(cmd)
    })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let items: ListItem[] = []
    let list = commandManager.commandList
    let { titles } = commandManager
    let mruList = await this.mru.load()
    for (let key of titles.keys()) {
      items.push({
        label: `${key}\t${titles.get(key)}`,
        filterText: key,
        data: { cmd: key, score: score(mruList, key) }
      })
    }
    for (let o of list) {
      let { id } = o
      if (!titles.has(id)) {
        items.push({
          label: id,
          filterText: id,
          data: { cmd: id, score: score(mruList, id) }
        })
      }
    }
    items.sort((a, b) => {
      return b.data.score - a.data.score
    })
    return items
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocCommandsTitle /\\t.*$/ contained containedin=CocCommandsLine', true)
    nvim.command('highlight default link CocCommandsTitle Comment', true)
    nvim.resumeNotification().catch(_e => {
      // noop
    })
  }
}

function score(list: string[], key: string): number {
  let idx = list.indexOf(key)
  return idx == -1 ? -1 : list.length - idx
}

import { Neovim } from '@chemzqm/neovim'
import commandManager from '../../commands'
import workspace from '../../workspace'
import events from '../../events'
import extensions from '../../extensions'
import { ListContext, ListItem } from '../../types'
import BasicList from '../basic'
import Mru from '../../model/mru'

export default class CommandsList extends BasicList {
  public defaultAction = 'run'
  public description = 'registed commands of coc.nvim'
  public readonly name = 'commands'
  private mru: Mru

  constructor(nvim: Neovim) {
    super(nvim)
    this.mru = workspace.createMru('commands')
    this.addAction('run', async item => {
      let { cmd } = item.data
      await events.fire('Command', [cmd])
      await commandManager.executeCommand(cmd)
      await this.mru.add(cmd)
    })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let items: ListItem[] = []
    let list = commandManager.commandList
    let { commands } = extensions
    let mruList = await this.mru.load()
    for (let key of Object.keys(commands)) {
      items.push({
        label: `${key}\t${commands[key]}`,
        filterText: key,
        data: { cmd: key, score: score(mruList, key) }
      })
    }
    for (let o of list) {
      let { id } = o
      if (items.findIndex(item => item.filterText == id) == -1) {
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

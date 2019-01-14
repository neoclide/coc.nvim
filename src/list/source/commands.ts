import { Neovim } from '@chemzqm/neovim'
import commandManager from '../../commands'
import extensions from '../../extensions'
import { ListContext, ListItem } from '../../types'
import BasicList from '../basic'

export default class CommandsList extends BasicList {
  public defaultAction = 'run'
  public description = 'search for commands'
  private recentCommands: string[] = []

  constructor(nvim: Neovim) {
    super(nvim)

    this.addAction('run', async item => {
      let { cmd } = item.data
      commandManager.executeCommand(cmd)
      let idx = this.recentCommands.indexOf(cmd)
      if (idx != -1) this.recentCommands.splice(idx, 1)
      this.recentCommands.push(cmd)
    })
  }

  public get name(): string {
    return 'commands'
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let items: ListItem[] = []
    let list = commandManager.commandList
    let { commands } = extensions
    let { recentCommands } = this
    for (let key of Object.keys(commands)) {
      items.push({
        label: `${key}\t${commands[key]}`,
        filterText: key,
        data: { cmd: key, score: recentCommands.indexOf(key) }
      })
    }
    for (let o of list) {
      let { id } = o
      if (items.findIndex(item => item.filterText == id) == -1) {
        items.push({
          label: id,
          filterText: id,
          data: { cmd: id, score: recentCommands.indexOf(id) }
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
    nvim.resumeNotification()
  }
}

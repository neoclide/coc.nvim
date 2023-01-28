'use strict'
import commandManager from '../../commands'
import Mru from '../../model/mru'
import { ListContext, ListItem } from '../types'
import { Extensions as ExtensionsInfo, IExtensionRegistry } from '../../util/extensionRegistry'
import { Registry } from '../../util/registry'
import workspace from '../../workspace'
import BasicList from '../basic'
import { formatListItems, UnformattedListItem } from '../formatting'
import { toText } from '../../util/string'

const extensionRegistry = Registry.as<IExtensionRegistry>(ExtensionsInfo.ExtensionContribution)

export default class CommandsList extends BasicList {
  public defaultAction = 'run'
  public description = 'registered commands of coc.nvim'
  public readonly name = 'commands'
  private mru: Mru

  constructor() {
    super()
    this.mru = workspace.createMru('commands')
    this.addAction('run', async item => {
      await commandManager.fireCommand(item.data.cmd)
    })
    this.addAction('append', async item => {
      let { cmd } = item.data
      await workspace.nvim.feedKeys(`:CocCommand ${cmd} `, 'n', false)
    })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let items: UnformattedListItem[] = []
    let mruList = await this.mru.load()
    let ids: Set<string> = new Set()
    for (const obj of extensionRegistry.onCommands.concat(commandManager.commandList)) {
      let { id, title } = obj
      if (ids.has(id)) continue
      ids.add(id)
      let desc = toText(title)
      items.push({
        label: [id, desc],
        filterText: id + ' ' + desc,
        data: { cmd: id, score: score(mruList, id) }
      })
    }
    items.sort((a, b) => b.data.score - a.data.score)
    return formatListItems(this.alignColumns, items)
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocCommandsTitle /\\t.*$/ contained containedin=CocCommandsLine', true)
    nvim.command('highlight default link CocCommandsTitle Comment', true)
    nvim.resumeNotification(false, true)
  }
}

function score(list: string[], key: string): number {
  let idx = list.indexOf(key)
  return idx == -1 ? -1 : list.length - idx
}

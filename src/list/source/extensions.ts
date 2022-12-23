'use strict'
import { URI } from 'vscode-uri'
import { ExtensionManager } from '../../extension/manager'
import extensions from '../../extension'
import { getConditionValue, wait } from '../../util'
import { fs, os, path } from '../../util/node'
import workspace from '../../workspace'
import BasicList from '../basic'
import { formatListItems, UnformattedListItem } from '../formatting'
import { ListItem } from '../types'
const delay = getConditionValue(50, 0)

interface ItemToSort {
  data: {
    priority?: number,
    id?: string
  }
}

export default class ExtensionList extends BasicList {
  public defaultAction = 'toggle'
  public description = 'manage coc extensions'
  public name = 'extensions'

  constructor(private manager: ExtensionManager) {
    super()
    this.addAction('toggle', async item => {
      let { id, state } = item.data
      if (state == 'disabled') return
      if (state == 'activated') {
        await this.manager.deactivate(id)
      } else {
        await this.manager.activate(id)
      }
      await wait(delay)
    }, { persist: true, reload: true, parallel: true })

    this.addAction('configuration', async item => {
      let { root } = item.data
      let jsonFile = path.join(root, 'package.json')
      if (fs.existsSync(jsonFile)) {
        let lines = fs.readFileSync(jsonFile, 'utf8').split(/\r?\n/)
        let idx = lines.findIndex(s => s.includes('"contributes"'))
        await workspace.jumpTo(URI.file(jsonFile), { line: idx == -1 ? 0 : idx, character: 0 })
      }
    })

    this.addAction('open', async item => {
      let { root } = item.data
      workspace.nvim.call('coc#ui#open_url', [root], true)
    })

    this.addAction('disable', async item => {
      let { id, state } = item.data
      if (state !== 'disabled') await this.manager.toggleExtension(id)
    }, { persist: true, reload: true, parallel: true })

    this.addAction('enable', async item => {
      let { id, state } = item.data
      if (state == 'disabled') await this.manager.toggleExtension(id)
    }, { persist: true, reload: true, parallel: true })

    this.addAction('lock', async item => {
      let { id } = item.data
      this.manager.states.setLocked(id, true)
    }, { persist: true, reload: true })

    this.addAction('help', async item => {
      let { root } = item.data
      let files = fs.readdirSync(root, { encoding: 'utf8' })
      let file = files.find(f => /^readme/i.test(f))
      if (file) await workspace.jumpTo(URI.file(file))
    })

    this.addAction('reload', async item => {
      let { id } = item.data
      await this.manager.reloadExtension(id)
    }, { persist: true, reload: true })

    this.addMultipleAction('uninstall', async items => {
      let ids = []
      for (let item of items) {
        if (item.data.isLocal) continue
        ids.push(item.data.id)
      }
      await this.manager.uninstallExtensions(ids)
    })
  }

  public async loadItems(): Promise<ListItem[]> {
    let items: (UnformattedListItem & ItemToSort)[] = []
    let list = await extensions.getExtensionStates()
    for (let stat of list) {
      let prefix = getExtensionPrefix(stat.state)
      let root = fs.realpathSync(stat.root)
      let locked = stat.isLocked
      items.push({
        label: [`${prefix} ${stat.id}${locked ? ' ' : ''}`, ...(stat.isLocal ? ['[RTP]'] : []), stat.version, root.replace(os.homedir(), '~')],
        filterText: stat.id,
        data: {
          id: stat.id,
          root,
          state: stat.state,
          isLocal: stat.isLocal,
          priority: getExtensionPriority(stat.state)
        }
      })
    }
    items.sort(sortExtensionItem)
    return formatListItems(this.alignColumns, items)
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocExtensionsActivited /\\v^\\*/ contained containedin=CocExtensionsLine', true)
    nvim.command('syntax match CocExtensionsLoaded /\\v^\\+/ contained containedin=CocExtensionsLine', true)
    nvim.command('syntax match CocExtensionsDisabled /\\v^-/ contained containedin=CocExtensionsLine', true)
    nvim.command('syntax match CocExtensionsName /\\v%3c\\S+/ contained containedin=CocExtensionsLine', true)
    nvim.command('syntax match CocExtensionsRoot /\\v\\t[^\\t]*$/ contained containedin=CocExtensionsLine', true)
    nvim.command('syntax match CocExtensionsLocal /\\v\\[RTP\\]/ contained containedin=CocExtensionsLine', true)
    nvim.command('highlight default link CocExtensionsActivited Special', true)
    nvim.command('highlight default link CocExtensionsLoaded Normal', true)
    nvim.command('highlight default link CocExtensionsDisabled Comment', true)
    nvim.command('highlight default link CocExtensionsName String', true)
    nvim.command('highlight default link CocExtensionsLocal MoreMsg', true)
    nvim.command('highlight default link CocExtensionsRoot Comment', true)
    nvim.resumeNotification(false, true)
  }
}

export function sortExtensionItem(a: ItemToSort, b: ItemToSort): number {
  if (a.data.priority != b.data.priority) {
    return b.data.priority - a.data.priority
  }
  return b.data.id > a.data.id ? 1 : -1
}

export function getExtensionPrefix(state: string): string {
  let prefix = '+'
  if (state == 'disabled') {
    prefix = '-'
  } else if (state == 'activated') {
    prefix = '*'
  } else if (state == 'unknown') {
    prefix = '?'
  }
  return prefix
}

export function getExtensionPriority(stat: string): number {
  switch (stat) {
    case 'unknown':
      return 2
    case 'activated':
      return 1
    case 'disabled':
      return -1
    default:
      return 0
  }
}

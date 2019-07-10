import { Neovim } from '@chemzqm/neovim'
import os from 'os'
import path from 'path'
import extensions from '../../extensions'
import { ListContext, ListItem } from '../../types'
import { wait } from '../../util'
import { readdirAsync } from '../../util/fs'
import BasicList from '../basic'
import workspace from '../../workspace'
const logger = require('../../util/logger')('list-extensions')

export default class ExtensionList extends BasicList {
  public defaultAction = 'toggle'
  public description = 'manage coc extensions'
  public name = 'extensions'

  constructor(nvim: Neovim) {
    super(nvim)
    this.addAction('toggle', async item => {
      let { id, state } = item.data
      if (state == 'disabled') return
      if (state == 'activated') {
        extensions.deactivate(id)
      } else {
        extensions.activate(id)
      }
      await wait(100)
    }, { persist: true, reload: true, parallel: true })

    this.addAction('disable', async item => {
      let { id, state } = item.data
      if (state !== 'disabled') await extensions.toggleExtension(id)
    }, { persist: true, reload: true, parallel: true })

    this.addAction('enable', async item => {
      let { id, state } = item.data
      if (state == 'disabled') await extensions.toggleExtension(id)
    }, { persist: true, reload: true, parallel: true })

    this.addAction('lock', async item => {
      let { id } = item.data
      await extensions.toggleLock(id)
    }, { persist: true, reload: true })

    this.addAction('doc', async item => {
      let { root } = item.data
      let files = await readdirAsync(root)
      let file = files.find(f => /^readme/i.test(f))
      if (file) {
        let escaped = await nvim.call('fnameescape', [path.join(root, file)])
        await workspace.callAsync('coc#util#execute', [`edit ${escaped}`])
      }
    })

    this.addAction('reload', async item => {
      let { id, state } = item.data
      if (state == 'disabled') return
      if (state == 'activated') {
        extensions.deactivate(id)
      }
      extensions.activate(id)
      await wait(100)
    }, { persist: true, reload: true })

    this.addMultipleAction('uninstall', async items => {
      let ids = []
      for (let item of items) {
        if (item.data.isLocal) continue
        ids.push(item.data.id)
      }
      extensions.uninstallExtension(ids).catch(e => {
        logger.error(e)
      })
    })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let items: ListItem[] = []
    let list = await extensions.getExtensionStates()
    let lockedList = await extensions.getLockedList()
    for (let stat of list) {
      let prefix = '+'
      if (stat.state == 'disabled') {
        prefix = '-'
      } else if (stat.state == 'activated') {
        prefix = '*'
      } else if (stat.state == 'unknown') {
        prefix = '?'
      }
      let root = await this.nvim.call('resolve', stat.root)
      let locked = lockedList.indexOf(stat.id) !== -1
      items.push({
        label: `${prefix} ${stat.id}${locked ? ' ' : ''}\t${stat.isLocal ? '[RTP]\t' : ''}${stat.version}\t${root.replace(os.homedir(), '~')}`,
        filterText: stat.id,
        data: {
          id: stat.id,
          root,
          state: stat.state,
          isLocal: stat.isLocal,
          priority: getPriority(stat.state)
        }
      })
    }
    items.sort((a, b) => {
      if (a.data.priority != b.data.priority) {
        return b.data.priority - a.data.priority
      }
      return b.data.id - a.data.id ? 1 : -1
    })
    return items
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
    nvim.resumeNotification().catch(_e => {
      // noop
    })
  }
}

function getPriority(stat: string): number {
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

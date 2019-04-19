import { Neovim } from '@chemzqm/neovim'
import extensions from '../../extensions'
import { ListContext, ListItem } from '../../types'
import BasicList from '../basic'
import os from 'os'
import { wait, echoWarning } from '../../util'
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

    this.addAction('open', async item => {
      let { root } = item.data
      let escaped = await nvim.call('fnameescape', root)
      if (process.platform === 'darwin') {
        nvim.call('coc#util#iterm_open', [escaped], true)
      } else {
        await nvim.command(`lcd ${escaped}`)
        nvim.command('terminal', true)
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

    this.addAction('uninstall', async item => {
      let { id, isLocal } = item.data
      if (isLocal) {
        echoWarning(nvim, 'Unable to uninstall extension loaded from &rtp.')
        return
      }
      extensions.uninstallExtension([id]).catch(e => {
        logger.error(e)
      })
    })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let items: ListItem[] = []
    let list = await extensions.getExtensionStates()
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
      items.push({
        label: `${prefix} ${stat.id}\t${stat.isLocal ? '[RTP]\t' : ''}${stat.version}\t${root.replace(os.homedir(), '~')}`,
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

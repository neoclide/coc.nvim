import { Neovim } from '@chemzqm/neovim'
import extensions from '../../extensions'
import { ListContext, ListItem } from '../../types'
import BasicList from '../basic'
import os from 'os'
import { wait } from '../../util'
const logger = require('../../util/logger')('list-extensions')

export default class ExtensionList extends BasicList {
  public defaultAction = 'toggle'
  public description = 'manage extensions'

  constructor(nvim: Neovim) {
    super(nvim)

    this.addAction('toggle', async item => {
      let { id, state } = item.data
      if (state == 'disabled') return
      if (state == 'activited') {
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

    this.addAction('reload', async item => {
      let { id, state } = item.data
      if (state == 'disabled') return
      if (state == 'activited') {
        extensions.deactivate(id)
      }
      extensions.activate(id)
      await wait(100)
    }, { persist: true, reload: true })

    this.addAction('uninstall', async item => {
      let { id } = item.data
      extensions.uninstallExtension([id]).catch(e => {
        logger.error(e)
      })
    })
  }

  public get name(): string {
    return 'extensions'
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let items: ListItem[] = []
    let list = extensions.getExtensionStates()
    for (let stat of list) {
      let prefix = '+'
      if (stat.state == 'disabled') {
        prefix = '-'
      } else if (stat.state == 'activited') {
        prefix = '*'
      } else if (stat.state == 'unknown') {
        prefix = '?'
      }
      items.push({
        label: `${prefix} ${stat.id}\t${stat.root.replace(os.homedir(), '~')}`,
        filterText: stat.id,
        data: {
          id: stat.id,
          state: stat.state
        }
      })
    }
    items.sort((a, b) => {
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
    nvim.command('syntax match CocExtensionsRoot /\\v\\t.*$/ contained containedin=CocExtensionsLine', true)
    nvim.command('highlight default link CocExtensionsActivited Special', true)
    nvim.command('highlight default link CocExtensionsLoaded Normal', true)
    nvim.command('highlight default link CocExtensionsDisabled Comment', true)
    nvim.command('highlight default link CocExtensionsName String', true)
    nvim.command('highlight default link CocExtensionsRoot Comment', true)
    nvim.resumeNotification()
  }
}

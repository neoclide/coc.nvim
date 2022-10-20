'use strict'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { URI } from 'vscode-uri'
import extensions from '../../extension'
import { ListContext, ListItem } from '../../types'
import { wait } from '../../util'
import workspace from '../../workspace'
import window from '../../window'
import BasicList from '../basic'
import { formatListItems, UnformattedListItem } from '../formatting'
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
        await extensions.manager.deactivate(id)
      } else {
        await extensions.manager.activate(id)
      }
      await wait(100)
    }, { persist: true, reload: true, parallel: true })

    this.addAction('configuration', async item => {
      let { root } = item.data
      let jsonFile = path.join(root, 'package.json')
      if (fs.existsSync(jsonFile)) {
        let lines = fs.readFileSync(jsonFile, 'utf8').split(/\r?\n/)
        let idx = lines.findIndex(s => s.includes('"contributes"'))
        await workspace.jumpTo(URI.file(jsonFile).toString(), { line: idx == -1 ? 0 : idx, character: 0 })
      }
    })

    this.addAction('open', async item => {
      let { root } = item.data
      if (workspace.env.isiTerm) {
        nvim.call('coc#ui#iterm_open', [root], true)
      } else {
        nvim.call('coc#ui#open_url', [root], true)
      }
    })

    this.addAction('disable', async item => {
      let { id, state } = item.data
      if (state !== 'disabled') await extensions.manager.toggleExtension(id)
    }, { persist: true, reload: true, parallel: true })

    this.addAction('enable', async item => {
      let { id, state } = item.data
      if (state == 'disabled') await extensions.manager.toggleExtension(id)
    }, { persist: true, reload: true, parallel: true })

    this.addAction('lock', async item => {
      let { id } = item.data
      extensions.states.setLocked(id, true)
    }, { persist: true, reload: true })

    this.addAction('help', async item => {
      let { root } = item.data
      let files = fs.readdirSync(root, { encoding: 'utf8' })
      let file = files.find(f => /^readme/i.test(f))
      if (file) await workspace.callAsync('coc#util#jump', ['edit', path.join(root, file)])
    })

    this.addAction('reload', async item => {
      let { id } = item.data
      await extensions.manager.reloadExtension(id)
    }, { persist: true, reload: true })

    this.addMultipleAction('uninstall', async items => {
      let ids = []
      for (let item of items) {
        if (item.data.isLocal) continue
        ids.push(item.data.id)
      }
      await extensions.manager.uninstallExtensions(ids)
    })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let items: UnformattedListItem[] = []
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
      let locked = stat.isLocked
      items.push({
        label: [`${prefix} ${stat.id}${locked ? ' ' : ''}`, ...(stat.isLocal ? ['[RTP]'] : []), stat.version, root.replace(os.homedir(), '~')],
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

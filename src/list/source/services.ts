import { Neovim } from '@chemzqm/neovim'
import services from '../../services'
import { ListContext, ListItem } from '../../types'
import BasicList from '../basic'
import { wait } from '../../util'

export default class ServicesList extends BasicList {
  public defaultAction = 'toggle'
  public description = 'registed services of coc.nvim'
  public name = 'services'

  constructor(nvim: Neovim) {
    super(nvim)

    this.addAction('toggle', async item => {
      let { id } = item.data
      await services.toggle(id)
      await wait(100)
    }, { persist: true, reload: true })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let stats = services.getServiceStats()
    stats.sort((a, b) => {
      return a.id > b.id ? -1 : 1
    })
    return stats.map(stat => {
      let prefix = stat.state == 'running' ? '*' : ' '
      return {
        label: `${prefix}\t${stat.id}\t[${stat.state}]\t${stat.languageIds.join(', ')}`,
        data: { id: stat.id }
      }
    })
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocServicesPrefix /\\v^./ contained containedin=CocServicesLine', true)
    nvim.command('syntax match CocServicesName /\\v%3c\\S+/ contained containedin=CocServicesLine', true)
    nvim.command('syntax match CocServicesStat /\\v\\t\\[\\w+\\]/ contained containedin=CocServicesLine', true)
    nvim.command('syntax match CocServicesLanguages /\\v(\\])@<=.*$/ contained containedin=CocServicesLine', true)
    nvim.command('highlight default link CocServicesPrefix Special', true)
    nvim.command('highlight default link CocServicesName Type', true)
    nvim.command('highlight default link CocServicesStat Statement', true)
    nvim.command('highlight default link CocServicesLanguages Comment', true)
    nvim.resumeNotification().catch(_e => {
      // noop
    })
  }
}

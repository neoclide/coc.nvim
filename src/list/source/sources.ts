import { Neovim } from '@chemzqm/neovim'
import { Location, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import sources from '../../sources'
import { ListContext, ListItem } from '../../types'
import BasicList from '../basic'

export default class SourcesList extends BasicList {
  public readonly defaultAction = 'toggle'
  public readonly description = 'registered completion sources'
  public readonly name = 'sources'

  constructor(nvim: Neovim) {
    super(nvim)

    this.addAction('toggle', async item => {
      let { name } = item.data
      sources.toggleSource(name)
    }, { persist: true, reload: true })

    this.addAction('refresh', async item => {
      let { name } = item.data
      await sources.refresh(name)
    }, { persist: true, reload: true })

    this.addAction('open', async item => {
      let { location } = item
      if (location) await this.jumpTo(location)
    })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let stats = sources.sourceStats()
    stats.sort((a, b) => {
      if (a.type != b.type) return a.type < b.type ? 1 : -1
      return a.name > b.name ? -1 : 1
    })
    return stats.map(stat => {
      let prefix = stat.disabled ? ' ' : '*'
      let location: Location
      if (stat.filepath) {
        location = Location.create(URI.file(stat.filepath).toString(), Range.create(0, 0, 0, 0))
      }
      return {
        label: `${prefix}\t${stat.name}\t[${stat.shortcut}]\t${stat.priority}\t${stat.filetypes.join(',')}`,
        location,
        data: { name: stat.name }
      }
    })
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocSourcesPrefix /\\v^./ contained containedin=CocSourcesLine', true)
    nvim.command('syntax match CocSourcesName /\\v%3c\\S+/ contained containedin=CocSourcesLine', true)
    nvim.command('syntax match CocSourcesType /\\v\\t\\[\\w+\\]/ contained containedin=CocSourcesLine', true)
    nvim.command('syntax match CocSourcesFileTypes /\\v\\S+$/ contained containedin=CocSourcesLine', true)
    nvim.command('highlight default link CocSourcesPrefix Special', true)
    nvim.command('highlight default link CocSourcesName Type', true)
    nvim.command('highlight default link CocSourcesFileTypes Comment', true)
    nvim.command('highlight default link CocSourcesType Statement', true)
    nvim.resumeNotification().catch(_e => {
      // noop
    })
  }
}

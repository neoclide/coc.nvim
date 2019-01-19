import { Neovim } from '@chemzqm/neovim'
import { Location, Range } from 'vscode-languageserver-types'
import Uri from 'vscode-uri'
import os from 'os'
import sources from '../../sources'
import { ListContext, ListItem } from '../../types'
import workspace from '../../workspace'
import BasicList from '../basic'

export default class SourcesList extends BasicList {
  public defaultAction = 'toggle'
  public description = 'loaded completion sources'

  constructor(nvim: Neovim) {
    super(nvim)

    this.addAction('toggle', async item => {
      let { name } = item.data
      sources.toggleSource(name)
    }, { persist: true, reload: true })

    this.addAction('refresh', async item => {
      let { name } = item.data
      sources.refresh(name)
    }, { persist: true, reload: true })

    this.addAction('open', async item => {
      let { location } = item
      if (location) await workspace.jumpTo(location.uri, location.range.start)
    })
  }

  public get name(): string {
    return 'sources'
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
        location = Location.create(Uri.file(stat.filepath).toString(), Range.create(0, 0, 0, 0))
      }
      return {
        label: `${prefix}\t${stat.name}\t[${stat.type}]\t${stat.filepath.replace(os.homedir(), '~') || ''}`,
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
    nvim.command('syntax match CocSourcesPath /\\v\\f+$/ contained containedin=CocSourcesLine', true)
    nvim.command('highlight default link CocSourcesPrefix Special', true)
    nvim.command('highlight default link CocSourcesName Type', true)
    nvim.command('highlight default link CocSourcesPath Comment', true)
    nvim.command('highlight default link CocSourcesType Statement', true)
    nvim.resumeNotification()
  }
}

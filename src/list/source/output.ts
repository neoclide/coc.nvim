import { Neovim } from '@chemzqm/neovim'
import workspace from '../../workspace'
import { ListContext, ListItem } from '../../types'
import BasicList from '../basic'
import { DocumentLink, Location } from 'vscode-languageserver-types'

export default class OutputList extends BasicList {
  public defaultAction = 'open'
  public name = 'output'
  public description = 'output channels of coc.nvim'

  constructor(nvim: Neovim) {
    super(nvim)

    this.addAction('open', async item => {
      workspace.showOutputChannel(item.label)
    })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let names = workspace.channelNames
    return names.map(n => {
      return { label: n }
    })
  }
}

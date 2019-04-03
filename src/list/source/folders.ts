import { Neovim } from '@chemzqm/neovim'
import { statAsync } from '../../util/fs'
import { ListContext, ListItem } from '../../types'
import workspace from '../../workspace'
import BasicList from '../basic'

export default class FoldList extends BasicList {
  public defaultAction = 'edit'
  public description = 'list of current workspace folders'
  public name = 'folders'

  constructor(nvim: Neovim) {
    super(nvim)

    this.addAction('edit', async item => {
      let newPath = await nvim.call('input', ['Folder:', item.label, 'file'])
      let stat = await statAsync(newPath)
      if (!stat || !stat.isDirectory()) {
        await nvim.command(`echoerr "invalid path: ${newPath}"`)
        return
      }
      workspace.renameWorkspaceFolder(item.label, newPath)
    }, { reload: true, persist: true })

    this.addAction('delete', async item => {
      workspace.removeWorkspaceFolder(item.label)
    }, { reload: true, persist: true })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    return workspace.folderPaths.map(p => {
      return { label: p }
    })
  }
}

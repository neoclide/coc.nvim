'use strict'
import { URI } from 'vscode-uri'
import { ListContext, ListItem } from '../types'
import { statAsync } from '../../util/fs'
import { fs, path } from '../../util/node'
import window from '../../window'
import workspace from '../../workspace'
import BasicList from '../basic'

export default class FoldList extends BasicList {
  public defaultAction = 'edit'
  public description = 'list of current workspace folders'
  public name = 'folders'

  constructor() {
    super()

    this.addAction('edit', async item => {
      let newPath = await this.nvim.call('input', ['Folder: ', item.label, 'dir']) as string
      let stat = await statAsync(newPath)
      if (!stat || !stat.isDirectory()) {
        void window.showErrorMessage(`invalid path: ${newPath}`)
        return
      }
      workspace.workspaceFolderControl.renameWorkspaceFolder(item.label, newPath)
    })

    this.addAction('delete', async item => {
      workspace.workspaceFolderControl.removeWorkspaceFolder(item.label)
    }, { reload: true, persist: true })

    this.addAction('newfile', async (item, context) => {
      let file = await window.requestInput('File name', item.label + '/')
      if (!file) return
      let dir = path.dirname(file)
      let stat = await statAsync(dir)
      if (!stat || !stat.isDirectory()) {
        fs.mkdirSync(dir, { recursive: true })
      }
      await workspace.createFile(file, { overwrite: false, ignoreIfExists: true })
      await this.jumpTo(URI.file(file).toString(), null, context)
    })
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    return workspace.folderPaths.map(p => ({ label: p }))
  }
}

'use strict'
import { URI } from 'vscode-uri'
import { isDirectory, statAsync } from '../../util/fs'
import { fs, path } from '../../util/node'
import window from '../../window'
import workspace from '../../workspace'
import BasicList from '../basic'
import { ListItem } from '../types'

export default class FoldList extends BasicList {
  public defaultAction = 'edit'
  public description = 'list of current workspace folders'
  public name = 'folders'

  constructor() {
    super()

    this.addAction('edit', async item => {
      let newPath = await this.nvim.call('input', ['Folder: ', item.label, 'dir']) as string
      if (!isDirectory(newPath)) {
        void window.showWarningMessage(`invalid path: ${newPath}`)
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
      await workspace.createFile(file, { overwrite: false, ignoreIfExists: true })
      await this.jumpTo(URI.file(file).toString(), null, context)
    })
  }

  public async loadItems(): Promise<ListItem[]> {
    return workspace.folderPaths.map(p => ({ label: p }))
  }
}

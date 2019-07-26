import { Neovim } from '@chemzqm/neovim'
import { statAsync } from '../../util/fs'
import { ListContext, ListItem } from '../../types'
import workspace from '../../workspace'
import BasicList from '../basic'
import {Range, Location} from 'vscode-languageserver-protocol'
import {URI} from 'vscode-uri'
import mkdirp from 'mkdirp'
import path from 'path'
import fs from 'fs'

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

		this.addAction('newfile', async item => {
			let file = await nvim.call('input', ['File name:', item.label + '/'])
			let dir = path.dirname(file)
			if (!fs.existsSync(dir)) {
				mkdirp.sync(dir)
			}
			await workspace.createFile(file, {overwrite: false, ignoreIfExists: true})
			let range = Range.create(0, 0, 0, 0)
			let location = Location.create(URI.file(file).toString(), range)
			await this.jumpTo(location)
		})
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    return workspace.folderPaths.map(p => {
      return { label: p }
    })
  }
}

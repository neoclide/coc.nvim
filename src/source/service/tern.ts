import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../../types'
import Source from '../../model/source'
import IpcService from '../../model/ipcService'
import {ROOT} from '../../constant'
import buffers from '../../buffers'
import path = require('path')
import {wait} from '../../util'
import findRoot = require('find-root')
import fs = require('fs')
const logger = require('../../util/logger')('source-tern')

const modulePath = path.join(ROOT, 'bin/tern.js')
const ternRoot = path.join(ROOT, 'node_modules/tern')

export default class Tern extends Source {
  private service:IpcService | null
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'tern',
      shortcut: 'TERN',
      priority: 8,
      filetypes: ['javascript'],
      ternRoot,
    })
  }

  public async onInit():Promise<void> {
    let {ternRoot} = this.config
    let cwd = await this.nvim.call('getcwd')
    let root = this.findProjectRoot(cwd)
    this.service = new IpcService(modulePath, root, [ternRoot])
    this.service.start()
    logger.info('starting tern server')
  }

  private findProjectRoot(cwd:string):string {
    try {
      return findRoot(cwd, dir => {
        return fs.existsSync(path.join(dir, '.tern-project'))
      })
    } catch (e) {
      return cwd
    }
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {filetype} = opt
    if (!this.checkFileType(filetype)) return false
    if (!this.service || !this.service.isRunnning) {
      await this.onInit()
    }
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {bufnr, filepath, linenr, col, input} = opt
    let {content} = buffers.document
    let {nvim, menu} = this
    if (input.length) {
      // limit result
      col = col + 1
    }
    let items = await this.service.request({
      action: 'complete',
      line: linenr - 1,
      col,
      filename: filepath,
      content
    })
    return {
      items: items.map(item => {
        return {
          ...item,
          menu: item.menu ? `${item.menu} ${menu}` : menu
        }
      })
    }
  }
}

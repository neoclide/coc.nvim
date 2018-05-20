import path = require('path')
import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../../types'
import Source from '../../model/source'
import StdioService from '../../model/stdioService'
import {ROOT} from '../../constant'
import buffers from '../../buffers'
import {echoWarning} from '../../util'
import * as cp from 'child_process'
const logger = require('../../util/logger')('source-jedi')

const execPath = path.join(ROOT, 'bin/jedi_server.py')

export default class Jedi extends Source {
  private service:StdioService | null
  private disabled: boolean
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'jedi',
      shortcut: 'JD',
      priority: 8,
      filetypes: ['python'],
      command: 'python',
    })
    this.disabled = false
  }

  public async onInit(): Promise<void> {
    let {command} = this.config
    try {
      cp.execSync(`${command} -c "import jedi"`)
    } catch (e) {
      await echoWarning(this.nvim, `${command} could not import jedi`)
      this.disabled = true
      return
    }
    this.service = new StdioService(command, [execPath])
    this.service.start()
    logger.info('starting jedi server')
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {filetype, input, line, colnr} = opt
    if (!this.checkFileType(filetype) || this.disabled) return false
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
    let result = await this.service.request(JSON.stringify({
      action: 'complete',
      line: linenr,
      col,
      filename: filepath,
      content
    }))
    let items = []
    try {
      items = JSON.parse(result)
    } catch (e) {
      logger.error(`Bad result from jedi ${result}`)
    }
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

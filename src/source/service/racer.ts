import { Neovim } from 'neovim'
import {
  VimCompleteItem,
  CompleteOption,
  CompleteResult} from '../../types'
import StdioService from '../../model/stdioService'
import ServiceSource from '../../model/source-service'
import workspace from '../../workspace'
import {echoWarning} from '../../util'
import {createTmpFile} from '../../util/fs'
import which = require('which')

const logger = require('../../util/logger')('source-racer')

const typeMap = {
  Struct: 'S', Module: 'M', Function: 'F',
  Crate: 'C',  Let: 'V',    StructField: 'm',
  Impl: 'I',   Enum: 'E',   EnumVariant: 'E',
  Type: 't',   FnArg: 'v',  Trait: 'T',
  Const: 'c'
}

export default class Racer extends ServiceSource {
  private service:StdioService | null
  private disabled:boolean
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'racer',
      shortcut: 'RACER',
      priority: 8,
      filetypes: ['rust'],
      command: 'racer',
    })
    this.disabled = false
  }

  public async onInit():Promise<void> {
    let {command} = this.config
    if (command === 'racer') {
      try {
        which.sync('racer')
      } catch (e) {
        await echoWarning(this.nvim, 'Could not find racer in $PATH')
        this.disabled = true
        return
      }
    }
    this.service = new StdioService(command, ['daemon'])
    this.service.start()
    logger.info('starting racer server')
  }

  public async shouldComplete(opt: CompleteOption):Promise<boolean> {
    let {filetype} = opt
    if (!this.checkFileType(filetype) || this.disabled) return false
    if (!this.service || !this.service.isRunnning) {
      await this.onInit()
    }
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult|null> {
    let {bufnr, filepath, linenr, col, input} = opt
    let {menu} = this
    if (input.length) {
      // limit result
      col = col + 1
    }
    let content = workspace.getDocument(bufnr).content
    let tmpfname = await createTmpFile(content)
    let cmd = `complete-with-snippet ${linenr} ${col} "${filepath}" ${tmpfname}`
    let output = await this.service.request(cmd)
    let lines = output.split(/\r?\n/)
    let items = []
    for (let line of lines) {
      if (!/^MATCH/.test(line)) continue
      line = line.slice(6)
      let completion = line.split(';')
      let kind = typeMap[completion[5]] || ''
      let item:VimCompleteItem = {
        kind,
        word: completion[0],
        abbr: completion[1],
      }
      let doc = completion.slice(7).join(';').trim()
      doc = doc.replace(/^"/, '').replace(/"$/,'')
      doc = doc.replace(/\\n/g, '\n').replace(/\\;/g, ';')
      if (doc) item.info = doc
      items.push(item)
    }
    return{
      items: items.map(item => {
        return {
          ...item,
          menu: item.menu ? `${item.menu} ${menu}` : menu
        }
      })
    }
  }
}

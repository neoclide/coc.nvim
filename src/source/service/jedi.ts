import path = require('path')
import { Neovim } from 'neovim'
import {
  QueryOption,
  CompleteOption,
  CompleteResult} from '../../types'
import ServiceSource from '../../model/source-service'
import StdioService from '../../model/stdioService'
import {ROOT} from '../../constant'
import buffers from '../../buffers'
import {echoWarning} from '../../util'
import * as cp from 'child_process'
const logger = require('../../util/logger')('source-jedi')

const execPath = path.join(ROOT, 'bin/jedi_server.py')
const boolSettings = ['use_filesystem_cache', 'fast_parser',
  'dynamic_params_for_other_modules', 'dynamic_array_additions', 'dynamic_params']

export default class Jedi extends ServiceSource {
  private service:StdioService | null
  private disabled: boolean
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'jedi',
      shortcut: 'JD',
      priority: 8,
      filetypes: ['python'],
      command: 'python',
      showSignature: true,
      bindKeywordprg: true,
    })
    this.disabled = false
  }

  public async onInit(): Promise<void> {
    let {command, showSignature, bindKeywordprg, settings, preloads} = this.config
    let {nvim} = this
    try {
      cp.execSync(`${command} -c "import jedi"`)
    } catch (e) {
      await echoWarning(nvim, `${command} could not import jedi`)
      this.disabled = true
      return
    }
    if (bindKeywordprg) {
      await nvim.command('setl keywordprg=:CocShowDoc')
    }
    if (showSignature) {
      await nvim.command('autocmd CursorHold,CursorHoldI <buffer> :call CocShowSignature()')
    }
    let service = this.service = new StdioService(command, [execPath])
    service.start()
    if (settings) {
      for (let key of Object.keys(settings)) {
        if (boolSettings.indexOf(key) !== -1) {
          let val = settings[key]
          settings[key] = !!val
        }
      }
      await service.request(JSON.stringify({
        action: 'settings',
        settings
      }))
    }
    if (preloads && preloads.length) {
      await service.request(JSON.stringify({
        action: 'preload',
        modules: preloads
      }))
    }
    logger.info('jedi server started')
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

//   public async showDefinition(query:QueryOption):Promise<void> {
// 
//   }

  public async showDocuments(query:QueryOption):Promise<void> {
    let {filename, lnum, col, content} = query
    let result = await this.service.request(JSON.stringify({
      action: 'doc',
      line: lnum,
      col,
      filename,
      content
    }))
    if (result) {
      let texts:string[] = JSON.parse(result)
      if (texts.length) {
        await this.previewMessage(texts.join('\n'))
      } else {
        await this.echoMessage('Not found')
      }
    }
  }

  public async jumpDefinition(query:QueryOption):Promise<void> {
    let {filename, lnum, col, content} = query
    let result = await this.service.request(JSON.stringify({
      action: 'definition',
      line: lnum,
      col,
      filename,
      content
    }))
    let list = JSON.parse(result)
    if (list.length == 1) {
      let {lnum, filename, col} = list[0]
      await this.nvim.call('coc#util#jump_to', [filename, lnum - 1, col - 1])
    } else {
      let msgs = list.map(o => `${o.filename}:${o.lnum}:${col}`)
      let n = await this.promptList(msgs)
      let idx = parseInt(n, 10)
      if (idx && list[idx - 1]) {
        let {lnum, filename, col} = list[idx - 1]
        await this.nvim.call('coc#util#jump_to', [filename, lnum - 1, col - 1])
      }
    }
  }

  public async showSignature(query:QueryOption):Promise<void> {
    let {filename, lnum, col, content} = query
    let line = await this.nvim.call('getline', ['.'])
    let before = line.slice(0, col)
    let after = line.slice(col)
    if (col <= 1) return
    if (/\.\w+$/.test(before) && /\w*\(/.test(after)) {
      col = col + after.indexOf('(') + 1
    }
    let result = await this.service.request(JSON.stringify({
      action: 'signature',
      line: lnum,
      col,
      filename,
      content
    }))
    try {
      let list = JSON.parse(result)
      let lines = list.map(item => {
        return `${item.func}(${item.params.join(',')})`
      })
      await this.echoLines(lines)
    } catch (e) {
      await this.echoMessage('Not found')
    }
  }
}

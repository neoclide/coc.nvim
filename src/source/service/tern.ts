import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../../types'
import ServiceSource from '../../model/source-service'
import IpcService from '../../model/ipcService'
import {ROOT} from '../../constant'
import buffers from '../../buffers'
import {QueryOption} from '../../types'
import path = require('path')
import {echoWarning, escapeSingleQuote} from '../../util'
import findRoot = require('find-root')
import fs = require('fs')
import opn = require('opn')
const logger = require('../../util/logger')('source-tern')

const modulePath = path.join(ROOT, 'bin/tern.js')
const ternRoot = path.join(ROOT, 'node_modules/tern')

export default class Tern extends ServiceSource {
  private service:IpcService | null
  private root:string
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'tern',
      shortcut: 'TERN',
      priority: 8,
      filetypes: ['javascript'],
      ternRoot,
      showSignature: true,
      bindKeywordprg: true,
    })
  }

  public async onInit():Promise<void> {
    let {ternRoot, showSignature, bindKeywordprg} = this.config
    let {nvim} = this
    let cwd = await nvim.call('getcwd')
    let root = this.root = this.findProjectRoot(cwd)
    this.service = new IpcService(modulePath, root, [ternRoot])
    this.service.start()
    if (showSignature) {
      await nvim.command('autocmd CursorHold,CursorHoldI <buffer> :call CocShowSignature()')
    }
    if (bindKeywordprg) {
      await nvim.command('setl keywordprg=:CocShowDoc')
    }
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

  public async findType(query:QueryOption):Promise<void> {
    let {nvim} = this
    let {filename, lnum, col, content} = query
    let res = await this.service.request({
      action: 'type',
      filename,
      line: lnum - 1,
      col,
      content
    })
    let msg = `${res.name||''}: ${res.type}`
    await this.echoMessage(msg)
  }

  public async showDocuments(query:QueryOption):Promise<void> {
    let {nvim} = this
    let {filename, lnum, col, content} = query
    let res = await this.service.request({
      action: 'type',
      filename,
      line: lnum - 1,
      col,
      content
    })
    let {name, exprName, doc, url} = res
    if (doc) {
      let texts = [`## ${exprName || name}`]
      texts = texts.concat(doc.split(/\r?\n/))
      if (url) texts.push(`\nSee: ${url}`)
      await this.previewMessage(texts.join('\n'))
    } else if (url) {
      await opn(url)
    } else {
      await this.echoMessage('Not found')
    }
    logger.debug(JSON.stringify(res))
  }

  public async jumpDefinition(query:QueryOption):Promise<void> {
    let {nvim} = this
    let {filename, lnum, filetype, col, content} = query
    let res = await this.service.request({
      action: 'definition',
      filename,
      line: lnum - 1,
      col,
      content
    })
    let {file, url, start} = res
    if (file) {
      let filepath = path.resolve(this.root, file)
      let doc = await buffers.getFileDocument(nvim, filepath, filetype)
      let pos = doc.positionAt(start)
      await nvim.call('coc#util#jump_to', [filepath, pos.line, pos.character])
    } else if (url) {
      await opn(url)
    } else {
      await this.echoMessage('Not found')
    }
  }

  public async showSignature(query:QueryOption):Promise<void> {
    let {nvim} = this
    let {filename, lnum, col, content} = query
    let line = await nvim.call('getline', ['.'])
    let part = line.slice(0, col)
    let fname
    let ms = part.match(/\.(\w+)\([^(]*$/)
    if (ms) {
      fname = ms[1]
      col = ms.index + 1
    } else if (/\.\w+$/.test(part)) {
      fname = await nvim.call('expand', ['<cword>'])
    }
    if (fname) {
      let res = await this.service.request({
        action: 'type',
        preferFunction: true,
        filename,
        line: lnum - 1,
        col,
        content
      })
      let t = res.type
      if (t && /^fn/.test(t)) {
        await nvim.command('redraw!')
        await nvim.command(`echo '${escapeSingleQuote(fname + ': ' + t)}'`)
        return
      }
    }
  }
}

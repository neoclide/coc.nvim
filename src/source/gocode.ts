import { Neovim } from '@chemzqm/neovim'
import {CompleteOption, CompleteResult, SourceConfig} from '../types'
import Source from '../model/source'
import {echoWarning} from '../util'
import workspace from '../workspace'
import cp from 'child_process'
import which from 'which'
const logger = require('../util/logger')('source-gocode')

export default class Gocode extends Source {
  constructor(nvim: Neovim, opts: Partial<SourceConfig>) {
    super(nvim, { name: 'gocode', ...opts })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {filetype} = opt
    if (filetype != 'go') return false
    if (!this.config.gocode_binary) {
      try {
        which.sync('gocode')
        return true
      } catch (e) {
        echoWarning(this.nvim, 'Could not find gocode in $PATH')
        if (this.enable) this.toggle()
        return false
      }
    }
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult|null> {
    let {filepath, linenr, col, input, bufnr} = opt
    let document = workspace.getDocument(bufnr)

    let {menu} = this
    if (input.length) {
      // limit result
      col = col + 1
    }
    let offset = document.getOffset(linenr, col)
    const child = cp.spawn('gocode', ['-f=vim', 'autocomplete', filepath, `c${offset}`])
    return new Promise((resolve:(CompleteResult)=>void, reject):void => {
      let output = ''
      let exited = false
      child.stdout.on('data', data => {
        output = output + data.toString()
      })
      child.on('exit', () => {
        exited = true
        if (!output) return resolve(null)
        try {
          output = output.replace(/''/g, '\\"')
          let list = JSON.parse(output.replace(/'/g, '"'))
          // logger.debug(list)
          if (list.length < 2) return resolve(null)
          let items = list[1]
          resolve({
            items: items.map(item => {
              return {
                ...item,
                word: item.word.replace(/\($/, ''),
                menu: item.menu ? `${item.menu} ${menu}` : menu
              }
            })
          })
        } catch (e) {
          reject(new Error('invalid output from gocode'))
        }
      })
      setTimeout(() => {
        if (!exited) {
          child.kill('SIGHUP')
          reject(new Error('gocode timeout'))
        }
      }, 2000)
      child.stdin.write(document.content, 'utf8')
      child.stdin.end()
    })
  }
}

import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../../types'
import ServiceSource from '../../model/source-service'
import buffers from '../../buffers'
import {echoWarning} from '../../util'
import * as cp from 'child_process'
import which = require('which')
const {spawn} = require('child_process')
const logger = require('../../util/logger')('source-gocode')

export default class Gocode extends ServiceSource {
  private disabled: boolean
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'gocode',
      shortcut: 'GOC',
      priority: 8,
      filetypes: ['go'],
      command: 'gocode',
    })
    this.disabled = false
  }

  public async onInit():Promise<void> {
    let {command} = this.config
    if (command === 'gocode') {
      try {
        which.sync('gocode')
      } catch (e) {
        await echoWarning(this.nvim, 'Could not find gocode in $PATH')
        this.disabled = true
        return
      }
    }
  }

  public async shouldComplete(opt: CompleteOption):Promise<boolean> {
    let {filetype} = opt
    if (!this.checkFileType(filetype) || this.disabled) return false
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult|null> {
    let {bufnr, filepath, linenr, col, input} = opt
    let {document} = buffers

    let {nvim, menu} = this
    if (input.length) {
      // limit result
      col = col + 1
    }
    let offset = document.getOffset(linenr, col)
    let {command} = this.config
    const child = spawn(command, ['-f=vim', 'autocomplete', filepath, `c${offset}`])
    return new Promise((resolve:(CompleteResult)=>void, reject):void => {
      let output = ''
      let exited = false
      child.stdout.on('data', data => {
        output = output + data.toString()
      })
      child.on('exit', () => {
        let exited = true
        if (!output) return resolve(null)
        try {
          let list = JSON.parse(output.replace(/'/g, '"'))
          logger.debug(list)
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

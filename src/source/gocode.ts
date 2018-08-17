import cp from 'child_process'
import { Disposable } from 'vscode-languageserver-protocol'
import which from 'which'
import Source from '../model/source'
import { CompleteOption, CompleteResult, ISource } from '../types'
import { echoWarning } from '../util'
import workspace from '../workspace'
const logger = require('../util/logger')('source-gocode')

export default class Gocode extends Source {
  constructor() {
    super({
      name: 'gocode',
      filepath: __filename
    })
  }

  public get gocodeBinary(): string {
    return this.getConfig('gocodeBinary', null)
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let { filetype } = opt
    if (filetype != 'go') return false
    if (!this.gocodeBinary) {
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

  public async doComplete(opt: CompleteOption): Promise<CompleteResult | null> {
    let { filepath, linenr, col, input, bufnr } = opt
    let document = workspace.getDocument(bufnr)

    let { menu } = this
    if (input.length) {
      // limit result
      col = col + 1
    }
    let offset = document.getOffset(linenr, col)
    const child = cp.spawn('gocode', ['-f=vim', 'autocomplete', filepath, `c${offset}`])
    return new Promise((resolve: (CompleteResult) => void, reject): void => {
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

export function regist(sourceMap: Map<string, ISource>): Disposable {
  sourceMap.set('gocode', new Gocode())
  return Disposable.create(() => {
    sourceMap.delete('gocode')
  })
}

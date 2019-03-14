import { attach, NeovimClient } from '@chemzqm/neovim'
import * as cp from 'child_process'
import { createHash } from 'crypto'
import workspace from '../workspace'
import { omit } from './lodash'
import { byteLength } from './string'
import uuid = require('uuid/v1')
const logger = require('./logger')('util-highlights')

export interface Highlight {
  // zero-indexed
  line: number
  // zero-indexed
  colStart: number
  // zero-indexed
  colEnd: number
  hlGroup: string
  isMarkdown?: boolean
}

const diagnosticFiletypes = ['Error', 'Warning', 'Info', 'Hint']
const cache: { [hash: string]: Highlight[] } = {}

// get highlights by send text to another neovim instance.
export function getHiglights(lines: string[], filetype: string, startLine = 0): Promise<Highlight[]> {
  const hlMap: Map<number, string> = new Map()
  const content = lines.join('\n')
  if (diagnosticFiletypes.indexOf(filetype) != -1) {
    let highlights = lines.map((_line, i) => {
      return {
        line: startLine + i,
        colStart: 0,
        colEnd: -1,
        hlGroup: `Coc${filetype}Float`
      }
    })
    return Promise.resolve(highlights)
  }
  const id = createHash('md5').update(content).digest('hex') + startLine.toFixed(0)
  if (cache[id]) return Promise.resolve(cache[id])
  const res: Highlight[] = []
  let nvim: NeovimClient
  return new Promise(async (resolve, reject) => {
    let proc = cp.spawn('nvim', ['-u', 'NORC', '-i', 'NONE', '--embed'], {
      shell: false,
      env: omit(process.env, ['NVIM_LISTEN_ADDRESS'])
    })
    const exit = async () => {
      if (!proc.killed) {
        await nvim.quit()
        proc.kill()
      }
    }
    try {
      proc.on('error', err => {
        reject(err)
      })
      setTimeout(() => {
        exit()
        resolve([])
      }, 500)
      nvim = attach({ proc })
      const callback = (method, args) => {
        if (method == 'redraw') {
          for (let arr of args) {
            let [name, ...list] = arr
            if (name == 'hl_attr_define') {
              for (let item of list) {
                let id = item[0]
                let { hi_name } = item[item.length - 1][0]
                hlMap.set(id, hi_name)
              }
            }
            if (name == 'grid_line') {
              // logger.debug('list:', JSON.stringify(list, null, 2))
              for (let def of list) {
                let [, line, col, cells] = def
                if (line >= lines.length) continue
                let colStart = 0
                let hlGroup = ''
                let currId = 0
                // tslint:disable-next-line: prefer-for-of
                for (let i = 0; i < cells.length; i++) {
                  let cell = cells[i]
                  let [ch, hlId, repeat] = cell as [string, number?, number?]
                  repeat = repeat || 1
                  let len = byteLength(ch.repeat(repeat))
                  // append result
                  if (hlId == 0 || (hlId > 0 && hlId != currId)) {
                    if (hlGroup) {
                      res.push({
                        hlGroup,
                        line: line + startLine,
                        colStart,
                        colEnd: col,
                        isMarkdown: filetype == 'markdown'
                      })
                    }
                    colStart = col
                    hlGroup = hlId == 0 ? '' : hlMap.get(hlId)
                  }
                  if (hlId != null) currId = hlId
                  col = col + len
                }
                if (hlGroup) {
                  res.push({
                    hlGroup,
                    line: line + startLine,
                    colStart,
                    colEnd: col,
                    isMarkdown: filetype == 'markdown'
                  })
                }
              }
              cache[id] = res
              // logger.debug('res:', res)
              resolve(res)
              exit()
            }
          }
        }
      }
      nvim.on('notification', callback)
      let { env } = workspace
      await nvim.callAtomic([
        ['nvim_set_option', ['runtimepath', env.runtimepath]],
        ['nvim_command', [`runtime syntax/${filetype}.vim`]],
        ['nvim_command', [`colorscheme ${env.colorscheme}`]],
        ['nvim_command', [`set background=${env.background}`]],
        ['nvim_command', ['set nowrap']],
        ['nvim_command', ['set noswapfile']],
        ['nvim_command', ['set nobackup']],
        ['nvim_command', ['set noshowmode']],
        ['nvim_command', ['set noruler']],
        ['nvim_command', ['set laststatus=0']],
      ])
      let buf = await nvim.buffer
      await buf.setLines(lines, { start: 0, end: -1, strictIndexing: false })
      await buf.setOption('filetype', filetype)
      await nvim.uiAttach(80, lines.length + 1, {
        ext_hlstate: true,
        ext_linegrid: true
      })
    } catch (e) {
      logger.error(e)
      exit()
      reject(e)
    }
  })
}

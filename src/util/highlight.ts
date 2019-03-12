import * as cp from 'child_process'
import { attach, NeovimClient, Neovim } from '@chemzqm/neovim'
import { byteLength } from './string'
import { wait } from '.'
const logger = require('./logger')('util-highlights')

export interface Highlights {
  // zero-indexed
  line: number
  // zero-indexed
  colStart: number
  // zero-indexed
  colEnd: number
  hlGroup: string
}

// get highlights by send text to another neovim instance.
export function getHiglights(lines: string[], filetype: string, client: Neovim): Promise<Highlights[]> {
  const hlMap: Map<number, string> = new Map()
  let nvim: NeovimClient
  let res: Highlights[] = []
  return new Promise(async (resolve, reject) => {
    let proc = cp.spawn('nvim', ['-u', 'NORC', '-i', 'NONE', '--embed'], {
      cwd: __dirname
    })
    proc.on('error', err => {
      reject(err)
    })
    nvim = attach({ proc })
    const callback = (method, args) => {
      if (method == 'redraw') {
        for (let arr of args) {
          let [name, ...items] = arr
          if (name == 'hl_attr_define') {
            for (let item of items) {
              let id = item[0]
              let { hi_name } = item[item.length - 1][0]
              hlMap.set(id, hi_name)
            }
          }
        }
      }
    }
    nvim.on('notification', callback)
    await nvim.uiAttach(120, 80, {
      ext_hlstate: true,
      ext_linegrid: true
    })
    let rtp = await client.getOption('rtp') as string
    let colorscheme = await client.getVar('colors_name')
    let background = await client.getOption('background')
    nvim.pauseNotification()
    nvim.setOption('rtp', rtp, true)
    nvim.setOption('background', background)
    nvim.command(`colorscheme ${colorscheme}`, true)
    await nvim.resumeNotification()
    await wait(20)
    nvim.removeListener('notification', callback)
    let buf = await nvim.buffer
    await buf.setLines(lines, { start: 0, end: -1, strictIndexing: false })
    await buf.setOption('filetype', filetype)
    nvim.once('notification', (method, args) => {
      if (method == 'redraw') {
        // console.log(JSON.stringify(args, null, 2))
        for (let arr of args) {
          let [name, ...list] = arr
          if (name == 'grid_line') {
            for (let def of list) {
              let [id, line, col, cells] = def
              if (id !== 1) continue
              let colStart = 0
              let hlGroup = ''
              let currId = 0
              let colEnd = 0
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
                      line,
                      colStart,
                      colEnd
                    })
                  }
                  colStart = col
                  colEnd = col + len
                  hlGroup = hlId == 0 ? '' : hlMap.get(hlId)
                  currId = hlId
                } else if (hlId == null) {
                  colEnd = col + len
                }
                col = col + len
              }
              if (hlGroup) {
                res.push({
                  hlGroup,
                  line,
                  colStart,
                  colEnd: col
                })
              }
            }
          }
        }
        nvim.quit()
        proc.kill()
        resolve(res)
      }
    })
  })
}

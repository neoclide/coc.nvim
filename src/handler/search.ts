import { Neovim } from '@chemzqm/neovim'
import { Mutex } from '../util/mutex'
import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import os from 'os'
import path from 'path'
import readline from 'readline'
import { Range } from 'vscode-languageserver-types'
import which from 'which'
import Highlighter from '../model/highligher'
import { ansiparse } from '../util/ansiparse'
import window from '../window'
import RefactorBuffer, { FileItem, FileRange } from './refactor/buffer'
const logger = require('../util/logger')('handler-search')

const defaultArgs = ['--color', 'ansi', '--colors', 'path:fg:black', '--colors', 'line:fg:green', '--colors', 'match:fg:red', '--no-messages', '--heading', '-n']
const controlCode = '\x1b'

// emit FileItem
class Task extends EventEmitter {
  private process: ChildProcess
  public start(cmd: string, args: string[], cwd: string): void {
    this.process = spawn(cmd, args, { cwd })
    this.process.on('error', e => {
      this.emit('error', e.message)
    })
    const rl = readline.createInterface(this.process.stdout)
    let start: number
    let fileItem: FileItem
    let lines: string[] = []
    let highlights: Range[] = []
    let create = true
    rl.on('line', content => {
      if (content.includes(controlCode)) {
        let items = ansiparse(content)
        if (items[0].foreground == 'black') {
          fileItem = { filepath: path.join(cwd, items[0].text), ranges: [] }
          return
        }
        let normalLine = items[0].foreground == 'green'
        if (normalLine) {
          let lnum = parseInt(items[0].text, 10) - 1
          let padlen = items[0].text.length + 1
          if (create) {
            start = lnum
            create = false
          }
          let line = ''
          for (let item of items) {
            if (item.foreground == 'red') {
              let l = lnum - start
              let c = line.length - padlen
              highlights.push(Range.create(l, c, l, c + item.text.length))
            }
            line += item.text
          }
          let currline = line.slice(padlen)
          lines.push(currline)
        }
      } else {
        let fileEnd = content.trim().length == 0
        if (fileItem && (fileEnd || content.trim() == '--')) {
          let fileRange: FileRange = {
            lines,
            highlights,
            start,
            end: start + lines.length
          }
          fileItem.ranges.push(fileRange)
        }
        if (fileEnd) {
          this.emit('item', fileItem)
          fileItem = null
        }
        lines = []
        highlights = []
        create = true
      }
    })
    rl.on('close', () => {
      if (fileItem) {
        if (lines.length) {
          let fileRange: FileRange = {
            lines,
            highlights,
            start,
            end: start + lines.length
          }
          fileItem.ranges.push(fileRange)
        }
        this.emit('item', fileItem)
      }
      lines = highlights = fileItem = null
      this.emit('end')
    })
  }

  public dispose(): void {
    if (this.process) {
      this.process.kill()
    }
  }
}

export default class Search {
  private task: Task
  constructor(private nvim: Neovim, private cmd = 'rg') {
  }

  public run(args: string[], cwd: string, refactorBuf: RefactorBuffer): Promise<void> {
    let { nvim, cmd } = this
    let { afterContext, beforeContext } = refactorBuf.config
    let argList = ['-A', afterContext.toString(), '-B', beforeContext.toString()].concat(defaultArgs, args)
    if (os.platform() == 'win32') {
      let p = getPathFromArgs(args)
      argList.push('--', p ? `./${p}` : './')
    }
    try {
      cmd = which.sync(cmd)
    } catch (e) {
      window.showMessage(`Please install ripgrep and make sure ${this.cmd} is in your $PATH`, 'error')
      return Promise.reject(e)
    }
    this.task = new Task()
    this.task.start(cmd, argList, cwd)
    let mutex: Mutex = new Mutex()
    let files = 0
    let matches = 0
    let start = Date.now()
    // remaining items
    let fileItems: FileItem[] = []
    const addFileItems = async () => {
      if (fileItems.length == 0) return
      let items = fileItems.slice()
      fileItems = []
      const release = await mutex.acquire()
      try {
        await refactorBuf.addFileItems(items)
      } catch (e) {
        logger.error(e)
      }
      release()
    }
    return new Promise((resolve, reject) => {
      let interval = setInterval(addFileItems, 300)
      this.task.on('item', async (fileItem: FileItem) => {
        files++
        matches = matches + fileItem.ranges.reduce((p, r) => p + r.highlights.length, 0)
        fileItems.push(fileItem)
      })
      this.task.on('error', message => {
        clearInterval(interval)
        window.showMessage(`Error on command "${cmd}": ${message}`, 'error')
        this.task = null
        reject(new Error(message))
      })
      this.task.on('end', async () => {
        clearInterval(interval)
        try {
          await addFileItems()
          const release = await mutex.acquire()
          release()
          this.task.removeAllListeners()
          this.task = null
          let buf = refactorBuf.buffer
          if (buf) {
            nvim.pauseNotification()
            if (files == 0) {
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              buf.setLines(['No match found'], { start: 1, end: 2, strictIndexing: false }, true)
              buf.addHighlight({ line: 1, srcId: -1, colEnd: -1, colStart: 0, hlGroup: 'Error' }).logError()
              buf.setOption('modified', false, true)
            } else {
              let highligher = new Highlighter()
              highligher.addText('Files', 'MoreMsg')
              highligher.addText(': ')
              highligher.addText(`${files} `, 'Number')
              highligher.addText('Matches', 'MoreMsg')
              highligher.addText(': ')
              highligher.addText(`${matches} `, 'Number')
              highligher.addText('Duration', 'MoreMsg')
              highligher.addText(': ')
              highligher.addText(`${Date.now() - start}ms`, 'Number')
              highligher.render(buf, 1, 2)
            }
            buf.setOption('modified', false, true)
            await nvim.resumeNotification(false, true)
          }
        } catch (e) {
          reject(e)
          return
        }
        resolve()
      })
    })
  }
}

// used on windows only since it requires `-- [path]` at the end
function getPathFromArgs(args: string[]): string | undefined {
  if (args.length < 2) return undefined
  let len = args.length
  if (args[len - 1].startsWith('-')) return undefined
  if (['-e', '-f'].includes(args[len - 2])) return undefined
  return args[len - 1]
}

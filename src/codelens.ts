import { Buffer, Neovim } from '@chemzqm/neovim'
import { CodeLens } from 'vscode-languageserver-protocol'
import commandManager from './commands'
import languages from './languages'
import workspace from './workspace'
const logger = require('./util/logger')('codelens')

export interface LineItem {
  lnum: number
  line: string
  resolved: boolean
  codeLenses: CodeLens[]
}

export default class CodeLensBuffer {
  private buffer: Buffer
  private lineItems: Map<number, LineItem> = new Map()
  private hasLines = false
  private startLnum: number
  private lines: string[] = []
  constructor(private nvim: Neovim, private bufnr: number, private codeLens: CodeLens[]) {
    this.init().catch(e => {
      logger.error(e.message)
    })
  }

  private async init(): Promise<void> {
    let { nvim, lineItems } = this
    let buffer = await nvim.buffer
    this.startLnum = await nvim.call('line', ['.'])
    this.bufnr = buffer.id
    let document = workspace.getDocument(this.bufnr)
    await nvim.call('coc#util#open_codelens')
    this.buffer = await nvim.buffer
    for (let codeLens of this.codeLens) {
      let { range } = codeLens
      let { line } = range.start
      let item = lineItems.get(line)
      if (!item) {
        item = {
          line: document.getline(line),
          lnum: line + 1,
          resolved: false,
          codeLenses: []
        }
        lineItems.set(line, item)
      }
      item.codeLenses.push(codeLens)
    }
    let items = Array.from(lineItems.values())
    items.sort((a, b) => a.lnum - b.lnum)
    await this.sequenceResolve(items)
    await this.buffer.setVar('bufnr', this.bufnr)
    await nvim.call('setbufvar', [this.buffer.id, '&readonly', 1])
    await this.jump()
  }

  private async sequenceResolve(lineItems: LineItem[], max = 10): Promise<void> {
    let iterable = lineItems.slice()
    while (iterable.length) {
      let items = iterable.splice(0, max)
      items = await Promise.all(items.map(item => {
        return this.resolveItem(item)
      }))
      await this.insertLines(items)
    }
  }

  private async insertLines(items: LineItem[]): Promise<void> {
    let { buffer } = this
    items = items.filter(o => o.resolved)
    let lines = items.map(item => {
      let commands = item.codeLenses.map(codeLens => codeLens.command)
      commands = commands.filter(c => c && c.title)
      return `${item.lnum}` + '\u000c'
        + `${commands.map(c => c.title.replace(/,/g, ' ')).join(',')}`
        + '\u000c' + `${item.line.trim()}`
    })
    this.lines.push(...lines)
    if (!this.hasLines) {
      await buffer.setLines(lines, {
        start: 0,
        end: 1,
        strictIndexing: false
      })
      this.hasLines = true
    } else {
      await buffer.append(lines)
    }
  }

  private async jump(): Promise<void> {
    let { startLnum, nvim, lineItems, buffer } = this
    let start = startLnum - 1
    let lnums = Array.from(lineItems.keys())
    lnums.sort((a, b) => b - a)
    let buf = await nvim.buffer
    if (buf.id == buffer.id) {
      for (let lnum of lnums) {
        if (lnum <= start) {
          let idx = this.lines.findIndex(line => line.startsWith(`${lnum + 1}\u000c`))
          if (idx != -1) {
            await nvim.command(`normal! ${idx + 1}G`)
          }
          break
        }
      }
    }
  }

  private async resolveItem(item: LineItem): Promise<LineItem> {
    let { codeLenses } = item
    let document = workspace.getDocument(this.bufnr)
    if (!document) return
    codeLenses = await Promise.all(codeLenses.map(codeLens => {
      return languages.resolveCodeLens(codeLens)
    }))
    Object.assign(item, { resolved: true, codeLenses })
    return item
  }

  public async doAction(lnum: number): Promise<void> {
    let item = this.lineItems.get(lnum - 1)
    if (item) {
      let commands = item.codeLenses.map(o => o.command)
      commands = commands.filter(o => o.command && o.command != '')
      if (commands.length == 1) {
        commandManager.execute(commands[0])
      } else if (commands.length > 1) {
        let idx = await workspace.showQuickpick(commands.map(o => o.title), 'choose command:')
        if (idx != -1) {
          commandManager.execute(commands[idx])
        }
      }
    }
  }

  public dispose(): void {
    let { nvim, buffer } = this
    nvim.command(`silent! bd! ${buffer.id}`).catch(e => {
      logger.error(e.message)
    })
  }

}

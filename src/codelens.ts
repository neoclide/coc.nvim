import { Buffer, NeovimClient as Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CodeLens, Disposable, TextDocument } from 'vscode-languageserver-protocol'
import { Document } from '.'
import events from './events'
import commandManager from './commands'
import languages from './languages'
import services from './services'
import { disposeAll, wait } from './util'
import workspace from './workspace'
const logger = require('./util/logger')('codelens')
const srcId = 1080

export default class CodeLensManager {
  private separator: string
  private disposables: Disposable[] = []
  private codeLensMap: Map<number, CodeLens[]> = new Map()
  private resolveCodeLens: Function & { clear(): void }
  private insertMode = false
  constructor(private nvim: Neovim) {
    let config = workspace.getConfiguration('coc.preferences.codeLens')
    this.separator = config.get<string>('separator', '‣')
    let enable = workspace.env.virtualText && config.get<boolean>('enable', true)
    if (enable) {
      let doc = workspace.getDocument(workspace.bufnr)
      if (doc) {
        this.fetchDocumentCodeLenes(doc.textDocument) // tslint:disable-line
      }
      services.on('ready', async id => {
        let service = services.getService(id)
        let doc = await workspace.document
        if (!doc) return
        if (workspace.match(service.selector, doc.textDocument)) {
          await wait(100)
          await this.fetchDocumentCodeLenes(doc.textDocument)
        }
      })

      workspace.onDidChangeTextDocument(async e => {
        if (this.insertMode) return
        let doc = workspace.getDocument(e.textDocument.uri)
        if (doc && doc.bufnr == workspace.bufnr) {
          await wait(100)
          await this.fetchDocumentCodeLenes(doc.textDocument)
        }
      }, null, this.disposables)

      events.on('CursorMoved', () => {
        this.resolveCodeLens()
      }, null, this.disposables)

      events.on('BufEnter', bufnr => {
        setTimeout(async () => {
          if (workspace.bufnr == bufnr) {
            let doc = workspace.getDocument(bufnr)
            if (doc) await this.fetchDocumentCodeLenes(doc.textDocument)
          }
        }, 100)
      }, null, this.disposables)

      events.on('InsertEnter', () => {
        this.insertMode = true
      }, null, this.disposables)

      events.on('InsertLeave', () => {
        this.insertMode = false
        this.resolveCodeLens()
      }, null, this.disposables)
    }
    this.resolveCodeLens = debounce(() => {
      this._resolveCodeLenes().catch(e => {
        logger.error(e)
      })
    }, 200)
  }

  private async fetchDocumentCodeLenes(doc: TextDocument): Promise<void> {
    let { uri } = doc
    let document = workspace.getDocument(uri)
    if (!this.validDocument(document)) return
    try {
      let codeLenes = await languages.getCodeLens(document.textDocument)
      if (codeLenes && codeLenes.length > 0) {
        this.codeLensMap.set(document.bufnr, codeLenes)
        if (workspace.bufnr == document.bufnr) {
          this.resolveCodeLens.clear()
          await this._resolveCodeLenes(true)
        }
      }
    } catch (e) {
      logger.error(e)
    }
  }

  private async setVirtualText(buffer: Buffer, codeLenes: CodeLens[]): Promise<void> {
    let list: Map<number, CodeLens[]> = new Map()
    for (let codeLens of codeLenes) {
      let { range, command } = codeLens
      if (!command) continue
      let { line } = range.start
      if (list.has(line)) {
        list.get(line).push(codeLens)
      } else {
        list.set(line, [codeLens])
      }
    }
    for (let lnum of list.keys()) {
      let codeLenes = list.get(lnum)
      let commands = codeLenes.map(codeLens => codeLens.command)
      commands = commands.filter(c => c && c.title)
      let chunks = commands.map(c => [c.title + ' ', 'CocCodeLens'] as [string, string])
      chunks.unshift([`${this.separator} `, 'CocCodeLens'])
      await buffer.setVirtualText(srcId, lnum, chunks)
    }
  }

  private async _resolveCodeLenes(clear = false): Promise<void> {
    let { nvim } = this
    let { bufnr } = workspace
    let codeLenes = this.codeLensMap.get(bufnr)
    if (codeLenes && codeLenes.length) {
      // resolve codeLens of current window
      let start = await nvim.call('line', 'w0')
      let end = await nvim.call('line', 'w$')
      if (end >= start) {
        codeLenes = codeLenes.filter(o => {
          let lnum = o.range.start.line + 1
          return lnum >= start && lnum <= end
        })
        if (codeLenes.length) {
          await Promise.all(codeLenes.map(codeLens => {
            return languages.resolveCodeLens(codeLens)
          }))
        }
      } else {
        codeLenes = null
      }
    }
    let buffer = this.nvim.createBuffer(bufnr)
    if (workspace.getDocument(bufnr) == null) return
    if (clear) buffer.clearHighlight({ srcId })
    if (codeLenes && codeLenes.length) await this.setVirtualText(buffer, codeLenes)
  }

  public async doAction(): Promise<void> {
    let { nvim } = this
    let bufnr = await nvim.call('bufnr', '%')
    let line = (await nvim.call('line', '.') as number) - 1
    let codeLenes = this.codeLensMap.get(bufnr)
    if (!codeLenes || codeLenes.length == 0) {
      workspace.showMessage('No codeLenes available', 'warning')
      return
    }
    let list: Map<number, CodeLens[]> = new Map()
    for (let codeLens of codeLenes) {
      let { range, command } = codeLens
      if (!command) continue
      let { line } = range.start
      if (list.has(line)) {
        list.get(line).push(codeLens)
      } else {
        list.set(line, [codeLens])
      }
    }
    let current: CodeLens[] = null
    for (let i = line; i >= 0; i--) {
      if (list.has(i)) {
        current = list.get(i)
        break
      }
    }
    if (!current) {
      workspace.showMessage('No codeLenes available', 'warning')
      return
    }
    let commands = current.map(o => o.command)
    commands = commands.filter(c => c.command != null && c.command != '')
    if (commands.length == 0) {
      workspace.showMessage('CodeLenes command not found', 'warning')
    } else if (commands.length == 1) {
      commandManager.execute(commands[0])
    } else {
      let res = await workspace.showQuickpick(commands.map(c => c.title))
      if (res == -1) return
      commandManager.execute(commands[res])
    }
  }

  private validDocument(doc: Document): boolean {
    if (!doc) return false
    if (doc.schema != 'file' || doc.buftype != '') return false
    return true
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

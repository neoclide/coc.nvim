import { Buffer, NeovimClient as Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CodeLens, Disposable } from 'vscode-languageserver-protocol'
import { Document } from '..'
import commandManager from '../commands'
import events from '../events'
import languages from '../languages'
import services from '../services'
import { disposeAll, wait } from '../util'
import workspace from '../workspace'
const logger = require('../util/logger')('codelens')

export interface CodeLensInfo {
  codeLenes: CodeLens[]
  version: number
}

export default class CodeLensManager {
  private separator: string
  private srcId: number
  private enabled: boolean
  private fetching: Set<number> = new Set()
  private disposables: Disposable[] = []
  private codeLensMap: Map<number, CodeLensInfo> = new Map()
  private resolveCodeLens: Function & { clear(): void }
  constructor(private nvim: Neovim) {
    this.init().catch(e => {
      logger.error(e.message)
    })
  }

  private async init(): Promise<void> {
    this.setConfiguration()
    if (!this.enabled) return
    this.srcId = workspace.createNameSpace('coc-codelens') || 1080
    services.on('ready', async id => {
      let service = services.getService(id)
      let doc = workspace.getDocument(workspace.bufnr)
      if (!doc) return
      if (workspace.match(service.selector, doc.textDocument)) {
        this.resolveCodeLens.clear()
        await wait(2000)
        await this.fetchDocumentCodeLenes()
      }
    })
    let timer: NodeJS.Timer
    workspace.onDidChangeTextDocument(async e => {
      let doc = workspace.getDocument(e.textDocument.uri)
      if (doc && doc.bufnr == workspace.bufnr) {
        if (timer) clearTimeout(timer)
        setTimeout(async () => {
          await this.fetchDocumentCodeLenes()
        }, 100)
      }
    }, null, this.disposables)
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('codelens')) {
        this.setConfiguration()
      }
    }, null, this.disposables)

    events.on(['TextChanged', 'TextChangedI'], async () => {
      this.resolveCodeLens.clear()
    }, null, this.disposables)

    events.on('CursorMoved', () => {
      this.resolveCodeLens()
    }, null, this.disposables)

    events.on('BufUnload', bufnr => {
      let buf = this.nvim.createBuffer(bufnr)
      if (this.nvim.hasFunction('nvim_create_namespace')) {
        buf.clearNamespace(this.srcId)
      } else {
        buf.clearHighlight({ srcId: this.srcId })
      }
    }, null, this.disposables)

    events.on('BufEnter', bufnr => {
      setTimeout(async () => {
        if (workspace.bufnr == bufnr) {
          await this.fetchDocumentCodeLenes()
        }
      }, 100)
    }, null, this.disposables)

    events.on('InsertLeave', async () => {
      let { bufnr } = workspace
      let info = this.codeLensMap.get(bufnr)
      if (info && info.version != this.version) {
        this.resolveCodeLens.clear()
        await wait(50)
        await this.fetchDocumentCodeLenes()
      }
    }, null, this.disposables)

    this.resolveCodeLens = debounce(() => {
      this._resolveCodeLenes().catch(e => {
        logger.error(e)
      })
    }, 200)
  }

  private setConfiguration(): void {
    let { nvim } = this
    let config = workspace.getConfiguration('coc.preferences.codeLens')
    if (Object.keys(config).length == 0) {
      config = workspace.getConfiguration('codeLens')
    }
    this.separator = config.get<string>('separator', '‣')
    this.enabled = nvim.hasFunction('nvim_buf_set_virtual_text') && config.get<boolean>('enable', true)
  }

  private async fetchDocumentCodeLenes(retry = 0): Promise<void> {
    let doc = workspace.getDocument(workspace.bufnr)
    if (!doc) return
    let { uri, version, bufnr } = doc
    let document = workspace.getDocument(uri)
    if (!this.validDocument(document)) return
    if (this.fetching.has(bufnr)) return
    this.fetching.add(bufnr)
    try {
      let codeLenes = await languages.getCodeLens(document.textDocument)
      if (codeLenes && codeLenes.length > 0) {
        this.codeLensMap.set(document.bufnr, { codeLenes, version })
        if (workspace.bufnr == document.bufnr) {
          this.resolveCodeLens.clear()
          await this._resolveCodeLenes(true)
        }
      }
      this.fetching.delete(bufnr)
    } catch (e) {
      this.fetching.delete(bufnr)
      logger.error(e)
      if (/timeout/.test(e.message) && retry < 5) {
        this.fetchDocumentCodeLenes(retry + 1) // tslint:disable-line
      }
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
      await buffer.setVirtualText(this.srcId, lnum, chunks)
    }
  }

  private async _resolveCodeLenes(clear = false): Promise<void> {
    let { nvim } = this
    let { bufnr } = workspace
    let { codeLenes, version } = this.codeLensMap.get(bufnr) || {} as any
    if (workspace.insertMode) return
    if (codeLenes && codeLenes.length) {
      // resolve codeLens of current window
      let start = await nvim.call('line', 'w0')
      let end = await nvim.call('line', 'w$')
      if (version && this.version != version) return
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
    nvim.pauseNotification()
    let doc = workspace.getDocument(bufnr)
    if (doc && clear) {
      doc.clearMatchIds([this.srcId])
    }
    if (codeLenes && codeLenes.length) await this.setVirtualText(doc.buffer, codeLenes)
    nvim.resumeNotification().catch(_e => {
      // noop
    })
  }

  public async doAction(): Promise<void> {
    let { nvim } = this
    let bufnr = await nvim.call('bufnr', '%')
    let line = (await nvim.call('line', '.') as number) - 1
    let { codeLenes } = this.codeLensMap.get(bufnr)
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

  private get version(): number {
    let doc = workspace.getDocument(workspace.bufnr)
    return doc ? doc.version : 0
  }

  public dispose(): void {
    if (this.resolveCodeLens) {
      this.resolveCodeLens.clear()
    }
    disposeAll(this.disposables)
  }
}

import { Buffer, NeovimClient as Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationTokenSource, CodeLens, Disposable } from 'vscode-languageserver-protocol'
import { ConfigurationChangeEvent, Document } from '..'
import commandManager from '../commands'
import events from '../events'
import languages from '../languages'
import services from '../services'
import { disposeAll, wait } from '../util'
import workspace from '../workspace'
import window from '../window'
const logger = require('../util/logger')('codelens')

export interface CodeLensInfo {
  codeLenses: CodeLens[]
  version: number
}

export default class CodeLensManager {
  private separator: string
  private subseparator: string
  private srcId: number
  private enabled: boolean
  private disposables: Disposable[] = []
  private codeLensMap: Map<number, CodeLensInfo> = new Map()
  private tokenSourceMap: Map<number, CancellationTokenSource> = new Map()
  private resolveCodeLens: Function & { clear(): void }
  constructor(private nvim: Neovim) {
    this.setConfiguration()
    this.srcId = workspace.createNameSpace('coc-codelens') || 1080
    services.on('ready', async id => {
      let service = services.getService(id)
      let doc = workspace.getDocument(workspace.bufnr)
      if (!doc || !this.enabled) return
      if (workspace.match(service.selector, doc.textDocument)) {
        this.resolveCodeLens.clear()
        await wait(2000)
        await this.fetchDocumentCodeLenses()
      }
    })
    let timer: NodeJS.Timer
    workspace.onDidChangeTextDocument(async e => {
      if (!this.enabled) return
      let doc = workspace.getDocument(e.textDocument.uri)
      if (doc && doc.bufnr == workspace.bufnr) {
        if (timer) clearTimeout(timer)
        setTimeout(async () => {
          await this.fetchDocumentCodeLenses()
        }, 100)
      }
    }, null, this.disposables)
    workspace.onDidChangeConfiguration(e => {
      this.setConfiguration(e)
    }, null, this.disposables)
    events.on(['TextChanged', 'TextChangedI'], async () => {
      if (!this.enabled) return
      this.resolveCodeLens.clear()
    }, null, this.disposables)
    events.on('CursorMoved', () => {
      if (!this.enabled) return
      this.resolveCodeLens()
    }, null, this.disposables)
    events.on('BufEnter', bufnr => {
      if (!this.enabled) return
      setTimeout(async () => {
        if (workspace.bufnr == bufnr) {
          await this.fetchDocumentCodeLenses()
        }
      }, 100)
    }, null, this.disposables)

    events.on('InsertLeave', async () => {
      if (!this.enabled) return
      let { bufnr } = workspace
      let info = this.codeLensMap.get(bufnr)
      if (info && info.version != this.version) {
        this.resolveCodeLens.clear()
        await wait(50)
        await this.fetchDocumentCodeLenses()
      }
    }, null, this.disposables)

    this.resolveCodeLens = debounce(() => {
      this._resolveCodeLenses().logError()
    }, 200)
  }

  private setConfiguration(e?: ConfigurationChangeEvent): void {
    if (e && !e.affectsConfiguration('codeLens')) return
    let { nvim } = this
    let config = workspace.getConfiguration('codeLens')
    if (e) {
      if (!this.enabled && config.get('enable')) {
        this.fetchDocumentCodeLenses().logError()
      } else if (this.enabled && config.get('enable') == false) {
        workspace.documents.forEach(doc => {
          this.clear(doc.bufnr)
        })
      }
    }
    this.separator = config.get<string>('separator', '‣')
    this.subseparator = config.get<string>('subseparator', ' ')
    this.enabled = nvim.hasFunction('nvim_buf_set_virtual_text') && config.get<boolean>('enable', true)
  }

  private async fetchDocumentCodeLenses(): Promise<void> {
    let doc = workspace.getDocument(workspace.bufnr)
    if (!doc) return
    let { uri, version, bufnr } = doc
    let document = workspace.getDocument(uri)
    if (!this.validDocument(document)) return
    let tokenSource = new CancellationTokenSource()
    try {
      let codeLenses = await languages.getCodeLens(document.textDocument, tokenSource.token)
      this.tokenSourceMap.delete(bufnr)
      if (codeLenses && codeLenses.length > 0) {
        this.codeLensMap.set(document.bufnr, { codeLenses, version })
        if (workspace.bufnr == document.bufnr) {
          this.resolveCodeLens.clear()
          await this._resolveCodeLenses(true)
        }
      }
    } catch (e) {
      this.tokenSourceMap.delete(bufnr)
      logger.error(e)
    }
  }

  private async setVirtualText(buffer: Buffer, codeLenses: CodeLens[]): Promise<void> {
    let list: Map<number, CodeLens[]> = new Map()
    for (let codeLens of codeLenses) {
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
      let codeLenses = list.get(lnum)
      let commands = codeLenses.map(codeLens => codeLens.command)
      commands = commands.filter(c => c && c.title)
      let chunks = []
      let n_commands = commands.length
      for (let i = 0; i < n_commands; i++) {
        let c = commands[i]
        chunks.push([c.title.replace(/(\r\n|\r|\n) */g, " "), 'CocCodeLens'] as [string, string])
        if (i != n_commands - 1) {
          chunks.push([this.subseparator, 'CocCodeLens'] as [string, string])
        }
      }
      chunks.unshift([`${this.separator} `, 'CocCodeLens'])
      await buffer.setVirtualText(this.srcId, lnum, chunks)
    }
  }

  private async _resolveCodeLenses(clear = false): Promise<void> {
    let { nvim } = this
    let { bufnr } = workspace
    let { codeLenses, version } = this.codeLensMap.get(bufnr) || {} as any
    if (codeLenses && codeLenses.length) {
      // resolve codeLens of current window
      let start = await nvim.call('line', 'w0')
      let end = await nvim.call('line', 'w$')
      if (version && this.version != version) return
      if (end >= start) {
        codeLenses = codeLenses.filter(o => {
          let lnum = o.range.start.line + 1
          return lnum >= start && lnum <= end
        })
        if (codeLenses.length) {
          await Promise.all(codeLenses.map(codeLens => languages.resolveCodeLens(codeLens)))
        }
      } else {
        codeLenses = null
      }
    }
    nvim.pauseNotification()
    let doc = workspace.getDocument(bufnr)
    if (doc && clear) {
      this.clear(doc.bufnr)
    }
    if (codeLenses && codeLenses.length) await this.setVirtualText(doc.buffer, codeLenses)
    await nvim.resumeNotification(false, true)
  }

  public async doAction(): Promise<void> {
    let { nvim } = this
    let bufnr = await nvim.call('bufnr', '%')
    let line = (await nvim.call('line', '.') as number) - 1
    let { codeLenses } = this.codeLensMap.get(bufnr) || {}
    if (!codeLenses || codeLenses.length == 0) {
      window.showMessage('No codeLenses available', 'warning')
      return
    }
    let list: Map<number, CodeLens[]> = new Map()
    for (let codeLens of codeLenses) {
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
      window.showMessage('No codeLenses available', 'warning')
      return
    }
    let commands = current.map(o => o.command)
    commands = commands.filter(c => c.command != null && c.command != '')
    if (commands.length == 0) {
      window.showMessage('CodeLenses command not found', 'warning')
    } else if (commands.length == 1) {
      commandManager.execute(commands[0])
    } else {
      let res = await window.showMenuPicker(commands.map(c => c.title))
      if (res == -1) return
      commandManager.execute(commands[res])
    }
  }

  private clear(bufnr: number): void {
    if (!this.enabled) return
    let buf = this.nvim.createBuffer(bufnr)
    if (this.nvim.hasFunction('nvim_create_namespace')) {
      buf.clearNamespace(this.srcId)
    } else {
      buf.clearHighlight({ srcId: this.srcId })
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

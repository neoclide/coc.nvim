import { Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { ColorInformation, Disposable, Position } from 'vscode-languageserver-protocol'
import events from '../events'
import languages from '../languages'
import Document from '../model/document'
import { disposeAll, wait } from '../util'
import { equals } from '../util/object'
import workspace from '../workspace'
import Highlighter, { toHexString } from './highlighter'

const logger = require('../util/logger')('colors')

export default class Colors {
  private _enabled = true
  private srcId = 1090
  private disposables: Disposable[] = []
  private highlighters: Map<number, Highlighter> = new Map()
  private highlightCurrent: Function & { clear(): void }

  constructor(private nvim: Neovim) {
    this.highlightCurrent = debounce(() => {
      this._highlightCurrent().catch(e => {
        logger.error('highlight error:', e.stack)
      })
    }, 200)
    let config = workspace.getConfiguration('coc.preferences')
    this._enabled = config.get<boolean>('colorSupport', true)
    this.srcId = workspace.createNameSpace('coc-colors')
    let timer = setTimeout(async () => {
      // wait for extensions
      await this._highlightCurrent()
    }, 2000)
    this.disposables.push(Disposable.create(() => {
      clearTimeout(timer)
    }))

    events.on('BufEnter', async () => {
      if (global.hasOwnProperty('__TEST__')) return
      this.highlightCurrent()
    }, null, this.disposables)

    events.on('InsertLeave', async () => {
      this.highlightCurrent()
    }, null, this.disposables)

    events.on('BufUnload', async bufnr => {
      let highlighter = this.highlighters.get(bufnr)
      if (highlighter) {
        highlighter.dispose()
        this.highlighters.delete(bufnr)
      }
    }, null, this.disposables)

    workspace.onDidChangeTextDocument(async ({ textDocument, contentChanges }) => {
      if (workspace.insertMode) return
      let doc = workspace.getDocument(textDocument.uri)
      if (doc && doc.bufnr == workspace.bufnr) {
        let { range, text } = contentChanges[0]
        await wait(50)
        await this.highlightColors(doc)
      }
    }, null, this.disposables)

    workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('coc.preferences.colorSupport')) {
        let config = workspace.getConfiguration('coc.preferences')
        this._enabled = config.get<boolean>('colorSupport', true)
      }
    }, null, this.disposables)
  }

  private async _highlightCurrent(): Promise<void> {
    if (!this.enabled) return
    let { bufnr } = workspace
    let doc = workspace.getDocument(bufnr)
    if (doc) await this.highlightColors(doc)
  }

  public async highlightColors(document: Document, force = false): Promise<void> {
    if (!this.enabled) return
    if (['help', 'terminal', 'quickfix'].indexOf(document.buftype) !== -1) return
    let { version, changedtick } = document
    let highlighter = this.getHighlighter(document.bufnr)
    if (!highlighter || (highlighter.version == version && !force)) return
    let colors: ColorInformation[]
    try {
      colors = await languages.provideDocumentColors(document.textDocument)
      colors = colors || []
      if (changedtick != document.changedtick) return
      if (!force && equals(highlighter.colors, colors)) return
      await highlighter.highlight(colors)
    } catch (e) {
      logger.error(e.stack)
    }
  }

  public async pickPresentation(): Promise<void> {
    let info = await this.currentColorInfomation()
    if (!info) return workspace.showMessage('Color not found at current position', 'warning')
    let document = await workspace.document
    let presentations = await languages.provideColorPresentations(info, document.textDocument)
    if (!presentations || presentations.length == 0) return
    let res = await workspace.showQuickpick(presentations.map(o => o.label), 'choose a color presentation:')
    if (res == -1) return
    let presentation = presentations[res]
    let { textEdit, additionalTextEdits, label } = presentation
    if (!textEdit) textEdit = { range: info.range, newText: label }
    await document.applyEdits(this.nvim, [textEdit])
    if (additionalTextEdits) {
      await document.applyEdits(this.nvim, additionalTextEdits)
    }
  }

  public async pickColor(): Promise<void> {
    let info = await this.currentColorInfomation()
    if (!info) return workspace.showMessage('Color not found at current position', 'warning')
    let { color } = info
    let colorArr = [(color.red * 255).toFixed(0), (color.green * 255).toFixed(0), (color.blue * 255).toFixed(0)]
    let res = await this.nvim.call('coc#util#pick_color', [colorArr])
    if (res === false) {
      // cancel
      return
    }
    if (!res || res.length != 3) {
      workspace.showMessage('Failed to get color', 'warning')
      return
    }
    let hex = toHexString({
      red: (res[0] / 65535),
      green: (res[1] / 65535),
      blue: (res[2] / 65535),
      alpha: 1
    })
    let document = await workspace.document
    await document.applyEdits(this.nvim, [{
      range: info.range,
      newText: `#${hex}`
    }])
  }

  public get enabled(): boolean {
    return this._enabled
  }

  public clearHighlight(bufnr: number): void {
    let highlighter = this.highlighters.get(bufnr)
    if (!highlighter) return
    highlighter.clearHighlight()
  }

  public hasColor(bufnr: number): boolean {
    let highlighter = this.highlighters.get(bufnr)
    if (!highlighter) return false
    return highlighter.hasColor()
  }

  public hasColorAtPostion(bufnr: number, position: Position): boolean {
    let highlighter = this.highlighters.get(bufnr)
    if (!highlighter) return false
    return highlighter.hasColorAtPostion(position)
  }

  public dispose(): void {
    this.highlightCurrent.clear()
    for (let highlighter of this.highlighters.values()) {
      highlighter.dispose()
    }
    disposeAll(this.disposables)
  }

  private getHighlighter(bufnr: number): Highlighter {
    let obj = this.highlighters.get(bufnr)
    if (obj) return obj
    let doc = workspace.getDocument(bufnr)
    if (!doc) return null
    obj = new Highlighter(this.nvim, doc, this.srcId)
    this.highlighters.set(bufnr, obj)
    return obj
  }

  private async currentColorInfomation(): Promise<ColorInformation | null> {
    let bufnr = await this.nvim.call('bufnr', '%')
    let highlighter = this.highlighters.get(bufnr)
    if (!highlighter) return
    let position = await workspace.getCursorPosition()
    for (let info of highlighter.colors) {
      let { range } = info
      let { start, end } = range
      if (position.line == start.line
        && position.character >= start.character
        && position.character <= end.character) {
        return info
      }
    }
    return null
  }

}

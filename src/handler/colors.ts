import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, ColorInformation, Disposable, Position } from 'vscode-languageserver-protocol'
import events from '../events'
import extensions from '../extensions'
import languages from '../languages'
import Document from '../model/document'
import { disposeAll } from '../util'
import workspace from '../workspace'
import Highlighter, { toHexString } from './highlighter'
const logger = require('../util/logger')('colors')

export default class Colors {
  private _enabled = true
  private srcId = 1090
  private disposables: Disposable[] = []
  private highlighters: Map<number, Highlighter> = new Map()

  constructor(private nvim: Neovim) {
    if (workspace.isVim && !workspace.env.textprop) {
      return
    }
    workspace.documents.forEach(doc => {
      this.createHighlighter(doc.bufnr)
    })
    workspace.onDidOpenTextDocument(e => {
      let doc = workspace.getDocument(e.uri)
      let highlighter = this.createHighlighter(doc.bufnr)
      if (highlighter && this.enabled) highlighter.highlight()
    }, null, this.disposables)
    workspace.onDidChangeTextDocument(({ bufnr }) => {
      let highlighter = this.highlighters.get(bufnr)
      if (highlighter && this.enabled) highlighter.highlight()
    }, null, this.disposables)
    workspace.onDidCloseTextDocument(({ bufnr }) => {
      let highlighter = this.highlighters.get(bufnr)
      if (!highlighter) return
      highlighter.dispose()
      this.highlighters.delete(bufnr)
    }, null, this.disposables)
    let config = workspace.getConfiguration('coc.preferences')
    this._enabled = config.get<boolean>('colorSupport', true)
    this.srcId = workspace.createNameSpace('coc-colors')
    extensions.onDidLoadExtension(() => {
      this.highlightAll()
    }, null, this.disposables)
    events.on('InsertLeave', async () => {
      if (process.env.NODE_ENV == 'test') return
      this.highlightAll()
    }, null, this.disposables)
    workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('coc.preferences.colorSupport')) {
        let config = workspace.getConfiguration('coc.preferences')
        this._enabled = config.get<boolean>('colorSupport', true)
        if (!this._enabled) {
          for (let highlighter of this.highlighters.values()) {
            highlighter.cancel()
            highlighter.clearHighlight()
          }
        } else {
          this.highlightAll()
        }
      }
    }, null, this.disposables)
  }

  public async pickPresentation(): Promise<void> {
    let info = await this.currentColorInfomation()
    if (!info) return workspace.showMessage('Color not found at current position', 'warning')
    let document = await workspace.document
    let tokenSource = new CancellationTokenSource()
    let presentations = await languages.provideColorPresentations(info, document.textDocument, tokenSource.token)
    if (!presentations || presentations.length == 0) return
    let res = await workspace.showQuickpick(presentations.map(o => o.label), 'choose a color presentation:')
    if (res == -1) return
    let presentation = presentations[res]
    let { textEdit, additionalTextEdits, label } = presentation
    if (!textEdit) textEdit = { range: info.range, newText: label }
    await document.applyEdits([textEdit])
    if (additionalTextEdits) {
      await document.applyEdits(additionalTextEdits)
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
    await document.applyEdits([{
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
    for (let highlighter of this.highlighters.values()) {
      highlighter.dispose()
    }
    disposeAll(this.disposables)
  }

  public highlightAll(): void {
    if (!this.enabled) return
    workspace.documents.forEach(doc => {
      let highlighter = this.highlighters.get(doc.bufnr)
      if (highlighter) highlighter.highlight()
    })
  }

  public async doHighlight(bufnr: number): Promise<void> {
    let highlighter = this.highlighters.get(bufnr)
    if (!highlighter) return
    await highlighter.doHighlight()
  }

  private createHighlighter(bufnr: number): Highlighter {
    let doc = workspace.getDocument(bufnr)
    if (!doc || !isValid(doc)) return null
    let obj = new Highlighter(this.nvim, bufnr, this.srcId)
    this.highlighters.set(bufnr, obj)
    return obj
  }

  private async currentColorInfomation(): Promise<ColorInformation | null> {
    let bufnr = await this.nvim.call('bufnr', '%')
    let highlighter = this.highlighters.get(bufnr)
    if (!highlighter) return null
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

function isValid(document: Document): boolean {
  if (['help', 'terminal', 'quickfix'].includes(document.buftype)) return false
  if (!document.attached) return false
  return true
}

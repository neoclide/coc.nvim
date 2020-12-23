import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, ColorInformation, Disposable, Position } from 'vscode-languageserver-protocol'
import extensions from '../../extensions'
import languages from '../../languages'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import { toHexString } from '../helper'
import ColorBuffer from './colorBuffer'
import BufferSync from '../../model/bufferSync'
const logger = require('../../util/logger')('colors')

export default class Colors {
  private _enabled = true
  private disposables: Disposable[] = []
  private highlighters: BufferSync<ColorBuffer>

  constructor(private nvim: Neovim) {
    let config = workspace.getConfiguration('coc.preferences')
    this._enabled = config.get<boolean>('colorSupport', true)
    if (workspace.isVim && !workspace.env.textprop) {
      this._enabled = false
    }
    let usedColors: Set<string> = new Set()
    this.highlighters = workspace.registerBufferSync(doc => {
      let buf = new ColorBuffer(this.nvim, doc.bufnr, this._enabled, usedColors)
      buf.highlight()
      return buf
    })
    extensions.onDidActiveExtension(() => {
      this.highlightAll()
    }, null, this.disposables)
    workspace.onDidChangeConfiguration(async e => {
      if (workspace.isVim && !workspace.env.textprop) return
      if (e.affectsConfiguration('coc.preferences.colorSupport')) {
        let config = workspace.getConfiguration('coc.preferences')
        let enabled = config.get<boolean>('colorSupport', true)
        if (enabled != this._enabled) {
          this._enabled = enabled
          for (let buf of this.highlighters.items) {
            buf.setState(enabled)
          }
        }
      }
    }, null, this.disposables)
  }

  public async pickPresentation(): Promise<void> {
    let info = await this.currentColorInfomation()
    if (!info) return window.showMessage('Color not found at current position', 'warning')
    let document = await workspace.document
    let tokenSource = new CancellationTokenSource()
    let presentations = await languages.provideColorPresentations(info, document.textDocument, tokenSource.token)
    if (!presentations || presentations.length == 0) return
    let res = await window.showMenuPicker(presentations.map(o => o.label), 'choose color:')
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
    if (!info) return window.showMessage('Color not found at current position', 'warning')
    let { color } = info
    let colorArr = [(color.red * 255).toFixed(0), (color.green * 255).toFixed(0), (color.blue * 255).toFixed(0)]
    let res = await this.nvim.call('coc#util#pick_color', [colorArr])
    if (res === false) {
      // cancel
      return
    }
    if (!res || res.length != 3) {
      window.showMessage('Failed to get color', 'warning')
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
    let highlighter = this.highlighters.getItem(bufnr)
    if (!highlighter) return
    highlighter.clearHighlight()
  }

  public hasColor(bufnr: number): boolean {
    let highlighter = this.highlighters.getItem(bufnr)
    if (!highlighter) return false
    return highlighter.hasColor()
  }

  public hasColorAtPostion(bufnr: number, position: Position): boolean {
    let highlighter = this.highlighters.getItem(bufnr)
    if (!highlighter) return false
    return highlighter.hasColorAtPostion(position)
  }

  public highlightAll(): void {
    for (let buf of this.highlighters.items) {
      buf.highlight()
    }
  }

  public async doHighlight(bufnr: number): Promise<void> {
    let highlighter = this.highlighters.getItem(bufnr)
    if (!highlighter) return
    await highlighter.doHighlight()
  }

  private async currentColorInfomation(): Promise<ColorInformation | null> {
    let bufnr = await this.nvim.call('bufnr', '%')
    let highlighter = this.highlighters.getItem(bufnr)
    if (!highlighter) return null
    let position = await window.getCursorPosition()
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

  public dispose(): void {
    this.highlighters.dispose()
    disposeAll(this.disposables)
  }
}

import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, ColorInformation, Disposable, Position } from 'vscode-languageserver-protocol'
import commandManager from '../../commands'
import extensions from '../../extensions'
import languages from '../../languages'
import BufferSync from '../../model/bufferSync'
import { HandlerDelegate } from '../../types'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import ColorBuffer, { toHexString } from './colorBuffer'
const logger = require('../../util/logger')('colors-index')

export default class Colors {
  private _enabled = true
  private disposables: Disposable[] = []
  private highlighters: BufferSync<ColorBuffer>

  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    let config = workspace.getConfiguration('coc.preferences')
    this._enabled = config.get<boolean>('colorSupport', true)
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
    this.disposables.push(commandManager.registerCommand('editor.action.pickColor', () => {
      return this.pickColor()
    }))
    commandManager.titles.set('editor.action.pickColor', 'pick color from system color picker when possible.')
    this.disposables.push(commandManager.registerCommand('editor.action.colorPresentation', () => {
      return this.pickPresentation()
    }))
    commandManager.titles.set('editor.action.colorPresentation', 'change color presentation.')
  }

  public async pickPresentation(): Promise<void> {
    let { doc } = await this.handler.getCurrentState()
    this.handler.checkProvier('documentColor', doc.textDocument)
    let info = await this.getColorInformation(doc.bufnr)
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
    let { doc } = await this.handler.getCurrentState()
    this.handler.checkProvier('documentColor', doc.textDocument)
    let info = await this.getColorInformation(doc.bufnr)
    if (!info) return window.showMessage('Color not found at current position', 'warning')
    let { color } = info
    let colorArr = [(color.red * 255).toFixed(0), (color.green * 255).toFixed(0), (color.blue * 255).toFixed(0)]
    let res = await this.nvim.call('coc#util#pick_color', [colorArr])
    if (!res) return
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

  public hasColorAtPosition(bufnr: number, position: Position): boolean {
    let highlighter = this.highlighters.getItem(bufnr)
    if (!highlighter) return false
    return highlighter.hasColorAtPosition(position)
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

  private async getColorInformation(bufnr: number): Promise<ColorInformation | null> {
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
  }

  public dispose(): void {
    this.highlighters.dispose()
    disposeAll(this.disposables)
  }
}

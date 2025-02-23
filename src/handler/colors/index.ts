'use strict'
import { Neovim } from '@chemzqm/neovim'
import { ColorInformation, Position } from 'vscode-languageserver-types'
import commandManager from '../../commands'
import events from '../../events'
import languages, { ProviderName } from '../../languages'
import BufferSync from '../../model/bufferSync'
import { IConfigurationChangeEvent } from '../../types'
import { defaultValue, disposeAll } from '../../util'
import { toHexString } from '../../util/color'
import { CancellationTokenSource, Disposable } from '../../util/protocol'
import window from '../../window'
import workspace from '../../workspace'
import { HandlerDelegate } from '../types'
import ColorBuffer, { ColorConfig } from './colorBuffer'

export default class Colors {
  private config: ColorConfig
  private disposables: Disposable[] = []
  private highlighters: BufferSync<ColorBuffer>

  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    let usedColors: Set<string> = new Set()
    this.highlighters = workspace.registerBufferSync(doc => {
      return new ColorBuffer(this.nvim, doc, this.config, usedColors)
    })
    events.on('ColorScheme', () => {
      usedColors.clear()
      for (let item of this.highlighters.items) {
        item.cancel()
        void item.doHighlight()
      }
    }, null, this.disposables)
    languages.onDidColorsRefresh(selector => {
      for (let item of this.highlighters.items) {
        if (workspace.match(selector, item.doc)) {
          item.highlight()
        }
      }
    })
    commandManager.register({
      id: 'editor.action.pickColor',
      execute: async () => {
        await this.pickColor()
      }
    }, false, 'pick color from system color picker when possible.')
    commandManager.register({
      id: 'editor.action.colorPresentation',
      execute: async () => {
        await this.pickPresentation()
      }
    }, false, 'change color presentation.')
    commandManager.register({
      id: 'document.toggleColors',
      execute: async () => {
        let bufnr = await nvim.call('bufnr', ['%']) as number
        let item = this.highlighters.getItem(bufnr)
        workspace.getAttachedDocument(bufnr)
        item.toggle()
      }
    }, false, 'toggle colors for current buffer')
  }

  private loadConfiguration(e?: IConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('colors')) {
      let c = workspace.initialConfiguration.get('colors') as any
      this.config = Object.assign(this.config ?? {}, {
        filetypes: c.filetypes,
        highlightPriority: defaultValue(c.highlightPriority, 1000)
      })
      if (e) {
        for (let item of this.highlighters.items) {
          item.updateDocumentConfig()
        }
      }
    }
  }

  public async pickPresentation(): Promise<void> {
    let { doc } = await this.handler.getCurrentState()
    this.handler.checkProvider(ProviderName.DocumentColor, doc.textDocument)
    let info = await this.getColorInformation(doc.bufnr)
    if (!info) return void window.showWarningMessage('Color not found at current position')
    let tokenSource = new CancellationTokenSource()
    let presentations = await languages.provideColorPresentations(info, doc.textDocument, tokenSource.token)
    if (!presentations?.length) return void window.showWarningMessage('No color presentations found')
    let res = await window.showMenuPicker(presentations.map(o => o.label), 'Choose color:')
    if (res == -1) return
    let presentation = presentations[res]
    let { textEdit, additionalTextEdits, label } = presentation
    if (!textEdit) textEdit = { range: info.range, newText: label }
    await doc.applyEdits([textEdit])
    if (additionalTextEdits) await doc.applyEdits(additionalTextEdits)

  }

  public async pickColor(): Promise<void> {
    let { doc } = await this.handler.getCurrentState()
    this.handler.checkProvider(ProviderName.DocumentColor, doc.textDocument)
    let info = await this.getColorInformation(doc.bufnr)
    if (!info) return void window.showWarningMessage('Color not found at current position')
    let { color } = info
    let colorArr = [(color.red * 255).toFixed(0), (color.green * 255).toFixed(0), (color.blue * 255).toFixed(0)]
    let res = await this.nvim.call('coc#color#pick_color', [colorArr])
    if (!res) return
    let hex = toHexString({
      red: (res[0] / 65535),
      green: (res[1] / 65535),
      blue: (res[2] / 65535),
      alpha: 1
    })
    await doc.applyEdits([{
      range: info.range,
      newText: `#${hex}`
    }])
  }

  public isEnabled(bufnr: number): boolean {
    let highlighter = this.highlighters.getItem(bufnr)
    return highlighter != null && highlighter.enabled === true
  }

  public clearHighlight(bufnr: number): void {
    let highlighter = this.highlighters.getItem(bufnr)
    if (highlighter) highlighter.clearHighlight()
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
    if (highlighter) await highlighter.doHighlight()
  }

  public async getColorInformation(bufnr: number): Promise<ColorInformation | null> {
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

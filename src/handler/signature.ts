'use strict'
import { Neovim } from '@chemzqm/neovim'
import { MarkupContent, Position, SignatureHelp } from 'vscode-languageserver-types'
import { IConfigurationChangeEvent } from '../configuration/types'
import events from '../events'
import languages, { ProviderName } from '../languages'
import Document from '../model/document'
import { FloatConfig, FloatFactory } from '../types'
import { disposeAll, getConditionValue } from '../util'
import { isFalsyOrEmpty } from '../util/array'
import { debounce } from '../util/node'
import { CancellationTokenSource, Disposable, SignatureHelpTriggerKind } from '../util/protocol'
import { byteLength, byteSlice } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { HandlerDelegate } from './types'
import { toDocumentation } from './util'

interface SignatureConfig {
  wait: number
  enableTrigger: boolean
  target: string
  preferAbove: boolean
  hideOnChange: boolean
  floatConfig: FloatConfig
}

interface SignaturePosition {
  bufnr: number
  lnum: number
  col: number
}

interface SignaturePart {
  text: string
  type: 'Label' | 'MoreMsg' | 'Normal'
}

const debounceTime = getConditionValue(100, 10)

export default class Signature {
  private timer: NodeJS.Timer
  private config: SignatureConfig
  private signatureFactory: FloatFactory
  private lastPosition: SignaturePosition | undefined
  private disposables: Disposable[] = []
  private tokenSource: CancellationTokenSource | undefined
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    this.signatureFactory = window.createFloatFactory(Object.assign({
      preferTop: this.config.preferAbove,
      autoHide: false,
      modes: ['i', 'ic', 's'],
    }, this.config.floatConfig))
    this.disposables.push(this.signatureFactory)
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    events.on('CursorMovedI', debounce(this.checkCurosr.bind(this), debounceTime), null, this.disposables)
    events.on(['InsertLeave', 'BufEnter'], () => {
      this.tokenSource?.cancel()
    }, null, this.disposables)
    events.on('TextChangedI', () => {
      if (this.config.hideOnChange) {
        this.signatureFactory.close()
      }
    }, null, this.disposables)
    events.on('TextInsert', async (bufnr, info, character) => {
      if (!this.config.enableTrigger) return
      let doc = workspace.getDocument(bufnr)
      if (!doc || !doc.attached || !languages.shouldTriggerSignatureHelp(doc.textDocument, character)) return
      await this._triggerSignatureHelp(doc, { line: info.lnum - 1, character: info.pre.length }, false)
    }, null, this.disposables)
    window.onDidChangeActiveTextEditor(() => {
      this.loadConfiguration()
    }, null, this.disposables)
  }

  private checkCurosr(bufnr: number, cursor: [number, number]): void {
    let pos = this.lastPosition
    let floatFactory = this.signatureFactory
    if (!pos || bufnr !== pos.bufnr || floatFactory.window == null) return
    let doc = workspace.getDocument(bufnr)
    if (!doc || cursor[0] != pos.lnum || cursor[1] < pos.col) {
      floatFactory.close()
      return
    }
    let line = doc.getline(pos.lnum - 1)
    let text = byteSlice(line, pos.col - 1, cursor[1] - 1)
    if (text.endsWith(')')) return floatFactory.close()
  }

  public loadConfiguration(e?: IConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('signature')) {
      let doc = window.activeTextEditor?.document
      let config = workspace.getConfiguration('signature', doc)
      this.config = {
        target: config.get<string>('target', 'float'),
        floatConfig: config.get('floatConfig', {}),
        enableTrigger: config.get<boolean>('enable', true),
        wait: Math.max(config.get<number>('triggerSignatureWait', 500), 200),
        preferAbove: config.get<boolean>('preferShownAbove', true),
        hideOnChange: config.get<boolean>('hideOnTextChange', false),
      }
    }
  }

  public async triggerSignatureHelp(): Promise<boolean> {
    let { doc, position } = await this.handler.getCurrentState()
    if (!languages.hasProvider(ProviderName.Signature, doc.textDocument)) return false
    return await this._triggerSignatureHelp(doc, position, true, 0)
  }

  private async _triggerSignatureHelp(doc: Document, position: Position, invoke: boolean, offset = 0): Promise<boolean> {
    this.tokenSource?.cancel()
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    token.onCancellationRequested(() => {
      tokenSource.dispose()
      this.tokenSource = undefined
    })
    let { target } = this.config
    let timer = this.timer = setTimeout(() => {
      tokenSource.cancel()
    }, this.config.wait)
    await doc.patchChange(true)
    let signatureHelp = await languages.getSignatureHelp(doc.textDocument, position, token, {
      isRetrigger: this.signatureFactory.checkRetrigger(doc.bufnr),
      triggerKind: invoke ? SignatureHelpTriggerKind.Invoked : SignatureHelpTriggerKind.TriggerCharacter
    })
    clearTimeout(timer)
    if (token.isCancellationRequested) return false
    if (!signatureHelp || signatureHelp.signatures.length == 0) {
      this.signatureFactory.close()
      return false
    }
    let { activeSignature, signatures } = signatureHelp
    if (activeSignature) {
      // make active first
      let [active] = signatures.splice(activeSignature, 1)
      if (active) signatures.unshift(active)
    }
    if (target == 'echo') {
      this.echoSignature(signatureHelp)
    } else {
      await this.showSignatureHelp(doc, position, signatureHelp, offset)
    }
    return true
  }

  private async showSignatureHelp(doc: Document, position: Position, signatureHelp: SignatureHelp, offset: number): Promise<void> {
    let { signatures, activeParameter } = signatureHelp
    activeParameter = typeof activeParameter === 'number' ? activeParameter : undefined
    let paramDoc: string | MarkupContent = null
    let startOffset = offset
    let docs = signatures.reduce((p, c, idx) => {
      let activeIndexes: [number, number] = null
      let activeIndex = c.activeParameter ?? activeParameter
      if (activeIndex === undefined && !isFalsyOrEmpty(c.parameters)) {
        activeIndex = 0
      }
      let nameIndex = c.label.indexOf('(')
      if (idx == 0 && typeof activeIndex === 'number') {
        let active = c.parameters?.[activeIndex]
        if (active) {
          let after = c.label.slice(nameIndex == -1 ? 0 : nameIndex)
          paramDoc = active.documentation
          if (typeof active.label === 'string') {
            let str = after.slice(0)
            let ms = str.match(new RegExp('\\b' + active.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'))
            let index = ms ? ms.index : str.indexOf(active.label)
            if (index != -1) {
              activeIndexes = [
                index + nameIndex,
                index + active.label.length + nameIndex
              ]
            }
          } else {
            activeIndexes = active.label
          }
        }
      }
      if (activeIndexes == null) {
        activeIndexes = [nameIndex + 1, nameIndex + 1]
      }
      if (offset == startOffset) {
        offset = offset + activeIndexes[0] + 1
      }
      p.push({
        content: c.label,
        filetype: doc.filetype,
        active: activeIndexes
      })
      if (paramDoc) {
        p.push(toDocumentation(paramDoc))
      }
      if (idx == 0 && c.documentation) {
        p.push(toDocumentation(c.documentation))
      }
      return p
    }, [])
    let content = doc.getline(position.line, false).slice(0, position.character)
    this.lastPosition = { bufnr: doc.bufnr, lnum: position.line + 1, col: byteLength(content) + 1 }
    await this.signatureFactory.show(docs, { offsetX: offset })
  }

  public echoSignature(signatureHelp: SignatureHelp): void {
    let { signatures, activeParameter } = signatureHelp
    let columns = workspace.env.columns
    signatures = signatures.slice(0, workspace.env.cmdheight)
    let signatureList: SignaturePart[][] = []
    for (let signature of signatures) {
      let parts: SignaturePart[] = []
      let { label } = signature
      label = label.replace(/\n/g, ' ')
      if (label.length >= columns - 16) {
        label = label.slice(0, columns - 16) + '...'
      }
      let nameIndex = label.indexOf('(')
      if (nameIndex == -1) {
        parts = [{ text: label, type: 'Normal' }]
      } else {
        parts.push({
          text: label.slice(0, nameIndex),
          type: 'Label'
        })
        let after = label.slice(nameIndex)
        if (signatureList.length == 0 && activeParameter != null) {
          let active = signature.parameters?.[activeParameter]
          if (active) {
            let start: number
            let end: number
            if (typeof active.label === 'string') {
              let str = after.slice(0)
              let ms = str.match(new RegExp('\\b' + active.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'))
              let idx = ms ? ms.index : str.indexOf(active.label)
              if (idx == -1) {
                parts.push({ text: after, type: 'Normal' })
              } else {
                start = idx
                end = idx + active.label.length
              }
            } else {
              [start, end] = active.label
              start = start - nameIndex
              end = end - nameIndex
            }
            if (start != null && end != null) {
              parts.push({ text: after.slice(0, start), type: 'Normal' })
              parts.push({ text: after.slice(start, end), type: 'MoreMsg' })
              parts.push({ text: after.slice(end), type: 'Normal' })
            }
          }
        } else {
          parts.push({
            text: after,
            type: 'Normal'
          })
        }
      }
      signatureList.push(parts)
    }
    this.nvim.callTimer('coc#ui#echo_signatures', [signatureList], true)
  }

  public dispose(): void {
    disposeAll(this.disposables)
    if (this.timer) {
      clearTimeout(this.timer)
    }
  }
}

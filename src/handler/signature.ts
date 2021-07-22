import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable, MarkupContent, Position, SignatureHelp, SignatureHelpTriggerKind } from 'vscode-languageserver-protocol'
import events from '../events'
import languages from '../languages'
import Document from '../model/document'
import FloatFactory from '../model/floatFactory'
import { ConfigurationChangeEvent, HandlerDelegate } from '../types'
import { disposeAll, isMarkdown } from '../util'
import { byteLength } from '../util/string'
import workspace from '../workspace'
const logger = require('../util/logger')('handler-signature')

interface SignatureConfig {
  wait: number
  trigger: boolean
  target: string
  maxWindowHeight: number
  maxWindowWidth: number
  preferAbove: boolean
  hideOnChange: boolean
}

interface SignaturePart {
  text: string
  type: 'Label' | 'MoreMsg' | 'Normal'
}

export default class Signature {
  private timer: NodeJS.Timer
  private config: SignatureConfig
  private signatureFactory: FloatFactory
  private signaturePosition: Position
  private disposables: Disposable[] = []
  private tokenSource: CancellationTokenSource | undefined
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.signatureFactory = new FloatFactory(nvim)
    this.loadConfiguration()
    this.disposables.push(this.signatureFactory)
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    events.on('CursorMovedI', async (bufnr, cursor) => {
      // avoid close signature for valid position.
      if (!this.signaturePosition) return
      let doc = workspace.getDocument(bufnr)
      if (!doc) return
      let { line, character } = this.signaturePosition
      if (cursor[0] - 1 == line) {
        let currline = doc.getline(cursor[0] - 1)
        let col = byteLength(currline.slice(0, character)) + 1
        if (cursor[1] >= col) return
      }
      this.signatureFactory.close()
    }, null, this.disposables)
    events.on(['InsertLeave', 'BufEnter'], () => {
      this.tokenSource?.cancel()
    }, null, this.disposables)
    events.on(['TextChangedI', 'TextChangedP'], async () => {
      if (this.config.hideOnChange) {
        this.signatureFactory.close()
      }
    }, null, this.disposables)
    let lastInsert: number
    events.on('InsertCharPre', async () => {
      lastInsert = Date.now()
    }, null, this.disposables)
    events.on('TextChangedI', async (bufnr, info) => {
      if (!this.config.trigger) return
      if (!lastInsert || Date.now() - lastInsert > 300) return
      lastInsert = null
      let doc = workspace.getDocument(bufnr)
      if (!doc || doc.isCommandLine || !doc.attached) return
      // if (!triggerSignatureHelp && !formatOnType) return
      let pre = info.pre[info.pre.length - 1]
      if (!pre) return
      if (!languages.shouldTriggerSignatureHelp(doc.textDocument, pre)) return
      await this._triggerSignatureHelp(doc, { line: info.lnum - 1, character: info.pre.length }, false)
    }, null, this.disposables)
  }

  private loadConfiguration(e?: ConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('signature')) {
      let config = workspace.getConfiguration('signature')
      let target = config.get<string>('target', 'float')
      if (target == 'float' && !workspace.floatSupported) {
        target = 'echo'
      }
      this.config = {
        target,
        trigger: config.get<boolean>('enable', true),
        wait: Math.max(config.get<number>('triggerSignatureWait', 500), 200),
        maxWindowHeight: config.get<number>('maxWindowHeight', 80),
        maxWindowWidth: config.get<number>('maxWindowWidth', 80),
        preferAbove: config.get<boolean>('preferShownAbove', true),
        hideOnChange: config.get<boolean>('hideOnTextChange', false),
      }
    }
  }

  public async triggerSignatureHelp(): Promise<boolean> {
    let { doc, position, mode } = await this.handler.getCurrentState()
    if (!languages.hasProvider('signature', doc.textDocument)) return false
    let offset = 0
    let character = position.character
    if (mode == 's') {
      let placeholder = await this.nvim.getVar('coc_last_placeholder') as any
      if (placeholder) {
        let { start, end, bufnr } = placeholder
        if (bufnr == doc.bufnr && start.line == end.line && start.line == position.line) {
          position = Position.create(start.line, start.character)
          offset = character - position.character
        }
      }
    }
    return await this._triggerSignatureHelp(doc, position, true, offset)
  }

  private async _triggerSignatureHelp(doc: Document, position: Position, invoke = true, offset = 0): Promise<boolean> {
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
    await doc.synchronize()
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
    let paramDoc: string | MarkupContent = null
    let startOffset = offset
    let docs = signatures.reduce((p, c, idx) => {
      let activeIndexes: [number, number] = null
      let nameIndex = c.label.indexOf('(')
      if (idx == 0 && activeParameter != null) {
        let active = c.parameters?.[activeParameter]
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
        let content = typeof paramDoc === 'string' ? paramDoc : paramDoc.value
        if (content.trim().length) {
          p.push({
            content,
            filetype: isMarkdown(c.documentation) ? 'markdown' : 'txt'
          })
        }
      }
      if (idx == 0 && c.documentation) {
        let { documentation } = c
        let content = typeof documentation === 'string' ? documentation : documentation.value
        if (content.trim().length) {
          p.push({
            content,
            filetype: isMarkdown(c.documentation) ? 'markdown' : 'txt'
          })
        }
      }
      return p
    }, [])
    this.signaturePosition = position
    let { preferAbove, maxWindowHeight, maxWindowWidth } = this.config
    const excludeImages = workspace.getConfiguration('coc.preferences').get<boolean>('excludeImageLinksInMarkdownDocument')
    await this.signatureFactory.show(docs, {
      maxWidth: maxWindowWidth,
      maxHeight: maxWindowHeight,
      preferTop: preferAbove,
      autoHide: false,
      offsetX: offset,
      modes: ['i', 'ic', 's'],
      excludeImages
    })
  }

  private echoSignature(signatureHelp: SignatureHelp): void {
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
    this.nvim.callTimer('coc#util#echo_signatures', [signatureList], true)
  }

  public dispose(): void {
    disposeAll(this.disposables)
    if (this.timer) {
      clearTimeout(this.timer)
    }
  }
}

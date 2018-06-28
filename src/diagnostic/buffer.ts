import {
  Diagnostic,
  Range,
  DiagnosticSeverity,
} from 'vscode-languageserver-protocol'
import {
  byteIndex,
} from '../util/string'
import {
  DiagnosticInfo,
} from '../types'
import workspace from '../workspace'
import Document from '../model/document'
import {Neovim} from 'neovim'
const logger = require('../util/logger')('diagnostic-buffer')

export interface DiagnosticConfig {
  signOffset:number
  errorSign:string
  warningSign:string
  infoSign:string
  hintSign:string
}

const severityNames = ['CocError', 'CocWarning', 'CocInfo', 'CocHint']

function getNameFromSeverity(severity:DiagnosticSeverity):string {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return 'CocError'
    case DiagnosticSeverity.Warning:
      return 'CocWarning'
    case DiagnosticSeverity.Information:
      return 'CocInfo'
    case DiagnosticSeverity.Hint:
      return 'CocHint'
    default:
      return 'CocError'
  }
}

function getDiagnosticInfo(diagnostics:Diagnostic[]):DiagnosticInfo {
  let error = 0
  let warning = 0
  let information = 0
  let hint = 0
  if (diagnostics && diagnostics.length) {
    for (let diagnostic of diagnostics) {
      switch (diagnostic.severity) {
        case DiagnosticSeverity.Error:
          error = error + 1
          break
        case DiagnosticSeverity.Warning:
          warning = warning + 1
          break
        case DiagnosticSeverity.Information:
          information = information + 1
          break
        case DiagnosticSeverity.Hint:
          hint = hint + 1
          break
        default:
          error = error + 1
      }
    }
  }
  return {error, warning, information, hint}
}

// maintains sign and highlightId
export class DiagnosticBuffer {
  private signMap:Map<string, number[]> = new Map()
  private srcIdMap:Map<string, number> = new Map()
  private infoMap:Map<string, DiagnosticInfo> = new Map()
  private callbackMap:Map<string, ()=>Promise<void>> = new Map()
  private nvim:Neovim
  private signId:number
  private operating:boolean

  constructor(public readonly uri:string, config:DiagnosticConfig) {
    this.nvim = workspace.nvim
    this.signId = config.signOffset || 1000
  }

  public set(owner:string, diagnostics:Diagnostic[] | null):void {
    if (this.operating) {
      this.callbackMap.set(owner, ()=> {
        return this._set(owner, diagnostics)
      })
    } else {
      this._set(owner, diagnostics)
    }
  }

  private async handleCallback():Promise<void> {
    let fns = this.callbackMap.values()
    this.callbackMap = new Map()
    for (let fn of fns) {
      await fn()
    }
  }

  private async _set(owner:string, diagnostics:Diagnostic[] | null):Promise<void> {
    let {document} = this
    if (!document) return
    this.operating = true
    try {
      let srcId = await this.getSrcId(document, owner)
      await this._clear(owner)
      if (diagnostics && diagnostics.length != 0) {
        let signIds = this.getSignIds(owner, diagnostics.length)
        let i = 0
        for (let diagnostic of diagnostics) {
          let line = diagnostic.range.start.line
          let signId = signIds[i]
          await this.addSign(owner, signId, line, diagnostic.severity)
          await this.addHighlight(srcId, diagnostic.range)
          i++
        }
      }
      this.infoMap.set(owner, getDiagnosticInfo(diagnostics))
      await this.setDiagnosticInfo()
      this.operating = false
      await this.handleCallback()
    } catch (e) {
      logger.error(e.stack)
    }
  }

  public async checkSigns():Promise<void> {
    let {signs, operating, document} = this
    if (!document || operating) return
    let {buffer} = document
    let content = await this.nvim.call('execute', [`sign place buffer=${buffer.id}`])
    let lines:string[] = content.split('\n')
    let ids = []
    for (let line of lines) {
      let ms = line.match(/^\s*line=\d+\s+id=(\d+)\s+name=(\w+)/)
      if (!ms) continue
      let [, id, name] = ms
      if (severityNames.indexOf(name) == -1) continue
      if (signs.indexOf(Number(id)) !== -1) continue
      ids.push(id)
    }
    await this.nvim.call('coc#util#unplace_signs', [buffer.id, ids])
  }

  private get signs():number[] {
    let res:number[] = []
    for (let [, signs] of this.signMap) {
      res.push(...signs)
    }
    return res
  }

  private async _clear(owner?:string):Promise<void> {
    let {document, nvim} = this
    if (!document) return
    try {
      this.operating = true
      let {buffer} = document
      for (let key of this.signMap.keys()) {
        if (!owner || owner == key) {
          let ids = this.signMap.get(key)
          if (ids && ids.length) {
            await nvim.call('coc#util#unplace_signs', [buffer.id, ids])
          }
          this.signMap.delete(key)
        }
      }
      for (let srcId of this.srcIdMap.keys()) {
        if (!owner || owner == srcId) {
          await this.clearHighlight(this.srcIdMap.get(srcId))
        }
      }
      for (let srcId of this.infoMap.keys()) {
        if (!owner || owner == srcId) {
          this.infoMap.delete(srcId)
        }
      }
      await this.setDiagnosticInfo()
      this.operating = false
      await this.handleCallback()
    } catch (e) {
      logger.error(e.stack)
    }
  }

  public async clear(owner?:string):Promise<void> {
    if (this.operating) {
      if (!owner) this.callbackMap = new Map()
      this.callbackMap.set(owner || '', ()=> {
        return this._clear(owner)
      })
    } else {
      await this._clear(owner)
    }
  }

  private async addSign(owner:string, signId:number, line:number, severity:DiagnosticSeverity):Promise<void> {
    let {document, nvim} = this
    let {buffer} = document
    let name = getNameFromSeverity(severity)
    await nvim.command(`sign place ${signId} line=${line + 1} name=${name} buffer=${buffer.id}`)
  }

  private async setDiagnosticInfo():Promise<void> {
    let {document} = this
    let {buffer} = document
    let error =0
    let warning = 0
    let information = 0
    let hint = 0
    for (let [, diagnosticInfo] of this.infoMap) {
      if (!diagnosticInfo) continue
      error = error + diagnosticInfo.error
      warning = warning + diagnosticInfo.warning
      information = information + diagnosticInfo.information
      hint = hint + diagnosticInfo.hint
    }
    await buffer.setVar('coc_diagnostic_info', {error, warning, information, hint})
  }

  private async addHighlight(srcId:number, range:Range):Promise<void> {
    let {start, end} = range
    try {
      let {document} = this
      let {buffer} = document
      for (let i = start.line; i<= end.line; i++) {
        let line = document.getline(i)
        if (!line || !line.length) continue
        let s = i == start.line ? start.character : 0
        let e = i == end.line ? end.character : -1
        await buffer.addHighlight({
          srcId,
          hlGroup: 'CocUnderline',
          line: i,
          colStart: byteIndex(line, s),
          colEnd: e == -1 ? -1 : byteIndex(line, e),
        })
      }
    } catch (e) {
      logger.error(e.stack)
    }
  }

  private async clearHighlight(srcId:number):Promise<void> {
    let {document} = this
    let {buffer} = document
    await buffer.clearHighlight({srcId})
  }

  private get document():Document {
    return workspace.getDocument(this.uri)
  }

  private async getSrcId(document:Document, owner:string):Promise<number> {
    let {buffer} = document
    let srcId = this.srcIdMap.get(owner)
    if (!srcId) {
      srcId = await buffer.addHighlight({ line: 0, srcId: 0 })
      this.srcIdMap.set(owner, srcId)
    }
    return srcId as number
  }

  private getSignIds(owner:string, len:number):number[] {
    let {signId} = this
    let res:number[] = []
    for (let i = 1; i <= len; i++) {
      res.push(signId + i)
    }
    this.signId = signId + len
    this.signMap.set(owner, res)
    return res
  }
}

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
import {Neovim, Buffer} from 'neovim'
import {setTimeout} from 'timers'
const logger = require('../util/logger')('diagnostic-buffer')

export interface DiagnosticConfig {
  signOffset:number
  errorSign:string
  warningSign:string
  infoSign:string
  hintSign:string
}

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
  if (!diagnostics) return null
  for (let diagnoctic of diagnostics) {
    switch (diagnoctic.severity) {
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
  return {error, warning, information, hint}
}

// maintains sign and highlightId
export class DiagnosticBuffer {
  private signMap:Map<string, number[]> = new Map()
  private srcIdMap:Map<string, number> = new Map()
  private infoMap:Map<string, DiagnosticInfo> = new Map()
  private nvim:Neovim
  private signId:number

  constructor(public readonly uri:string, config:DiagnosticConfig) {
    this.nvim = workspace.nvim
    this.signId = config.signOffset || 1000
  }

  public async set(owner:string, diagnostics:Diagnostic[] | null):Promise<void> {
    let srcId = await this.getSrcId(owner)
    await this.clear(owner, false)
    if (!diagnostics || diagnostics.length == 0) return
    let lines:Set<number> = new Set()
    for (let diagnostic of diagnostics) {
      let line = diagnostic.range.start.line
      if (!lines.has(line)) {
        lines.add(line)
        await this.addSign(owner, line, diagnostic.severity)
      }
      await this.addHighlight(srcId, diagnostic.range)
    }
    this.infoMap.set(owner, getDiagnosticInfo(diagnostics))
    await this.setDiagnosticInfo()
  }

  public async clear(owner?:string, reset = true):Promise<void> {
    try {
      for (let key of this.signMap.keys()) {
        if (!owner || owner == key) {
          let ids = this.signMap.get(key)
          if (ids) await this.clearSigns(ids)
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
      if (reset) await this.setDiagnosticInfo()
    } catch (e) {
      logger.error(e.stack)
    }
  }

  private async addSign(owner, line:number, severity:DiagnosticSeverity):Promise<void> {
    let {buffer, nvim} = this
    if (!buffer) return
    let signId = this.getSignId(owner)
    let name = getNameFromSeverity(severity)
    await nvim.command(`sign place ${signId} line=${line + 1} name=${name} buffer=${buffer.id}`)
  }

  private async setDiagnosticInfo():Promise<void> {
    let {buffer} = this
    if (!buffer) return
    let error =0 , warning = 0, information = 0, hint = 0
    for (let [, diagnocticInfo] of this.infoMap) {
      if (!diagnocticInfo) continue
      error = error + diagnocticInfo.error
      warning = warning + diagnocticInfo.warning
      information = information + diagnocticInfo.information
      hint = hint + diagnocticInfo.hint
    }
    await buffer.setVar('coc_diagnostic_info', {error, warning, information, hint})
  }

  private async addHighlight(srcId:number, range:Range):Promise<void> {
    let document = workspace.getDocument(this.uri)
    if (!document) return
    let {start, end} = range
    try {
      for (let i = start.line; i<= end.line; i++) {
        let line = document.getline(i)
        if (!line || !line.length) continue
        let s = i == start.line ? start.character : 0
        let e = i == end.line ? end.character : -1
        await this.buffer.addHighlight({
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
    let {buffer} = this
    if (!buffer) return
    await buffer.clearHighlight({srcId})
  }

  private async clearSigns(signs:number[]):Promise<void> {
    let {buffer} = this
    if (!buffer) return
    let {id} = buffer
    setTimeout(() => {
      for (let sign of signs) {
        this.nvim.command(`sign unplace ${sign} buffer=${id}`).catch(e => {
          logger.error(e.stack)
        })
      }
    }, 50)
  }

  private get buffer():Buffer {
    let doc = workspace.getDocument(this.uri)
    if (doc) return doc.buffer
    return null
  }

  private async getSrcId(owner:string):Promise<number> {
    let {buffer} = this
    if (!buffer) return
    let srcId = this.srcIdMap.get(owner)
    if (!srcId) {
      srcId = await buffer.addHighlight({ line: 0, srcId: 0 })
      this.srcIdMap.set(owner, srcId)
    }
    return srcId as number
  }

  private getSignId(owner:string):number {
    let signId = this.signId + 1
    let ids = this.signMap.get(owner) || []
    ids.push(signId)
    this.signMap.set(owner, ids)
    this.signId = signId
    return signId
  }
}

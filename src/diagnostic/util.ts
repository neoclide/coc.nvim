import { DiagnosticSeverity, Diagnostic, DiagnosticTag } from 'vscode-languageserver-protocol'
import { FloatConfig, LocationListItem } from '../types'
import { comparePosition } from '../util/position'

export enum DiagnosticHighlight {
  Error = 'CocErrorHighlight',
  Warning = 'CocWarningHighlight',
  Information = 'CocInfoHighlight',
  Hint = 'CocHintHighlight',
  Deprecated = 'CocDeprecatedHighlight',
  Unused = 'CocUnusedHighlight'
}

export interface DiagnosticConfig {
  highlighLimit: number
  highlightPriority: number
  autoRefresh: boolean
  enableSign: boolean
  locationlistUpdate: boolean
  enableHighlightLineNumber: boolean
  checkCurrentLine: boolean
  enableMessage: string
  displayByAle: boolean
  signPriority: number
  errorSign: string
  warningSign: string
  infoSign: string
  hintSign: string
  level: number
  locationlistLevel: number | undefined
  signLevel: number | undefined
  messageLevel: number | undefined
  messageTarget: string
  messageDelay: number
  refreshOnInsertMode: boolean
  virtualText: boolean
  virtualTextLevel: number | undefined
  virtualTextAlignRight: boolean
  virtualTextWinCol: number | null
  virtualTextCurrentLineOnly: boolean
  virtualTextSrcId?: number
  virtualTextPrefix: string
  virtualTextLines: number
  virtualTextLineSeparator: string
  filetypeMap: object
  showUnused?: boolean
  showDeprecated?: boolean
  format?: string
  floatConfig: FloatConfig
}

export function getSeverityName(severity: DiagnosticSeverity): string {
  switch (severity) {
    case DiagnosticSeverity.Warning:
      return 'Warning'
    case DiagnosticSeverity.Information:
      return 'Information'
    case DiagnosticSeverity.Hint:
      return 'Hint'
    default:
      return 'Error'
  }
}

export function getSeverityType(severity: DiagnosticSeverity): string {
  switch (severity) {
    case DiagnosticSeverity.Warning:
      return 'W'
    case DiagnosticSeverity.Information:
      return 'I'
    case DiagnosticSeverity.Hint:
      return 'I'
    default:
      return 'E'
  }
}

export function severityLevel(level: string | null | undefined): number | undefined {
  if (level == null) return undefined
  switch (level) {
    case 'hint':
      return DiagnosticSeverity.Hint
    case 'information':
      return DiagnosticSeverity.Information
    case 'warning':
      return DiagnosticSeverity.Warning
    case 'error':
      return DiagnosticSeverity.Error
    default:
      return DiagnosticSeverity.Hint
  }
}

export function getNameFromSeverity(severity: DiagnosticSeverity): string {
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

export function getLocationListItem(bufnr: number, diagnostic: Diagnostic): LocationListItem {
  let { start, end } = diagnostic.range
  let owner = diagnostic.source || 'coc.nvim'
  let msg = diagnostic.message.split('\n')[0]
  let type = getSeverityName(diagnostic.severity).slice(0, 1).toUpperCase()
  return {
    bufnr,
    lnum: start.line + 1,
    end_lnum: end.line + 1,
    col: start.character + 1,
    end_col: end.character + 1,
    text: `[${owner}${diagnostic.code ? ' ' + diagnostic.code : ''}] ${msg} [${type}]`,
    type
  }
}

/**
 * Sort by severity and position
 */
export function sortDiagnostics(a: Diagnostic, b: Diagnostic): number {
  if ((a.severity || 1) != (b.severity || 1)) {
    return (a.severity || 1) - (b.severity || 1)
  }
  let d = comparePosition(a.range.start, b.range.start)
  if (d != 0) return d
  return a.source > b.source ? 1 : -1
}

export function getHighlightGroup(diagnostic: Diagnostic): DiagnosticHighlight {
  let tags = diagnostic.tags || []
  if (tags.includes(DiagnosticTag.Deprecated)) {
    return DiagnosticHighlight.Deprecated
  }
  if (tags.includes(DiagnosticTag.Unnecessary)) {
    return DiagnosticHighlight.Unused
  }
  switch (diagnostic.severity) {
    case DiagnosticSeverity.Warning:
      return DiagnosticHighlight.Warning
    case DiagnosticSeverity.Information:
      return DiagnosticHighlight.Information
    case DiagnosticSeverity.Hint:
      return DiagnosticHighlight.Hint
    default:
      return DiagnosticHighlight.Error
  }
}

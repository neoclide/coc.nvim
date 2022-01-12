import { DiagnosticSeverity, Diagnostic } from 'vscode-languageserver-protocol'
import { LocationListItem } from '../types'

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

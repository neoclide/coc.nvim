'use strict'
import { FormattingOptions, SymbolKind } from 'vscode-languageserver-types'

export interface VimFormatOption {
  tabsize: number
  expandtab: number
  insertFinalNewline: boolean
  trimTrailingWhitespace: boolean
  trimFinalNewlines: boolean
}

export function convertFormatOptions(opts: VimFormatOption): FormattingOptions {
  let obj: FormattingOptions = { tabSize: opts.tabsize, insertSpaces: opts.expandtab == 1 }
  if (opts.insertFinalNewline) obj.insertFinalNewline = true
  if (opts.trimTrailingWhitespace) obj.trimTrailingWhitespace = true
  if (opts.trimFinalNewlines) obj.trimFinalNewlines = true
  return obj
}

export function getSymbolKind(kind: SymbolKind): string {
  switch (kind) {
    case SymbolKind.File:
      return 'File'
    case SymbolKind.Module:
      return 'Module'
    case SymbolKind.Namespace:
      return 'Namespace'
    case SymbolKind.Package:
      return 'Package'
    case SymbolKind.Class:
      return 'Class'
    case SymbolKind.Method:
      return 'Method'
    case SymbolKind.Property:
      return 'Property'
    case SymbolKind.Field:
      return 'Field'
    case SymbolKind.Constructor:
      return 'Constructor'
    case SymbolKind.Enum:
      return 'Enum'
    case SymbolKind.Interface:
      return 'Interface'
    case SymbolKind.Function:
      return 'Function'
    case SymbolKind.Variable:
      return 'Variable'
    case SymbolKind.Constant:
      return 'Constant'
    case SymbolKind.String:
      return 'String'
    case SymbolKind.Number:
      return 'Number'
    case SymbolKind.Boolean:
      return 'Boolean'
    case SymbolKind.Array:
      return 'Array'
    case SymbolKind.Object:
      return 'Object'
    case SymbolKind.Key:
      return 'Key'
    case SymbolKind.Null:
      return 'Null'
    case SymbolKind.EnumMember:
      return 'EnumMember'
    case SymbolKind.Struct:
      return 'Struct'
    case SymbolKind.Event:
      return 'Event'
    case SymbolKind.Operator:
      return 'Operator'
    case SymbolKind.TypeParameter:
      return 'TypeParameter'
    default:
      return 'Unknown'
  }
}

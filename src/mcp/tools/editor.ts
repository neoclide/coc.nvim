'use strict'
import { Neovim } from '@chemzqm/neovim'
import { DocumentSymbol, Position, Range } from 'vscode-languageserver-types'
import diagnosticManager from '../../diagnostic/manager'
import type Document from '../../model/document'
import window from '../../window'
import workspace from '../../workspace'
import type { McpTool, ToolContext } from './index'
import { errorResult, textResult } from './util'
import { configuredServiceId, getDocumentSymbolResult, symbolKindName } from './lsp'
import { positionInRange } from '../../util/position'

/**
 * Editor state tool: snapshot of the active editor (document, cursor,
 * selection, visible lines, surrounding lines, symbol under cursor and
 * diagnostics) for agents that need current context.
 */

export function lineText(doc: Document, line: number): string {
  if (line < 0 || line >= doc.lineCount) return ''
  return doc.getLines(line, line + 1)[0] ?? ''
}

export function innermostSymbol(symbols: DocumentSymbol[] | null | undefined, pos: Position): { name: string, kind: string } | null {
  let best: { name: string, kind: string, depth: number } | null = null
  let walk = (list: DocumentSymbol[] | undefined, depth: number): void => {
    for (let s of list ?? []) {
      if (positionInRange(pos, s.range) === 0) {
        best = { name: s.name, kind: (symbolKindName(s.kind) ?? '').toLowerCase(), depth }
        walk(s.children, depth + 1)
      }
    }
  }
  walk(symbols, 0)
  return best ? { name: best.name, kind: best.kind } : null
}

interface VisualSelection {
  range: Range
  text: string
}

/**
 * Read the active visual selection in real time from Vim: check mode() first,
 * then take the selection start from the `v` mark and the current cursor as
 * the end. Returns null when not in visual mode. Vim columns are 1-based byte
 * offsets and are converted to 0-based UTF-16 character offsets for the LSP
 * range; the range is normalized so backwards selections still return the
 * selected text.
 */
export async function getVisualSelection(doc: Document, nvim: Neovim): Promise<VisualSelection | null> {
  let mode = await nvim.call('mode', []) as string
  if (mode !== 'v' && mode !== 'V' && mode !== '\x16') return null
  let [sl, sc, cl, cc, exclusive] = await nvim.eval(`[line('v'), col('v'), line('.'), col('.'), &selection ==# 'exclusive']`) as [number, number, number, number, boolean]
  let [startText, endText] = await nvim.eval(`[strpart(getline(${sl}), 0, ${sc} - 1), strpart(getline(${cl}), 0, ${cc} - 1)]`) as [string, string]
  let startChar = startText.length
  let endChar = endText.length
  let range: Range
  if (mode === 'V') {
    let start = Position.create(Math.min(sl, cl) - 1, 0)
    let end = Position.create(Math.max(sl, cl), 0)
    range = Range.create(start, end)
  } else {
    let start = Position.create(sl - 1, startChar)
    let end = Position.create(cl - 1, endChar)
    if (end.line < start.line || (end.line === start.line && end.character < start.character)) {
      let tmp = start
      start = end
      end = tmp
    }
    // Vim's mark and cursor columns both point at characters, while an LSP
    // range has an exclusive end. Normalize first so backwards selections
    // extend the actual range end rather than the current cursor endpoint.
    let samePosition = start.line === end.line && start.character === end.character
    if (!exclusive || samePosition) {
      let endLine = lineText(doc, end.line)
      if (end.character !== endLine.length) {
        let character = Array.from(endLine.slice(end.character))[0]
        end = Position.create(end.line, end.character + (character?.length ?? 0))
      }
    }
    range = Range.create(start, end)
  }
  return { range, text: doc.textDocument.getText(range) }
}

export function createEditorTools(): McpTool[] {
  return [
    {
      name: 'editor/state',
      title: 'Editor State',
      description: 'Return a snapshot of the active editor: workspace root, active document (uri, language, version), cursor position, latest visual selection, visible line range, surrounding lines (previous/current/next), innermost document symbol under the cursor and current diagnostics.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      outputSchema: {
        type: 'object',
        properties: {
          workspace: { type: 'string', description: 'Workspace root path.' },
          document: {
            type: 'object',
            properties: {
              uri: { type: 'string' },
              language: { type: 'string' },
              version: { type: 'integer' }
            }
          },
          cursor: { $ref: '#/definitions/Position' },
          selection: {
            type: ['object', 'null'],
            properties: {
              range: { $ref: '#/definitions/Range' },
              text: { type: 'string' }
            },
            description: 'Active visual selection, null when not in visual mode.'
          },
          visibleRange: {
            type: ['object', 'null'],
            properties: {
              start: { type: 'integer', description: '0-based first visible line.' },
              end: { type: 'integer', description: '0-based last visible line, inclusive.' },
              lines: { type: 'array', items: { type: 'string' } }
            }
          },
          surroundingCode: {
            type: 'object',
            properties: {
              before: { type: 'string', description: 'Text of the line above the cursor.' },
              current: { type: 'string', description: 'Text of the line containing the cursor.' },
              after: { type: 'string', description: 'Text of the line below the cursor.' }
            }
          },
          symbol: {
            type: ['object', 'null'],
            properties: {
              name: { type: 'string' },
              kind: { type: 'string' }
            },
            description: 'Innermost document symbol containing the cursor, null when unknown.'
          },
          diagnostics: {
            type: 'array',
            items: { type: 'object' },
            description: 'LSP diagnostics of the active document.'
          }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (_args: any, context: ToolContext) => {
        let editor = window.activeTextEditor
        if (!editor) return errorResult('No active editor')
        let doc = editor.document
        let nvim = workspace.nvim
        let cursor = await window.getCursorPosition()
        let selection = await getVisualSelection(doc, nvim)
        let visible = await nvim.call('coc#window#visible_range', [editor.winid]) as [number, number] | null
        let visibleRange = visible
          ? { start: visible[0] - 1, end: visible[1] - 1, lines: doc.getLines(visible[0] - 1, visible[1]) }
          : null
        let symbol: { name: string, kind: string } | null = null
        try {
          doc._forceSync()
          let res = await getDocumentSymbolResult(doc, configuredServiceId(doc), context.token)
          if (!('error' in res)) {
            symbol = innermostSymbol(res.symbols, cursor)
          }
        } catch (_e) {
          // symbol is best-effort; keep the rest of the state
        }
        let result = {
          workspace: workspace.root,
          document: {
            uri: doc.uri,
            language: doc.languageId,
            version: doc.version
          },
          cursor,
          selection,
          visibleRange,
          surroundingCode: {
            before: lineText(doc, cursor.line - 1),
            current: lineText(doc, cursor.line),
            after: lineText(doc, cursor.line + 1)
          },
          symbol,
          diagnostics: diagnosticManager.getDiagnosticsInRange(doc.textDocument)
        }
        let text = [
          `Workspace: ${result.workspace}`,
          `Document: ${result.document.uri} (${result.document.language}, v${result.document.version})`,
          `Cursor: ${result.cursor.line}:${result.cursor.character}`,
          result.selection ? `Selection: ${result.selection.range.start.line}:${result.selection.range.start.character}-${result.selection.range.end.line}:${result.selection.range.end.character} ${JSON.stringify(result.selection.text)}` : 'Selection: none',
          result.visibleRange ? `Visible: lines ${result.visibleRange.start}-${result.visibleRange.end}` : 'Visible: n/a',
          result.symbol ? `Symbol: ${result.symbol.name} (${result.symbol.kind})` : 'Symbol: n/a',
          `Diagnostics: ${result.diagnostics.length}`
        ].join('\n')
        return textResult(text, result)
      }
    }
  ]
}

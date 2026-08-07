'use strict'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import languages from '../../languages'
import { createLogger } from '../../logger'
import type Document from '../../model/document'
import { isFalsyOrEmpty } from '../../util/array'
import { readFileLines } from '../../util/fs'
import { fs } from '../../util/node'
import workspace from '../../workspace'
import { McpTool, ToolContext } from './index'
import { checkPath, errorResult, resolveDocument, textResult, toFsPath, toUri } from './util'
const logger = createLogger('mcp-document')

const MAX_READ_BYTES = 2 * 1024 * 1024

export function readDiskText(uri: string): { text: string, error?: string } {
  let filepath = toFsPath(uri)
  try {
    let stat = fs.statSync(filepath)
    if (stat.size > MAX_READ_BYTES) {
      return { text: '', error: `File exceeds ${MAX_READ_BYTES} bytes, use range or startLine/endLine` }
    }
    return { text: fs.readFileSync(filepath, 'utf8') }
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Read a line window (0-based, end exclusive) from disk without loading the
 * whole file, using coc's incremental readFileLines.
 */
export async function readDiskWindow(uri: string, startLine: number, endLine: number): Promise<{ lines: string[], error?: string }> {
  let filepath = toFsPath(uri)
  try {
    // readFileLines end is inclusive
    let lines = await readFileLines(filepath, startLine, Math.max(startLine, endLine - 1))
    return { lines }
  } catch (e) {
    return { lines: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Reconstruct the exact text of an LSP range from a line window read from
 * disk (lines[0] corresponds to range.start.line).
 */
export function windowToRangeText(lines: string[], range: any): string {
  if (lines.length === 0) return ''
  let start = range.start
  let end = range.end
  if (lines.length === 1) {
    return lines[0].slice(start.character, end.character)
  }
  let middle = lines.slice(1, -1)
  return lines[0].slice(start.character) +
    '\n' + middle.join('\n') +
    (middle.length > 0 ? '\n' : '') +
    lines[lines.length - 1].slice(0, end.character)
}

export function lineWindow(doc: Document, startLine: number | undefined, endLine: number | undefined): string {
  let start = Math.max(0, startLine ?? 0)
  let end = endLine ?? doc.lineCount
  if (end <= start) return ''
  let lines = doc.getLines(start, end)
  return lines.join('\n')
}

export function toTextEdits(args: any): TextEdit[] | null {
  let edits = args?.edits
  if (!Array.isArray(edits) || edits.length === 0) return null
  let result: TextEdit[] = []
  for (let edit of edits) {
    if (!edit || typeof edit !== 'object' || !edit.range || typeof edit.newText !== 'string') return null
    let range = edit.range
    if (
      !range.start || typeof range.start.line !== 'number' || typeof range.start.character !== 'number' ||
      !range.end || typeof range.end.line !== 'number' || typeof range.end.character !== 'number'
    ) {
      return null
    }
    result.push(TextEdit.replace(Range.create(range.start, range.end), edit.newText))
  }
  return result
}

async function saveDocument(doc: Document): Promise<void> {
  let { nvim } = workspace
  let bufnr = doc.bufnr
  let winid = await nvim.call('bufwinid', [bufnr]) as number
  if (winid > 0) {
    await nvim.call('win_execute', [winid, 'write'])
    return
  }
  // Hidden buffer: temporarily make it current, write, restore.
  let curr = await nvim.eval('bufnr("%")') as number
  await nvim.command(`silent! buffer ${bufnr}`)
  try {
    await nvim.command('write')
  } finally {
    if (curr && curr !== bufnr) {
      await nvim.command(`silent! buffer ${curr}`)
    }
  }
}

export function createDocumentTools(): McpTool[] {
  return [
    {
      name: 'document/read',
      title: 'Read Document',
      description: 'Read text from an editor buffer (unsaved changes included). Supports full text, an LSP range, or a line window; the disk fallback reads only the requested lines incrementally, so large files are fine for range/line reads.',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'File URI or absolute path. Omit to use the active document.' },
          range: {
            type: 'object',
            properties: {
              start: { $ref: '#/definitions/Position' },
              end: { $ref: '#/definitions/Position' }
            },
            description: 'LSP range to read; omit for full text.'
          },
          startLine: { type: 'integer', description: '0-based inclusive start line for a line window.' },
          endLine: { type: 'integer', description: '0-based exclusive end line for a line window.' }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          version: { type: 'integer' },
          changedtick: { type: 'integer' },
          languageId: { type: 'string' },
          text: { type: 'string' },
          lineCount: { type: 'integer' },
          fromBuffer: { type: 'boolean' }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (args: any) => {
        let ref = await resolveDocument(args?.uri, false)
        if (ref.error) return errorResult(ref.error)
        let uri = ref.uri
        let fromBuffer = false
        let text: string
        let version = -1
        let changedtick = -1
        let languageId = ''
        if (ref.doc) {
          fromBuffer = true
          version = ref.doc.version
          changedtick = ref.doc.changedtick
          languageId = ref.doc.languageId
          if (args?.range) {
            text = ref.doc.textDocument.getText(Range.create(args.range.start, args.range.end))
          } else if (args?.startLine !== undefined || args?.endLine !== undefined) {
            text = lineWindow(ref.doc, args.startLine, args.endLine)
          } else {
            text = ref.doc.getDocumentContent()
          }
        } else {
          if (args?.range) {
            let start = Math.max(0, args.range.start.line)
            let end = Math.max(start + 1, args.range.end.line + 1)
            let read = await readDiskWindow(uri, start, end)
            if (read.error) return errorResult(read.error)
            text = windowToRangeText(read.lines, args.range)
          } else if (args?.startLine !== undefined || args?.endLine !== undefined) {
            let start = Math.max(0, args.startLine ?? 0)
            let end = Math.max(start + 1, args.endLine ?? start + 1)
            let read = await readDiskWindow(uri, start, end)
            if (read.error) return errorResult(read.error)
            text = read.lines.join('\n')
          } else {
            let read = readDiskText(uri)
            if (read.error) return errorResult(read.error)
            text = read.text
          }
        }
        let result = {
          uri,
          version,
          changedtick,
          languageId,
          text,
          lineCount: ref.doc ? ref.doc.lineCount : text.split('\n').length,
          fromBuffer
        }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    },
    {
      name: 'document/read_lines',
      title: 'Read Document Lines',
      description: 'Read a line window from an editor buffer (0-based, end exclusive). Returns lines with their numbers.',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          startLine: { type: 'integer', default: 0 },
          endLine: { type: 'integer', description: 'Exclusive end line; defaults to the last line.' },
          maxLines: { type: 'integer', default: 5000 }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          fromBuffer: { type: 'boolean' },
          lines: { type: 'array', items: { type: 'object' } }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (args: any) => {
        let ref = await resolveDocument(args?.uri, false)
        if (ref.error) return errorResult(ref.error)
        let maxLines = Math.max(1, args?.maxLines ?? 5000)
        if (ref.doc) {
          let start = Math.max(0, args?.startLine ?? 0)
          let end = Math.min(ref.doc.lineCount, args?.endLine ?? ref.doc.lineCount)
          if (end - start > maxLines) end = start + maxLines
          let lines = ref.doc.getLines(start, end).map((text, index) => ({ line: start + index, text }))
          let result = { uri: ref.uri, startLine: start, endLine: end, lines, fromBuffer: true }
          return textResult(JSON.stringify(result, null, 2), result)
        }
        let start = Math.max(0, args?.startLine ?? 0)
        let end = args?.endLine ?? start + maxLines
        if (end - start > maxLines) end = start + maxLines
        let read = await readDiskWindow(ref.uri, start, end)
        if (read.error) return errorResult(read.error)
        let lines = read.lines.map((text, index) => ({ line: start + index, text }))
        let result = { uri: ref.uri, startLine: start, endLine: start + lines.length, lines, fromBuffer: false }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    },
    {
      name: 'document/apply_edits',
      title: 'Apply Document Edits',
      description: 'Apply LSP TextEdits to one document. target "buffer" only affects the editor buffer (disk unchanged); "both" writes disk after applying. Fails with a conflict result when the given version does not match the current document version.',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          version: { type: 'integer', description: 'Document version from document/read; checked for optimistic concurrency.' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                range: {
                  type: 'object',
                  properties: {
                    start: { $ref: '#/definitions/Position' },
                    end: { $ref: '#/definitions/Position' }
                  }
                },
                newText: { type: 'string' }
              },
              required: ['range', 'newText']
            },
            minItems: 1
          },
          target: { type: 'string', enum: ['buffer', 'both'], default: 'both' },
          joinUndo: { type: 'boolean', default: true }
        },
        required: ['edits']
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          applied: { type: 'boolean' },
          target: { type: 'string' },
          editCount: { type: 'integer' },
          version: { type: 'integer' },
          changedtick: { type: 'integer' }
        }
      },
      annotations: { destructiveHint: true, idempotentHint: false },
      handler: async (args: any) => {
        let edits = toTextEdits(args)
        if (!edits) return errorResult('edits must be a non-empty array of {range, newText}')
        let ref = await resolveDocument(args?.uri, true)
        if (ref.error) return errorResult(ref.error)
        let doc = ref.doc!
        if (typeof args?.version === 'number' && args.version !== doc.version) {
          return errorResult(`Document version conflict: expected ${args.version}, current ${doc.version}. Re-read the document and retry.`)
        }
        try {
          await doc.applyEdits(edits, args?.joinUndo !== false)
        } catch (e) {
          return errorResult(`Failed to apply edits: ${e instanceof Error ? e.message : String(e)}`)
        }
        if (args?.target === 'both' || args?.target === undefined) {
          try {
            await saveDocument(doc)
          } catch (e) {
            return errorResult(`Edits applied to buffer but save failed: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        let result = {
          uri: ref.uri,
          applied: true,
          target: args?.target === 'buffer' ? 'buffer' : 'both',
          editCount: edits.length,
          version: doc.version,
          changedtick: doc.changedtick
        }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    },
    {
      name: 'document/write',
      title: 'Write Document',
      description: 'Save an open editor buffer to disk.',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          saved: { type: 'boolean' },
          version: { type: 'integer' }
        }
      },
      annotations: { destructiveHint: true },
      handler: async (args: any) => {
        let ref = await resolveDocument(args?.uri, true)
        if (ref.error) return errorResult(ref.error)
        try {
          await saveDocument(ref.doc!)
        } catch (e) {
          return errorResult(`Save failed: ${e instanceof Error ? e.message : String(e)}`)
        }
        let result = { uri: ref.uri, saved: true, version: ref.doc!.version }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    },
    {
      name: 'document/format',
      title: 'Format Document',
      description: 'Format a document or an LSP range using the language server formatter. Applies the returned TextEdits to the buffer.',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          range: {
            type: 'object',
            properties: {
              start: { $ref: '#/definitions/Position' },
              end: { $ref: '#/definitions/Position' }
            }
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          formatted: { type: 'boolean' },
          editCount: { type: 'integer' },
          version: { type: 'integer' }
        }
      },
      annotations: { destructiveHint: true, idempotentHint: true },
      handler: async (args: any, context: ToolContext) => {
        let ref = await resolveDocument(args?.uri, true)
        if (ref.error) return errorResult(ref.error)
        let doc = ref.doc!
        await doc.synchronize()
        let options = await workspace.getFormatOptions(ref.uri)
        let textEdits: TextEdit[] | undefined
        try {
          if (args?.range) {
            textEdits = await languages.provideDocumentRangeFormattingEdits(doc.textDocument, Range.create(args.range.start, args.range.end), options, context.token)
          } else {
            textEdits = await languages.provideDocumentFormattingEdits(doc.textDocument, options, context.token)
          }
        } catch (e) {
          return errorResult(`Format request failed: ${e instanceof Error ? e.message : String(e)}`)
        }
        if (isFalsyOrEmpty(textEdits)) {
          let result = { uri: ref.uri, formatted: false, editCount: 0, version: doc.version }
          return textResult(JSON.stringify(result, null, 2), result)
        }
        await doc.applyEdits(textEdits, false, true)
        let result = { uri: ref.uri, formatted: true, editCount: textEdits.length, version: doc.version }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    },
    {
      name: 'document/open',
      title: 'Open Documents',
      description: 'Open one or more files in the Vim/Neovim editor using workspace.openResource (which honors coc.preferences.jumpCommand), optionally at a 1-based line (and column) via a "#line" fragment. Typical usage: after editing files, open each file at its first changed line.',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'File URI or absolute path (single file).' },
          line: { type: 'integer', description: '1-based line to jump to (with uri).' },
          col: { type: 'integer', description: '1-based column to jump to (with uri, default 1).' },
          files: {
            type: 'array',
            description: 'Files to open: strings (uri/path) or { uri, line?, col? }.',
            items: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    uri: { type: 'string' },
                    line: { type: 'integer' },
                    col: { type: 'integer' }
                  },
                  required: ['uri']
                }
              ]
            }
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          files: { type: 'array' }
        }
      },
      annotations: { readOnlyHint: true },
      handler: async (args: any) => {
        let targets: Array<{ uri: string, line?: number, col?: number }> = []
        if (Array.isArray(args?.files)) {
          for (let item of args.files) {
            if (typeof item === 'string') {
              targets.push({ uri: toUri(item) })
            } else if (item && typeof item.uri === 'string') {
              targets.push({ uri: toUri(item.uri), line: item.line, col: item.col })
            } else {
              return errorResult('files entries must be strings or { uri, line?, col? }')
            }
          }
        } else if (typeof args?.uri === 'string') {
          targets.push({ uri: toUri(args.uri), line: args.line, col: args.col })
        } else {
          return errorResult('uri or files is required')
        }
        if (targets.length === 0) return errorResult('no files to open')
        let opened: Array<{ uri: string, line?: number, col?: number }> = []
        for (let target of targets) {
          let denied = checkPath(target.uri)
          if (denied) return errorResult(denied)
          let u = URI.parse(target.uri)
          if (typeof target.line === 'number') {
            let line = Math.max(1, Math.floor(target.line))
            let fragment = String(line)
            if (typeof target.col === 'number' && target.col > 0) {
              fragment += ',' + Math.floor(target.col)
            }
            u = u.with({ fragment })
          }
          try {
            // openResource delegates to jumpTo, which parses the "#line[,col]"
            // fragment and uses coc.preferences.jumpCommand for the open command
            await workspace.openResource(u.toString())
          } catch (e) {
            return errorResult(`Failed to open ${target.uri}: ${e instanceof Error ? e.message : String(e)}`)
          }
          opened.push({ uri: target.uri, line: target.line, col: target.col })
        }
        let result = { count: opened.length, files: opened }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    }
  ]
}

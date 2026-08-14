'use strict'
import { URI } from 'vscode-uri'
import RelativePatternImpl from '../../model/relativePattern'
import services from '../../services'
import { child_process, fs, which } from '../../util/node'
import { escapeRegExp } from '../../util/string'
import workspace from '../../workspace'
import type { McpTool, McpToolResult } from './index'
import { checkPath, collectEditUris, countProperty, errorResult, textResult, toFsPath, uriProperty } from './util'

/**
 * Workspace tools: editor state, configuration, file search and file
 * operations (all routed through coc.nvim so buffers, LSP state and undo stay
 * in sync).
 */

interface SearchMatch {
  file: string
  line: number
  column: number
  text: string
}

export function findRg(): string | null {
  try {
    return which.sync('rg')
  } catch (_e) {
    return null
  }
}

export function parseRgLine(line: string): SearchMatch | null {
  try {
    let obj = JSON.parse(line)
    if (obj.type !== 'match') return null
    let data = obj.data
    if (!data || !data.path || !data.lines) return null
    let lineText = typeof data.lines.text === 'string' ? data.lines.text : ''
    lineText = lineText.replace(/\n$/, '')
    let start = data.submatches && data.submatches[0] ? data.submatches[0].start : 0
    let column = Buffer.from(lineText, 'utf8').subarray(0, start).toString('utf8').length
    return { file: data.path.text, line: (data.line_number || 1) - 1, column, text: lineText }
  } catch (_e) {
    return null
  }
}

export function searchWithRg(pattern: string, args: any, root: string, maxResults: number): Promise<SearchMatch[]> {
  return new Promise((resolve, reject) => {
    let rg = findRg()
    if (!rg) {
      reject(new Error('rg not found'))
      return
    }
    let argv = ['--json', '--line-number', '--column', '--no-heading', '--color', 'never']
    if (args.regex !== true) argv.push('--fixed-strings')
    if (args.caseSensitive === false) argv.push('--ignore-case')
    else if (args.caseSensitive == null) argv.push('--smart-case')
    if (typeof args.include === 'string' && args.include) argv.push('--glob', args.include)
    if (typeof args.exclude === 'string' && args.exclude) argv.push('--glob', `!${args.exclude}`)
    argv.push('--', pattern, root)
    let cp = child_process.spawn(rg, argv, { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    let results: SearchMatch[] = []
    let done = false
    let timer = setTimeout(() => {
      cp.kill()
    }, 15000)
    cp.stdout.on('data', (chunk: Buffer) => {
      if (done) return
      output += chunk.toString('utf8')
      if (output.length > 5 * 1024 * 1024) {
        done = true
        cp.kill()
      }
      let idx: number
      while ((idx = output.indexOf('\n')) !== -1) {
        let line = output.slice(0, idx)
        output = output.slice(idx + 1)
        let match = parseRgLine(line)
        // Only return matches for files that pass the path policy; the count
        // limit applies to allowed matches, not raw rg output.
        if (match && !checkPath(match.file)) {
          results.push(match)
          if (results.length >= maxResults) {
            done = true
            cp.kill()
          }
        }
      }
    })
    cp.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    cp.on('close', () => {
      clearTimeout(timer)
      resolve(results)
    })
  })
}

export async function searchWithJs(pattern: string, args: any, root: string, maxResults: number): Promise<SearchMatch[]> {
  let include = new RelativePatternImpl(URI.file(root), typeof args.include === 'string' && args.include ? args.include : '**/*')
  let uris = await workspace.findFiles(include, args.exclude || null, 500)
  // One (first) match per line, searched from the start of every line: the
  // global flag would carry lastIndex across lines and skip matches.
  let flags = args.caseSensitive === true ? '' : 'i'
  let source = args.regex === true ? pattern : escapeRegExp(pattern)
  let re: RegExp
  try {
    re = new RegExp(source, flags)
  } catch (e) {
    throw new Error(`Invalid regex: ${e instanceof Error ? e.message : String(e)}`)
  }
  let results: SearchMatch[] = []
  for (let uri of uris) {
    if (results.length >= maxResults) break
    let filepath = uri.fsPath
    if (checkPath(filepath)) continue
    let content: string
    try {
      let stat = fs.statSync(filepath)
      if (stat.size > 2 * 1024 * 1024) continue
      content = fs.readFileSync(filepath, 'utf8')
    } catch (_e) {
      continue
    }
    if (content.includes('\0')) continue
    let lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= maxResults) break
      let match = re.exec(lines[i])
      if (match) {
        results.push({ file: filepath, line: i, column: match.index ?? 0, text: lines[i] })
      }
    }
  }
  return results
}

export function getConfigValue(key: string): any {
  try {
    let conf: any = workspace.configurations.configuration.getValue(undefined, {})
    if (!key) return conf
    return key.split('.').reduce((obj: any, k: string) => {
      return obj == null ? undefined : obj[k]
    }, conf)
  } catch (_e) {
    return undefined
  }
}

export function createWorkspaceTools(): McpTool[] {
  return [
    {
      name: 'workspace/info',
      title: 'Workspace Information',
      description: 'Get workspace root, folders, cwd, opened documents and language server status of the coc.nvim instance.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          version: { type: 'string' },
          cwd: { type: 'string' },
          root: { type: 'string' },
          folders: { type: 'array' },
          documents: { type: 'array' },
          services: { type: 'array' }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async () => {
        let folders: any[] = []
        let documents: any[] = []
        let serviceList: any[] = []
        try {
          folders = workspace.workspaceFolders.map(f => ({ name: f.name, uri: f.uri }))
        } catch (_e) {
          // workspace not initialized yet
        }
        try {
          documents = workspace.documents.map(d => ({
            uri: d.uri,
            languageId: d.languageId,
            version: d.version
          }))
        } catch (_e) {
          // documents manager not initialized yet
        }
        try {
          serviceList = services.getServiceStats().map(s => ({
            id: s.id,
            state: s.state,
            languageIds: s.languageIds
          }))
        } catch (_e) {
          // services not initialized yet
        }
        let info = {
          version: workspace.version,
          cwd: workspace.cwd || process.cwd(),
          root: workspace.root || process.cwd(),
          folders,
          documents,
          services: serviceList
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
          structuredContent: info
        }
      }
    },
    {
      name: 'workspace/configuration',
      title: 'Read coc Configuration',
      description: 'Read a coc.nvim configuration value by dotted key, e.g. "mcp.autoStart". Returns value and inspection data (default/user/workspace sources).',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Dotted configuration key, e.g. "mcp.autoStart". Empty string returns the whole configuration tree.'
          }
        },
        required: ['key']
      },
      outputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: {},
          inspect: {}
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (args: any) => {
        let key = typeof args?.key === 'string' ? args.key : ''
        let value = getConfigValue(key)
        let inspect: any
        try {
          if (key) inspect = workspace.getConfiguration(null, null).inspect(key)
        } catch (_e) {
          // ignore
        }
        let result = { key, value, inspect }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result
        }
      }
    },
    {
      name: 'workspace/search',
      title: 'Search Workspace',
      description: 'Search files in the workspace with ripgrep (fallback: built-in JavaScript search). Returns {file, line, column, text} matches.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          regex: { type: 'boolean', default: false, description: 'Treat pattern as a regular expression.' },
          include: { type: 'string', description: 'Glob of files to include, e.g. "**/*.ts".' },
          exclude: { type: 'string', description: 'Glob of files to exclude.' },
          caseSensitive: { type: 'boolean' },
          root: { type: 'string', description: 'Directory to search, defaults to the workspace root.' },
          maxResults: { type: 'integer', default: 100 }
        },
        required: ['pattern']
      },
      outputSchema: {
        type: 'object',
        properties: {
          ...countProperty,
          engine: { type: 'string' },
          matches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                file: { type: 'string' },
                line: { type: 'integer' },
                column: { type: 'integer' },
                text: { type: 'string' }
              }
            }
          }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (args: any) => {
        let pattern = args?.pattern
        if (typeof pattern !== 'string' || pattern.length === 0) {
          return errorResult('pattern is required')
        }
        let root = args?.root ? toFsPath(args.root) : workspace.root || process.cwd()
        let rootDenied = checkPath(root)
        if (rootDenied) return errorResult(rootDenied)
        let maxResults = Math.min(Math.max(1, args?.maxResults ?? 100), 500)
        let engine = 'rg'
        let matches: SearchMatch[]
        try {
          if (findRg()) {
            matches = await searchWithRg(pattern, args ?? {}, root, maxResults)
          } else {
            engine = 'js'
            matches = await searchWithJs(pattern, args ?? {}, root, maxResults)
          }
        } catch (e) {
          return errorResult(`Search failed: ${e instanceof Error ? e.message : String(e)}`)
        }
        let result = { count: matches.length, engine, matches }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    },
    {
      name: 'workspace/files',
      title: 'List Workspace Files',
      description: 'List files in the workspace matching a glob pattern.',
      inputSchema: {
        type: 'object',
        properties: {
          include: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts".' },
          exclude: { type: 'string' },
          maxResults: { type: 'integer', default: 200 }
        },
        required: ['include']
      },
      outputSchema: {
        type: 'object',
        properties: {
          ...countProperty,
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                ...uriProperty,
                filepath: { type: 'string' }
              }
            }
          }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (args: any) => {
        let include = args?.include
        if (typeof include !== 'string' || include.length === 0) {
          return errorResult('include glob is required')
        }
        let maxResults = Math.min(Math.max(1, args?.maxResults ?? 200), 1000)
        let uris = await workspace.findFiles(include, args?.exclude || null, maxResults)
        let files = uris
          .filter(uri => !checkPath(uri.toString()))
          .map(uri => ({ uri: uri.toString(), filepath: uri.fsPath }))
        let result = { count: files.length, files }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    },
    {
      name: 'workspace/apply_edit',
      title: 'Apply Workspace Edit',
      description: 'Apply an LSP WorkspaceEdit (multi-file TextEdits plus create/rename/delete) through the editor, optionally with WorkspaceEditMetadata (e.g. { "isRefactoring": true }). All buffers, LSP notifications and undo are kept in sync; modified buffers are saved with :wa so the edits are on disk when the tool returns.',
      inputSchema: {
        type: 'object',
        properties: {
          edit: {
            type: 'object',
            description: 'LSP WorkspaceEdit: { changes?: {[uri]: TextEdit[]}, documentChanges?: (TextDocumentEdit|CreateFile|RenameFile|DeleteFile)[] }'
          },
          metadata: {
            type: 'object',
            description: 'Optional WorkspaceEditMetadata, e.g. { "isRefactoring": true }.',
            properties: {
              isRefactoring: { type: 'boolean' }
            }
          }
        },
        required: ['edit']
      },
      outputSchema: {
        type: 'object',
        properties: {
          applied: { type: 'boolean' },
          files: { type: 'array', items: { type: 'string' } },
          pendingSave: { type: 'boolean' },
          saved: { type: 'boolean', description: 'Whether modified buffers were written to disk after applying.' },
          saveError: { type: 'string', description: 'Error when :wa failed; edits are in buffers but files may not be on disk.' },
          metadata: { type: ['object', 'null'] }
        }
      },
      annotations: { destructiveHint: true },
      handler: async (args: any) => {
        let edit = args?.edit
        if (!edit || typeof edit !== 'object') return errorResult('edit (WorkspaceEdit) is required')
        let metadata: { isRefactoring?: boolean } | undefined
        if (args?.metadata !== undefined) {
          if (args.metadata === null || typeof args.metadata !== 'object') {
            return errorResult('metadata must be an object')
          }
          if (args.metadata.isRefactoring !== undefined && typeof args.metadata.isRefactoring !== 'boolean') {
            return errorResult('metadata.isRefactoring must be a boolean')
          }
          metadata = { isRefactoring: args.metadata.isRefactoring }
        }
        let uris = collectEditUris(edit)
        for (let uri of new Set(uris)) {
          let denied = checkPath(uri, { write: true })
          if (denied) return errorResult(denied)
        }
        let applied: boolean
        let pendingSave = false
        try {
          applied = await workspace.applyEdit(edit, metadata)
        } catch (e) {
          return errorResult(`Failed to apply edit: ${e instanceof Error ? e.message : String(e)}`)
        }
        if (Array.isArray(edit.documentChanges)) {
          pendingSave = edit.documentChanges.some((change: any) => change?.textDocument?.uri && Array.isArray(change.edits))
        } else if (edit.changes && typeof edit.changes === 'object') {
          pendingSave = Object.keys(edit.changes).length > 0
        }
        // Save all modified buffers with :wa so the edits are visible on
        // disk for subsequent tools (search, LSP, disk reads). A failed
        // save is reported instead of failing the whole call: the edits
        // were applied to the buffers.
        let saved = applied && !pendingSave
        let saveError: string | undefined
        if (applied && pendingSave) {
          try {
            await workspace.nvim.command('wa')
            saved = true
          } catch (e) {
            saved = false
            saveError = e instanceof Error ? e.message : String(e)
          }
        }
        let files = [...new Set(uris)]
        let result = {
          applied,
          files,
          pendingSave,
          saved,
          metadata: metadata ?? null,
          ...(saveError ? { saveError } : {})
        }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    },
    {
      name: 'workspace/create_file',
      title: 'Create File',
      description: 'Create a file in the editor and on disk.',
      inputSchema: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Absolute path or file URI.' },
          overwrite: { type: 'boolean', default: false },
          ignoreIfExists: { type: 'boolean', default: false }
        },
        required: ['filepath']
      },
      outputSchema: {
        type: 'object',
        properties: {
          ...uriProperty,
          filepath: { type: 'string' },
          created: { type: 'boolean' }
        }
      },
      annotations: { destructiveHint: true },
      handler: async (args: any) => {
        let input = args?.filepath
        if (typeof input !== 'string' || input.length === 0) return errorResult('filepath is required')
        let filepath = toFsPath(input)
        let denied = checkPath(filepath, { write: true })
        if (denied) return errorResult(denied)
        try {
          await workspace.createFile(filepath, {
            overwrite: args?.overwrite === true,
            ignoreIfExists: args?.ignoreIfExists === true
          })
        } catch (e) {
          return errorResult(`Failed to create ${filepath}: ${e instanceof Error ? e.message : String(e)}`)
        }
        let uri = URI.file(filepath).toString()
        let result = { uri, filepath, created: true }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    },
    {
      name: 'workspace/rename_file',
      title: 'Rename File',
      description: 'Rename or move a file, keeping open buffers in sync.',
      inputSchema: {
        type: 'object',
        properties: {
          oldPath: { type: 'string' },
          newPath: { type: 'string' },
          overwrite: { type: 'boolean', default: false },
          ignoreIfExists: { type: 'boolean', default: false }
        },
        required: ['oldPath', 'newPath']
      },
      outputSchema: {
        type: 'object',
        properties: {
          oldPath: { type: 'string' },
          newPath: { type: 'string' },
          renamed: { type: 'boolean' }
        }
      },
      annotations: { destructiveHint: true },
      handler: async (args: any) => {
        let oldInput = args?.oldPath
        let newInput = args?.newPath
        if (typeof oldInput !== 'string' || oldInput.length === 0 || typeof newInput !== 'string' || newInput.length === 0) {
          return errorResult('oldPath and newPath are required')
        }
        let oldPath = toFsPath(oldInput)
        let newPath = toFsPath(newInput)
        let denied = checkPath(oldPath, { write: true }) ?? checkPath(newPath, { write: true })
        if (denied) return errorResult(denied)
        try {
          await workspace.renameFile(oldPath, newPath, {
            overwrite: args?.overwrite === true,
            ignoreIfExists: args?.ignoreIfExists === true
          })
        } catch (e) {
          return errorResult(`Failed to rename ${oldPath}: ${e instanceof Error ? e.message : String(e)}`)
        }
        let result = { oldPath, newPath, renamed: true }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    },
    {
      name: 'workspace/delete_file',
      title: 'Delete File',
      description: 'Delete a file or directory (recursive for directories), closing associated buffers.',
      inputSchema: {
        type: 'object',
        properties: {
          filepath: { type: 'string' },
          recursive: { type: 'boolean', default: false },
          ignoreIfNotExists: { type: 'boolean', default: false }
        },
        required: ['filepath']
      },
      outputSchema: {
        type: 'object',
        properties: {
          filepath: { type: 'string' },
          deleted: { type: 'boolean' }
        }
      },
      annotations: { destructiveHint: true },
      handler: async (args: any) => {
        let input = args?.filepath
        if (typeof input !== 'string' || input.length === 0) return errorResult('filepath is required')
        let filepath = toFsPath(input)
        let denied = checkPath(filepath, { write: true })
        if (denied) return errorResult(denied)
        try {
          await workspace.deleteFile(filepath, {
            recursive: args?.recursive === true,
            ignoreIfNotExists: args?.ignoreIfNotExists === true
          })
        } catch (e) {
          return errorResult(`Failed to delete ${filepath}: ${e instanceof Error ? e.message : String(e)}`)
        }
        let result = { filepath, deleted: true }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    }
  ]
}

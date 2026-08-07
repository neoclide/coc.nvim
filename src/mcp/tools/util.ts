'use strict'
import { URI } from 'vscode-uri'
import { isParentFolder, realFsPath } from '../../util/fs'
import { fs, minimatch, os, path } from '../../util/node'
import { toArray } from '../../util/array'
import type Document from '../../model/document'
import window from '../../window'
import workspace from '../../workspace'
import { McpToolResult, TextContent } from './index'

/**
 * Shared helpers for MCP tools: result construction, uri normalization and
 * path validation (mcp.allowedPaths / mcp.deniedPaths).
 */

export function textResult(text: string, structuredContent?: any): McpToolResult {
  let result: McpToolResult = {
    content: [{ type: 'text', text }]
  }
  if (structuredContent !== undefined) result.structuredContent = structuredContent
  return result
}

export function textContent(text: string): TextContent {
  return { type: 'text', text }
}

export function errorResult(message: string): McpToolResult {
  return {
    content: [textContent(message)],
    isError: true
  }
}

/**
 * Normalize a file URI or absolute path to a file URI string.
 */
export function toUri(input: string): string {
  if (input.includes('://')) return input
  return URI.file(path.resolve(input)).toString()
}

export function toFsPath(input: string): string {
  return URI.parse(toUri(input)).fsPath
}

export interface DocumentRef {
  doc?: Document
  uri: string
  error?: string
}

/**
 * Resolve a uri/path input to an attached editor document. When `open` is
 * true, files that are not open yet are loaded as (hidden) buffers so edits
 * and LSP requests can run against them.
 */
export async function resolveDocument(uriInput: string | undefined, open: boolean): Promise<DocumentRef> {
  if (!uriInput) {
    let active = window.activeTextEditor?.document
    let uri = active ? active.uri : undefined
    if (!uri) return { uri: '', error: 'No active document, uri is required' }
    return await resolveDocument(uri, open)
  }
  let uri = toUri(uriInput)
  let denied = checkPath(uri)
  if (denied) return { uri, error: denied }
  let doc = workspace.getDocument(uri)
  if (doc && doc.attached) return { doc, uri }
  if (open) {
    try {
      let opened = await workspace.loadFile(uri, '')
      return { doc: opened, uri }
    } catch (e) {
      return { uri, error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { uri }
}

/**
 * Collect every file uri referenced by an LSP WorkspaceEdit (changes map and
 * documentChanges create/rename/delete entries).
 */
export function collectEditUris(edit: any): string[] {
  let uris: string[] = []
  if (edit && typeof edit.changes === 'object' && edit.changes !== null) {
    uris.push(...Object.keys(edit.changes))
  }
  if (Array.isArray(edit?.documentChanges)) {
    for (let change of edit.documentChanges) {
      if (!change) continue
      if (typeof change.textDocument?.uri === 'string') uris.push(change.textDocument.uri)
      if (typeof change.uri === 'string') uris.push(change.uri)
      // RenameFile carries oldUri/newUri instead of uri; both sides must be
      // authorized before the core can move anything with fs.renameSync.
      if (typeof change.oldUri === 'string') uris.push(change.oldUri)
      if (typeof change.newUri === 'string') uris.push(change.newUri)
    }
  }
  return uris
}

export function globMatch(pattern: string, fsPath: string): boolean {
  let normalized = fsPath.replace(/\\/g, '/')
  let p = pattern.replace(/\\/g, '/')
  if (!path.isAbsolute(pattern)) {
    let root = ''
    try {
      root = workspace.root || process.cwd()
    } catch (_e) {
      root = process.cwd()
    }
    p = path.join(root, pattern).replace(/\\/g, '/')
  }
  let isDir = false
  try {
    isDir = fs.statSync(fsPath).isDirectory()
  } catch (_e) {
    // nonexistent path
  }
  // "dir/**" must also match the directory itself (e.g. search roots)
  return minimatch(normalized, p, { dot: true }) ||
    (isDir && minimatch(normalized + '/', p, { dot: true }))
}

/**
 * Return the pattern plus a variant with the static prefix resolved through
 * symlinks, so canonical paths (e.g. /private/tmp when /tmp is a link) still
 * match the user's allowedPaths globs.
 */
export function globVariants(pattern: string): string[] {
  let variants = [pattern]
  if (!path.isAbsolute(pattern)) return variants
  let metaIdx = pattern.search(/[*?[\]{}]/)
  let staticPart = metaIdx === -1 ? pattern : pattern.slice(0, metaIdx)
  let rest = metaIdx === -1 ? '' : pattern.slice(metaIdx)
  let trimmed = staticPart.replace(/[\\/]+$/, '')
  let staticDir = trimmed === '' ? staticPart : path.dirname(trimmed)
  let base = trimmed === '' ? '' : path.basename(trimmed)
  let resolved = realFsPath(staticDir)
  if (resolved !== staticDir) {
    let joined = base ? path.join(resolved, base) : resolved
    if (rest) {
      // "dir/**" needs a separator, "secret*" does not
      let sepNeeded = metaIdx > 0 && /[\\/]/.test(pattern[metaIdx - 1])
      variants.push(joined + (sepNeeded ? '/' : '') + rest)
    } else {
      variants.push(joined)
    }
  }
  return variants
}

export function folderPaths(): string[] {
  try {
    return workspace.folderPaths
  } catch (_e) {
    return []
  }
}

/**
 * Validate that an uri/path is allowed by mcp.allowedPaths / mcp.deniedPaths.
 * Returns an error message when denied, null when allowed.
 *
 * Default policy when allowedPaths is empty:
 * - workspace roots and currently opened documents are always allowed;
 * - temporary directory is allowed for reads;
 * - anything else (including writes outside the workspace) is denied.
 */
export function checkPath(input: string, opts: { write?: boolean } = {}): string | null {
  let uri = toUri(input)
  let fsPath = URI.parse(uri).fsPath
  let config = workspace.getConfiguration('mcp')
  let denied = toArray<string>(config.get<string[]>('deniedPaths', []))
  // Authorize both the lexical path and the path the filesystem operations
  // will actually follow: a symlink inside the workspace must not escape the
  // boundary, and a second link path must not bypass deniedPaths.
  let realPath = realFsPath(fsPath)
  let paths = realPath === fsPath ? [fsPath] : [fsPath, realPath]
  for (let glob of denied) {
    if (glob && paths.some(p => globVariants(glob).some(g => globMatch(g, p)))) {
      return `Path is denied by mcp.deniedPaths: ${glob}`
    }
  }
  let allowed = toArray<string>(config.get<string[]>('allowedPaths', []))
  if (allowed.length > 0) {
    for (let p of paths) {
      let ok = allowed.some(glob => glob && globVariants(glob).some(g => globMatch(g, p)))
      if (!ok) return `Path is not allowed by mcp.allowedPaths: ${fsPath}`
    }
    return null
  }
  let roots = folderPaths()
  if (roots.length === 0) {
    try {
      roots = [workspace.root || process.cwd()]
    } catch (_e) {
      roots = [process.cwd()]
    }
  }
  let rootVariants: string[] = []
  for (let root of roots) {
    rootVariants.push(root)
    let resolved = realFsPath(root)
    if (resolved !== root) rootVariants.push(resolved)
  }
  let insideRoot = paths.every(p => rootVariants.some(root => isParentFolder(root, p, true)))
  if (insideRoot) return null
  if (workspace.getDocument(uri)) return null
  if (!opts.write) {
    let tmpdir = os.tmpdir()
    let tmpVariants = [tmpdir]
    let resolved = realFsPath(tmpdir)
    if (resolved !== tmpdir) tmpVariants.push(resolved)
    if (paths.every(p => tmpVariants.some(t => isParentFolder(t, p, true)))) return null
  }
  return `Path is outside the workspace and not opened: ${fsPath}`
}

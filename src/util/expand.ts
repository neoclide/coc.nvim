'use strict'
import { os, path } from './node'

export interface ExpandContext {
  root?: string
  file?: string
  cwd?: string
}

/**
 * Expand `${...}` placeholders in `input`. Variables that need a context
 * value not provided in `ctx` are left untouched (so callers downstream can
 * resolve them later).
 */
export function expandVariables(input: string, ctx: ExpandContext = {}): string {
  return input.replace(/\$\{(.*?)\}/g, (match: string, name: string) => {
    if (name.startsWith('env:')) {
      const key = name.slice(4)
      if (!key) return match
      return process.env[key] ?? match
    }
    switch (name) {
      case 'tmpdir':
        return os.tmpdir()
      case 'userHome':
        return os.homedir()
      case 'cwd':
        return ctx.cwd ?? process.cwd()
      case 'workspace':
      case 'workspaceRoot':
      case 'workspaceFolder':
        return ctx.root ?? match
      case 'workspaceFolderBasename':
        return ctx.root ? path.basename(ctx.root) : match
      case 'file':
        return ctx.file ?? match
      case 'fileDirname':
        return ctx.file ? path.dirname(ctx.file) : match
      case 'fileExtname':
        return ctx.file ? path.extname(ctx.file) : match
      case 'fileBasename':
        return ctx.file ? path.basename(ctx.file) : match
      case 'fileBasenameNoExtension': {
        if (!ctx.file) return match
        const base = path.basename(ctx.file)
        return base.slice(0, base.length - path.extname(base).length)
      }
      default:
        return match
    }
  })
}

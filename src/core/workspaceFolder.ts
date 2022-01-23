import fs from 'fs'
import path from 'path'
import { Emitter, Event, WorkspaceFolder, WorkspaceFoldersChangeEvent } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import Configurations from '../configuration'
import Document from '../model/document'
import { PatternType } from '../types'
import { distinct } from '../util/array'
import { isParentFolder, resolveRoot } from '../util/fs'

export default class WorkspaceFolderController {
  private _onDidChangeWorkspaceFolders = new Emitter<WorkspaceFoldersChangeEvent>()
  public readonly onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent> = this._onDidChangeWorkspaceFolders.event
  // filetype => patterns
  private rootPatterns: Map<string, string[]> = new Map()
  private _workspaceFolders: Set<string> = new Set()
  constructor(
    private readonly configurations: Configurations
  ) {
  }

  public setWorkspaceFolders(folders: string[] | undefined): void {
    if (!folders || !Array.isArray(folders)) return
    let dirs = folders.filter(fsPath => typeof fsPath === 'string' && fs.existsSync(fsPath))
    this._workspaceFolders.clear()
    dirs.forEach(f => {
      this._workspaceFolders.add(f)
    })
  }

  public getWorkspaceFolder(uri: URI): WorkspaceFolder | null {
    if (uri.scheme !== 'file') return null
    let folders = Array.from(this._workspaceFolders)
    folders.sort((a, b) => b.length - a.length)
    let fsPath = uri.fsPath
    let folder = folders.find(f => isParentFolder(f, fsPath, true))
    return folder ? {
      name: path.dirname(folder),
      uri: URI.file(folder).toString()
    } : null
  }

  public get workspaceFolders(): WorkspaceFolder[] {
    let res: WorkspaceFolder[] = []
    for (let folder of this._workspaceFolders) {
      res.push({ name: path.dirname(folder), uri: URI.file(folder).toString() })
    }
    return res
  }

  public addRootPattern(filetype: string, rootPatterns: string[]): void {
    let patterns = this.rootPatterns.get(filetype) || []
    for (let p of rootPatterns) {
      if (!patterns.includes(p)) {
        patterns.push(p)
      }
    }
    this.rootPatterns.set(filetype, patterns)
  }

  public resolveRoot(document: Document, cwd: string, fireEvent: boolean, expand: ((input: string) => string)): string | null {
    if (document.buftype !== '' || document.schema !== 'file' || !document.enabled) return null
    let types = [PatternType.Buffer, PatternType.LanguageServer, PatternType.Global]
    let u = URI.parse(document.uri)
    let dir = path.dirname(u.fsPath)
    let config = this.configurations.getConfiguration('workspace', document.uri)
    let ignoredFiletypes = config.get<string[]>('ignoredFiletypes', [])
    let bottomUpFileTypes = config.get<string[]>('bottomUpFiletypes', [])
    let checkCwd = config.get<boolean>('workspaceFolderCheckCwd', true)
    let ignored = config.get<string[]>('ignoredFolders', [])
    let fallbackCwd = config.get<boolean>('workspaceFolderFallbackCwd', true)
    if (ignoredFiletypes?.includes(document.filetype)) return null
    let curr = this.getWorkspaceFolder(URI.parse(document.uri))
    if (curr) return URI.parse(curr.uri).fsPath
    ignored = Array.isArray(ignored) ? ignored.map(s => expand(s)) : []
    let res: string | null = null
    for (let patternType of types) {
      let patterns = this.getRootPatterns(document, patternType)
      if (patterns && patterns.length) {
        let isBottomUp = bottomUpFileTypes.includes(document.filetype)
        let root = resolveRoot(dir, patterns, cwd, isBottomUp, checkCwd, ignored)
        if (root) {
          res = root
          break
        }
      }
    }
    if (fallbackCwd && !res && !ignored.includes(cwd) && isParentFolder(cwd, dir, true)) {
      res = cwd
    }
    if (res) this.addWorkspaceFolder(res, fireEvent)
    return res
  }

  public addWorkspaceFolder(folder: string, fireEvent: boolean): WorkspaceFolder {
    let uri = URI.file(folder).toString()
    let workspaceFolder: WorkspaceFolder = { uri, name: path.basename(folder) }
    if (!this._workspaceFolders.has(folder)) {
      this._workspaceFolders.add(folder)
      if (fireEvent) {
        this._onDidChangeWorkspaceFolders.fire({
          added: [workspaceFolder],
          removed: []
        })
      }
    }
    return workspaceFolder
  }

  public renameWorkspaceFolder(oldPath: string, newPath: string): void {
    let idx = this.workspaceFolders.findIndex(f => URI.parse(f.uri).fsPath == oldPath)
    if (idx == -1) return
    let removed = this.workspaceFolders[idx]
    let added: WorkspaceFolder = {
      uri: URI.file(newPath).toString(),
      name: path.dirname(newPath)
    }
    this._workspaceFolders.delete(oldPath)
    this._workspaceFolders.add(newPath)
    this._onDidChangeWorkspaceFolders.fire({
      removed: [removed],
      added: [added]
    })
  }

  public removeWorkspaceFolder(fsPath: string): void {
    if (!this._workspaceFolders.has(fsPath)) return
    this._workspaceFolders.delete(fsPath)
    this._onDidChangeWorkspaceFolders.fire({
      removed: [{
        uri: URI.file(fsPath).toString(),
        name: path.dirname(fsPath)
      }],
      added: []
    })
  }

  public getRootPatterns(document: Document, patternType: PatternType): string[] {
    let { uri } = document
    if (patternType == PatternType.Buffer) return document.getVar('root_patterns', []) || []
    if (patternType == PatternType.LanguageServer) return this.getServerRootPatterns(document.languageId)
    const preferences = this.configurations.getConfiguration('coc.preferences', uri)
    return preferences.get<string[]>('rootPatterns', ['.git', '.hg', '.projections.json']).slice()
  }

  public reset(): void {
    this.rootPatterns.clear()
    this._workspaceFolders.clear()
  }

  /**
   * Get rootPatterns of filetype by languageserver configuration and extension configuration.
   */
  private getServerRootPatterns(filetype: string): string[] {
    let lspConfig = this.configurations.getConfiguration().get<{ [key: string]: unknown }>('languageserver', {})
    let patterns: string[] = []
    for (let key of Object.keys(lspConfig)) {
      let config: any = lspConfig[key]
      let { filetypes, rootPatterns } = config
      if (Array.isArray(filetypes) && rootPatterns && filetypes.includes(filetype)) {
        patterns.push(...rootPatterns)
      }
    }
    patterns = patterns.concat(this.rootPatterns.get(filetype) || [])
    return patterns.length ? distinct(patterns) : []
  }
}

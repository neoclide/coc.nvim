'use strict'
import type { WorkspaceFoldersChangeEvent } from 'vscode-languageserver-protocol'
import { WorkspaceFolder } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import Configurations from '../configuration'
import events from '../events'
import { createLogger } from '../logger'
import Document from '../model/document'
import { getConditionValue } from '../util'
import { distinct, isFalsyOrEmpty, toArray } from '../util/array'
import { isCancellationError } from '../util/errors'
import { Extensions as ExtensionsInfo, IExtensionRegistry } from '../util/extensionRegistry'
import { checkFolder, isFolderIgnored, isParentFolder, resolveRoot } from '../util/fs'
import { path } from '../util/node'
import { toObject } from '../util/object'
import { CancellationToken, CancellationTokenSource, Emitter, Event } from '../util/protocol'
import { Registry } from '../util/registry'

export enum PatternType {
  Buffer,
  LanguageServer,
  Global,
}

const logger = createLogger('core-workspaceFolder')
const PatternTypes = [PatternType.Buffer, PatternType.LanguageServer, PatternType.Global]
const checkPatternTimeout = getConditionValue(5000, 50)

function toWorkspaceFolder(fsPath: string): WorkspaceFolder | undefined {
  if (!fsPath || !path.isAbsolute(fsPath)) return undefined
  return {
    name: path.basename(fsPath),
    uri: URI.file(fsPath).toString()
  }
}

const extensionRegistry = Registry.as<IExtensionRegistry>(ExtensionsInfo.ExtensionContribution)

interface WorkspaceConfig {
  readonly ignoredFiletypes: string[]
  readonly bottomUpFiletypes: string[]
  readonly ignoredFolders: string[]
  readonly workspaceFolderCheckCwd: boolean
  readonly workspaceFolderFallbackCwd: boolean
  rootPatterns: string[]
}

export default class WorkspaceFolderController {
  public config: WorkspaceConfig
  private _onDidChangeWorkspaceFolders = new Emitter<WorkspaceFoldersChangeEvent>()
  public readonly onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent> = this._onDidChangeWorkspaceFolders.event
  // filetype => patterns
  private rootPatterns: Map<string, string[]> = new Map()
  private _workspaceFolders: WorkspaceFolder[] = []
  private _tokenSources: Set<CancellationTokenSource> = new Set()
  constructor(private configurations: Configurations) {
    events.on('VimLeavePre', this.cancelAll, this)
    this.updateConfiguration(true)
    this.configurations.onDidChange(e => {
      if (e.affectsConfiguration('workspace') || e.affectsConfiguration('coc.preferences')) {
        this.updateConfiguration(false)
      }
    })
  }

  private updateConfiguration(init: boolean): void {
    const allConfig = this.configurations.initialConfiguration
    let config = allConfig.get<WorkspaceConfig>('workspace')
    let oldConfig = allConfig.get<string[] | null>('coc.preferences.rootPatterns')
    this.config = {
      rootPatterns: isFalsyOrEmpty(oldConfig) ? toArray(config.rootPatterns) : oldConfig,
      ignoredFiletypes: toArray(config.ignoredFiletypes),
      bottomUpFiletypes: toArray(config.bottomUpFiletypes),
      ignoredFolders: toArray(config.ignoredFolders),
      workspaceFolderCheckCwd: !!config.workspaceFolderCheckCwd,
      workspaceFolderFallbackCwd: !!config.workspaceFolderFallbackCwd
    }
    if (init) {
      const lspConfig = allConfig.get<Record<string, unknown>>('languageserver', {})
      this.addServerRootPatterns(lspConfig)
    }
  }

  public addServerRootPatterns(lspConfig: Record<string, unknown> | undefined): void {
    for (let key of Object.keys(toObject(lspConfig))) {
      let config = lspConfig[key] as any
      let { filetypes, rootPatterns } = config
      if (Array.isArray(filetypes) && !isFalsyOrEmpty(rootPatterns)) {
        filetypes.filter(s => typeof s === 'string').forEach(filetype => {
          this.addRootPattern(filetype, rootPatterns)
        })
      }
    }
  }

  public cancelAll(): void {
    for (let tokenSource of this._tokenSources) {
      tokenSource.cancel()
    }
  }

  public setWorkspaceFolders(folders: string[] | undefined): void {
    if (!folders || !Array.isArray(folders)) return
    let arr = folders.map(f => toWorkspaceFolder(f))
    this._workspaceFolders = arr.filter(o => o != null)
  }

  public getWorkspaceFolder(uri: URI): WorkspaceFolder | undefined {
    if (uri.scheme !== 'file') return undefined
    let folders = Array.from(this._workspaceFolders).map(o => URI.parse(o.uri).fsPath)
    folders.sort((a, b) => b.length - a.length)
    let fsPath = uri.fsPath
    let folder = folders.find(f => isParentFolder(f, fsPath, true))
    return toWorkspaceFolder(folder)
  }

  public getRelativePath(pathOrUri: string | URI, includeWorkspace?: boolean): string {
    let resource: URI | undefined
    let p = ''
    if (typeof pathOrUri === 'string') {
      resource = URI.file(pathOrUri)
      p = pathOrUri
    } else if (typeof pathOrUri !== 'undefined') {
      resource = pathOrUri
      p = pathOrUri.fsPath
    }
    if (!resource) return p
    const folder = this.getWorkspaceFolder(resource)
    if (!folder) return p
    if (typeof includeWorkspace === 'undefined' && this._workspaceFolders) {
      includeWorkspace = this._workspaceFolders.length > 1
    }
    let result = path.relative(URI.parse(folder.uri).fsPath, resource.fsPath)
    result = result == '' ? resource.fsPath : result
    if (includeWorkspace && folder.name) {
      result = `${folder.name}/${result}`
    }
    return result!
  }

  public get workspaceFolders(): ReadonlyArray<WorkspaceFolder> {
    return this._workspaceFolders
  }

  public addRootPattern(filetype: string, rootPatterns: string[]): void {
    let patterns = this.rootPatterns.get(filetype) ?? []
    for (let p of rootPatterns) {
      if (!patterns.includes(p)) {
        patterns.push(p)
      }
    }
    this.rootPatterns.set(filetype, patterns)
  }

  public resolveRoot(document: Document, cwd: string, fireEvent: boolean, expand: ((input: string) => string)): string | null {
    if (document.buftype !== '' || document.schema !== 'file') return null
    let u = URI.parse(document.uri)
    let curr = this.getWorkspaceFolder(u)
    if (curr) return URI.parse(curr.uri).fsPath
    let dir = path.dirname(u.fsPath)
    let { ignoredFiletypes, ignoredFolders, workspaceFolderCheckCwd, workspaceFolderFallbackCwd, bottomUpFiletypes } = this.config
    if (ignoredFiletypes?.includes(document.filetype)) return null
    ignoredFolders = Array.isArray(ignoredFolders) ? ignoredFolders.filter(s => s && s.length > 0).map(s => expand(s)) : []
    let res: string | null = null
    for (let patternType of PatternTypes) {
      let patterns = this.getRootPatterns(document, patternType)
      if (patterns && patterns.length) {
        let isBottomUp = bottomUpFiletypes.includes('*') || bottomUpFiletypes.includes(document.filetype)
        let root = resolveRoot(dir, patterns, cwd, isBottomUp, workspaceFolderCheckCwd, ignoredFolders)
        if (root) {
          res = root
          break
        }
      }
    }
    if (!res && workspaceFolderFallbackCwd && !isFolderIgnored(cwd, ignoredFolders) && isParentFolder(cwd, dir, true)) {
      res = cwd
    }
    if (res) this.addWorkspaceFolder(res, fireEvent)
    return res
  }

  public addWorkspaceFolder(folder: string, fireEvent: boolean): WorkspaceFolder | undefined {
    let workspaceFolder: WorkspaceFolder = toWorkspaceFolder(folder)
    if (!workspaceFolder) return undefined
    if (this._workspaceFolders.findIndex(o => o.uri == workspaceFolder.uri) == -1) {
      this._workspaceFolders.push(workspaceFolder)
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
    let added: WorkspaceFolder = toWorkspaceFolder(newPath)
    if (!added) return
    let idx = this._workspaceFolders.findIndex(f => URI.parse(f.uri).fsPath == oldPath)
    if (idx == -1) return
    let removed = this.workspaceFolders[idx]
    this._workspaceFolders.splice(idx, 1, added)
    this._onDidChangeWorkspaceFolders.fire({
      removed: [removed],
      added: [added]
    })
  }

  public removeWorkspaceFolder(fsPath: string): void {
    let removed = toWorkspaceFolder(fsPath)
    if (!removed) return
    let idx = this._workspaceFolders.findIndex(f => f.uri == removed.uri)
    if (idx == -1) return
    this._workspaceFolders.splice(idx, 1)
    this._onDidChangeWorkspaceFolders.fire({
      removed: [removed],
      added: []
    })
  }

  public getRootPatterns(document: Document, patternType: PatternType): ReadonlyArray<string> {
    if (patternType == PatternType.Buffer) return document.getVar('root_patterns', []) || []
    if (patternType == PatternType.LanguageServer) return this.getServerRootPatterns(document.languageId)
    return this.config.rootPatterns
  }

  public reset(): void {
    this.rootPatterns.clear()
    this._workspaceFolders = []
  }

  /**
   * Get rootPatterns of filetype by languageserver configuration and extension configuration.
   */
  public getServerRootPatterns(filetype: string): string[] {
    let patterns = extensionRegistry.getRootPatternsByFiletype(filetype)
    patterns = patterns.concat(toArray(this.rootPatterns.get(filetype)))
    return distinct(patterns)
  }

  public checkFolder(dir: string, patterns: string[], token?: CancellationToken): Promise<boolean> {
    return checkFolder(dir, patterns, token)
  }

  public async checkPatterns(folders: ReadonlyArray<WorkspaceFolder>, patterns: string[]): Promise<boolean> {
    if (isFalsyOrEmpty(folders)) return false
    let dirs = folders.map(f => URI.parse(f.uri).fsPath)
    let find = false
    let tokenSource = new CancellationTokenSource()
    this._tokenSources.add(tokenSource)
    let token = tokenSource.token
    let timer = setTimeout(() => {
      tokenSource.cancel()
    }, checkPatternTimeout)
    let results = await Promise.allSettled(dirs.map(dir => {
      return this.checkFolder(dir, patterns, token).then(checked => {
        this._tokenSources.delete(tokenSource)
        if (checked) {
          find = true
          clearTimeout(timer)
          tokenSource.cancel()
        }
      })
    }))
    clearTimeout(timer)
    results.forEach(res => {
      if (res.status === 'rejected' && !isCancellationError(res.reason)) {
        logger.error(`checkPatterns error:`, patterns, res.reason)
      }
    })
    return find
  }
}

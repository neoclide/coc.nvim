'use strict'
import type { Minimatch } from 'minimatch'
import type { ClientCapabilities, Disposable, FileOperationPatternKind, ServerCapabilities } from 'vscode-languageserver-protocol'
import type { RenameEvent } from '../core/fileSystemWatcher'
import type { FileRenameEvent } from '../core/files'
import { disposeAll } from '../util'
import { FileType, getFileType } from '../util/fs'
import { minimatch } from '../util/node'
import { DidRenameFilesNotification } from '../util/protocol'
import workspace from '../workspace'
import { FeatureClient, StaticFeature } from './features'
import type { FileOperationsMiddleware } from './fileOperations'

export class FileRenameFeature implements StaticFeature {
  public readonly method = DidRenameFilesNotification.method
  private _disposables: Disposable[] = []
  private _lastRename: RenameEvent | undefined
  private _filters: { scheme?: string, matcher: Minimatch, kind?: FileOperationPatternKind }[] = []

  constructor(private readonly _client: FeatureClient<{ workspace?: FileOperationsMiddleware }>) {
  }

  public fillClientCapabilities(_capabilities: ClientCapabilities): void {
  }

  public initialize(capabilities: ServerCapabilities): void {
    const options = capabilities.workspace?.fileOperations?.didRename
    if (!options?.filters.length) return
    try {
      this._filters = options.filters.map(filter => {
        const matcher = new minimatch.Minimatch(filter.pattern.glob, {
          dot: true,
          nocase: filter.pattern.options?.ignoreCase === true
        })
        if (!matcher.makeRe()) throw new Error(`Invalid pattern ${filter.pattern.glob}!`)
        return { scheme: filter.scheme, matcher, kind: filter.pattern.matches }
      })
    } catch (error) {
      this._client.warn(`Ignoring invalid glob pattern for external rename notifications: ${error}`)
      return
    }
    const watcher = workspace.createFileSystemWatcher('**/*', {
      ignoreCreateEvents: true,
      ignoreChangeEvents: true,
      ignoreDeleteEvents: true,
      includeDirectories: true
    })
    this._disposables.push(watcher)
    workspace.onWillRenameFiles(event => {
      this._lastRename = event.files[0]
    }, null, this._disposables)
    watcher.onDidRename(file => {
      const lastRename = this._lastRename
      if (lastRename?.oldUri.toString() === file.oldUri.toString()
        && lastRename.newUri.toString() === file.newUri.toString()) {
        // Consume the duplicate so a later external rename of the same pair is sent.
        this._lastRename = undefined
        return
      }
      void this.send(file).catch(error => {
        this._client.error(`Sending notification ${this.method} failed`, error)
      })
    }, null, this._disposables)
  }

  public async send(file: RenameEvent): Promise<void> {
    const filters = this._filters
    const path = file.oldUri.fsPath.replace(/\\/g, '/')
    let matches = false
    for (const filter of filters) {
      if (filter.scheme !== undefined && filter.scheme !== file.oldUri.scheme) continue
      const pathMatches = filter.matcher.match(path)
      if (!pathMatches && !(filter.kind === 'folder' && filter.matcher.match(`${path}/`))) continue
      if (filter.kind === undefined) {
        matches = true
        break
      }
      // The old path no longer exists after a rename.
      const type = await getFileType(file.newUri.fsPath)
      if (type === undefined && pathMatches) {
        this._client.error(`Failed to determine file type for ${file.newUri.toString()}.`)
        matches = true
      } else {
        matches = filter.kind === 'file' && type === FileType.File
          || filter.kind === 'folder' && type === FileType.Directory
      }
      if (matches) break
    }
    if (!matches || this._filters !== filters) return
    const event: FileRenameEvent = { files: [file] }
    const next = (event: FileRenameEvent): Promise<void> => {
      // Type checks or middleware may finish after this feature was disposed.
      if (this._filters !== filters) return Promise.resolve()
      return this._client.sendNotification(DidRenameFilesNotification.type,
        this._client.code2ProtocolConverter.asDidRenameFilesParams(event))
    }
    const middleware = this._client.middleware.workspace?.didRenameFiles
    await (middleware ? middleware(event, next) : next(event))
  }

  public dispose(): void {
    disposeAll(this._disposables)
    this._lastRename = undefined
    this._filters = []
  }
}

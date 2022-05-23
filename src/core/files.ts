'use strict'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs-extra'
import glob from 'glob'
import minimatch from 'minimatch'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { v4 as uuid } from 'uuid'
import { CancellationToken, CancellationTokenSource, CreateFile, CreateFileOptions, DeleteFile, DeleteFileOptions, Emitter, Event, Location, Position, RenameFile, RenameFileOptions, TextDocumentEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import Configurations from '../configuration'
import Document from '../model/document'
import RelativePattern from '../model/relativePattern'
import { DocumentChange, Env, FileCreateEvent, FileDeleteEvent, FileRenameEvent, FileWillCreateEvent, FileWillDeleteEvent, FileWillRenameEvent } from '../types'
import { wait } from '../util'
import * as errors from '../util/errors'
import { fixDriver, isFile, isParentFolder, statAsync } from '../util/fs'
import { byteLength } from '../util/string'
import Documents from './documents'
import * as ui from './ui'
import WorkspaceFolderController from './workspaceFolder'
import events from '../events'

export type GlobPattern = string | RelativePattern
export type RecoverFunc = () => Promise<any>

interface WaitUntilEvent {
  waitUntil(thenable: Thenable<WorkspaceEdit | any>): void
}

const logger = require('../util/logger')('core-files')

export default class Files {
  private nvim: Neovim
  private env: Env
  private operationTimeout = 500
  private _onDidCreateFiles = new Emitter<FileCreateEvent>()
  private _onDidRenameFiles = new Emitter<FileRenameEvent>()
  private _onDidDeleteFiles = new Emitter<FileDeleteEvent>()
  private _onWillCreateFiles = new Emitter<FileWillCreateEvent>()
  private _onWillRenameFiles = new Emitter<FileWillRenameEvent>()
  private _onWillDeleteFiles = new Emitter<FileWillDeleteEvent>()

  public readonly onDidCreateFiles: Event<FileCreateEvent> = this._onDidCreateFiles.event
  public readonly onDidRenameFiles: Event<FileRenameEvent> = this._onDidRenameFiles.event
  public readonly onDidDeleteFiles: Event<FileDeleteEvent> = this._onDidDeleteFiles.event
  public readonly onWillCreateFiles: Event<FileWillCreateEvent> = this._onWillCreateFiles.event
  public readonly onWillRenameFiles: Event<FileWillRenameEvent> = this._onWillRenameFiles.event
  public readonly onWillDeleteFiles: Event<FileWillDeleteEvent> = this._onWillDeleteFiles.event
  constructor(
    private documents: Documents,
    private configurations: Configurations,
    private workspaceFolderControl: WorkspaceFolderController
  ) {
  }

  public attach(nvim: Neovim, env: Env): void {
    this.nvim = nvim
    this.env = env
  }

  public async openTextDocument(uri: URI | string): Promise<Document> {
    uri = typeof uri === 'string' ? URI.file(uri) : uri
    let doc = this.documents.getDocument(uri.toString())
    if (doc) {
      await this.jumpTo(uri.toString(), null, 'drop')
      return doc
    }
    const scheme = uri.scheme
    if (scheme == 'file') {
      if (!fs.existsSync(uri.fsPath)) throw errors.fileNotExists(uri.fsPath)
      fs.accessSync(uri.fsPath, fs.constants.R_OK)
    }
    if (scheme == 'untitled') {
      await this.nvim.call('coc#util#open_file', ['tab drop', uri.path])
      return await this.documents.document
    }
    doc = await this.loadResource(uri.toString())
    if (doc) await this.jumpTo(doc.uri)
    return doc
  }

  public async jumpTo(uri: string, position?: Position | null, openCommand?: string): Promise<void> {
    const preferences = this.configurations.getConfiguration('coc.preferences')
    let jumpCommand = openCommand || preferences.get<string>('jumpCommand', 'edit')
    let { nvim } = this
    let doc = this.documents.getDocument(uri)
    let bufnr = doc ? doc.bufnr : -1
    if (bufnr != -1 && jumpCommand == 'edit') {
      // use buffer command since edit command would reload the buffer
      nvim.pauseNotification()
      nvim.command(`silent! normal! m'`, true)
      nvim.command(`buffer ${bufnr}`, true)
      nvim.command(`if &filetype ==# '' | filetype detect | endif`, true)
      if (position) {
        let line = doc.getline(position.line)
        let col = byteLength(line.slice(0, position.character)) + 1
        nvim.call('cursor', [position.line + 1, col], true)
      }
      await nvim.resumeNotification(true)
    } else {
      let { fsPath, scheme } = URI.parse(uri)
      let pos = position == null ? null : [position.line, position.character]
      if (scheme == 'file') {
        let bufname = fixDriver(path.normalize(fsPath))
        await this.nvim.call('coc#util#jump', [jumpCommand, bufname, pos])
      } else {
        if (os.platform() == 'win32') {
          uri = uri.replace(/\/?/, '?')
        }
        await this.nvim.call('coc#util#jump', [jumpCommand, uri, pos])
      }
    }
  }

  /**
   * Open resource by uri
   */
  public async openResource(uri: string): Promise<void> {
    let { nvim } = this
    let u = URI.parse(uri)
    if (/^https?/.test(u.scheme)) {
      await nvim.call('coc#ui#open_url', uri)
      return
    }
    let wildignore = await nvim.getOption('wildignore')
    await nvim.setOption('wildignore', '')
    await this.jumpTo(uri)
    await nvim.setOption('wildignore', wildignore)
  }

  /**
   * Load uri as document.
   */
  public async loadResource(uri: string): Promise<Document> {
    let u = URI.parse(uri)
    let bufname = u.scheme === 'file' ? u.fsPath : uri
    let bufnr = await this.nvim.call('coc#util#open_file', ['tab drop', bufname])
    let doc = this.documents.getDocument(bufnr)
    if (doc) return doc
    return await this.documents.createDocument(bufnr)
  }

  /**
   * Load the files that not loaded
   */
  public async loadResources(uris: string[]): Promise<(Document | undefined)[]> {
    let { documents } = this
    let files = uris.map(uri => {
      let u = URI.parse(uri)
      return u.scheme == 'file' ? u.fsPath : uri
    })
    let bufnrs = await this.nvim.call('coc#ui#open_files', [files]) as number[]
    return await Promise.all(bufnrs.map(bufnr => {
      return documents.createDocument(bufnr)
    }))
  }

  /**
   * Create a file in vim and disk
   */
  public async createFile(filepath: string, opts: CreateFileOptions = {}, recovers?: RecoverFunc[]): Promise<void> {
    let { nvim } = this
    let exists = fs.existsSync(filepath)
    if (exists && !opts.overwrite && !opts.ignoreIfExists) {
      throw errors.fileExists(filepath)
    }
    if (!exists || opts.overwrite) {
      let tokenSource = new CancellationTokenSource()
      await this.fireWaitUntilEvent(this._onWillCreateFiles, {
        files: [URI.file(filepath)],
        token: tokenSource.token
      }, recovers)
      tokenSource.cancel()
      let dir = path.dirname(filepath)
      if (!fs.existsSync(dir)) {
        let folder: string
        let curr = dir
        while (!['.', '/', path.parse(dir).root].includes(curr)) {
          if (fs.existsSync(path.dirname(curr))) {
            folder = curr
            break
          }
          curr = path.dirname(curr)
        }
        await fs.mkdirp(dir)
        recovers && recovers.push(async () => {
          if (fs.existsSync(folder)) {
            await fs.remove(folder)
          }
        })
      }
      fs.writeFileSync(filepath, '', 'utf8')
      recovers && recovers.push(async () => {
        if (fs.existsSync(filepath)) {
          await fs.unlink(filepath)
        }
      })
      let doc = await this.loadResource(filepath)
      let bufnr = doc.bufnr
      recovers && recovers.push(() => {
        void events.fire('BufUnload', [bufnr])
        return nvim.command(`silent! bd! ${bufnr}`)
      })
      this._onDidCreateFiles.fire({ files: [URI.file(filepath)] })
    }
  }

  /**
   * Delete a file or folder from vim and disk.
   */
  public async deleteFile(filepath: string, opts: DeleteFileOptions = {}, recovers?: RecoverFunc[]): Promise<void> {
    let { ignoreIfNotExists, recursive } = opts
    let stat = await statAsync(filepath)
    let isDir = stat && stat.isDirectory()
    if (!stat && !ignoreIfNotExists) {
      throw errors.fileNotExists(filepath)
    }
    if (stat == null) return
    let uri = URI.file(filepath)
    await this.fireWaitUntilEvent(this._onWillDeleteFiles, { files: [uri] }, recovers)
    if (!isDir) {
      let bufnr = await this.nvim.call('bufnr', [filepath])
      if (bufnr) {
        void events.fire('BufUnload', [bufnr])
        await this.nvim.command(`silent! bwipeout ${bufnr}`)
        recovers && recovers.push(() => {
          return this.loadResource(uri.toString())
        })
      }
    }
    if (isDir && recursive) {
      // copy files for recover
      let folder = path.join(os.tmpdir(), 'coc-' + uuid())
      await fs.mkdir(folder)
      await fs.copy(filepath, folder, { recursive: true })
      await fs.remove(filepath)
      recovers && recovers.push(async () => {
        await fs.mkdir(filepath)
        await fs.copy(folder, filepath, { recursive: true })
        await fs.remove(folder)
      })
    } else if (isDir) {
      await fs.rmdir(filepath)
      recovers && recovers.push(() => {
        return fs.mkdir(filepath)
      })
    } else {
      let dest = path.join(os.tmpdir(), 'coc-' + uuid())
      await fs.copyFile(filepath, dest)
      await fs.unlink(filepath)
      recovers && recovers.push(() => {
        return fs.move(dest, filepath, { overwrite: true })
      })
    }
    this._onDidDeleteFiles.fire({ files: [uri] })
  }

  /**
   * Rename a file or folder on vim and disk
   */
  public async renameFile(oldPath: string, newPath: string, opts: RenameFileOptions & { skipEvent?: boolean } = {}, recovers?: RecoverFunc[]): Promise<void> {
    let { nvim } = this
    let { overwrite, ignoreIfExists } = opts
    if (newPath === oldPath) return
    let exists = fs.existsSync(newPath)
    if (exists && ignoreIfExists && !overwrite) return
    if (exists && !overwrite) throw errors.fileExists(newPath)
    let oldStat = await statAsync(oldPath)
    let loaded = (oldStat && oldStat.isDirectory()) ? 0 : await nvim.call('bufloaded', [oldPath])
    if (!loaded && !oldStat) throw errors.fileNotExists(oldPath)
    let file = { newUri: URI.parse(newPath), oldUri: URI.parse(oldPath) }
    if (!opts.skipEvent) await this.fireWaitUntilEvent(this._onWillRenameFiles, { files: [file] }, recovers)
    if (loaded) {
      let bufnr = await nvim.call('coc#ui#rename_file', [oldPath, newPath, oldStat != null])
      await this.documents.onBufCreate(bufnr)
    } else {
      if (oldStat?.isDirectory()) {
        for (let doc of this.documents.documents) {
          let u = URI.parse(doc.uri)
          if (u.scheme === 'file' && isParentFolder(oldPath, u.fsPath, false)) {
            let filepath = u.fsPath.replace(oldPath, newPath)
            let bufnr = await nvim.call('coc#ui#rename_file', [u.fsPath, filepath, false])
            await this.documents.onBufCreate(bufnr)
          }
        }
      }
      fs.renameSync(oldPath, newPath)
    }
    if (recovers) {
      recovers.push(() => {
        return this.renameFile(newPath, oldPath, { skipEvent: true })
      })
    }
    if (!opts.skipEvent) this._onDidRenameFiles.fire({ files: [file] })
  }

  public async renameCurrent(): Promise<void> {
    let { nvim } = this
    let oldPath = await nvim.call('expand', ['%:p'])
    // await nvim.callAsync()
    let newPath = await nvim.callAsync('coc#util#with_callback', ['input', ['New path: ', oldPath, 'file']])
    newPath = newPath ? newPath.trim() : null
    if (newPath === oldPath || !newPath) return
    if (oldPath.toLowerCase() != newPath.toLowerCase() && fs.existsSync(newPath)) {
      let overwrite = await ui.showPrompt(this.nvim, `${newPath} exists, overwrite?`)
      if (!overwrite) return
    }
    await this.renameFile(oldPath, newPath, { overwrite: true })
  }

  private async currentUri(): Promise<string> {
    let bufnr = await this.nvim.call('bufnr', ['%'])
    let document = this.documents.getDocument(bufnr)
    return document ? document.uri : null
  }

  /**
   * Apply WorkspaceEdit.
   */
  public async applyEdit(edit: WorkspaceEdit, recovers?: RecoverFunc[]): Promise<boolean> {
    let { nvim, documents, configurations } = this
    let { documentChanges, changes } = edit
    let uri = await this.currentUri()
    let currentChanged = false
    let locations: Location[] = []
    let changeCount = 0
    const preferences = configurations.getConfiguration('coc.preferences')
    let promptUser = !global.__TEST__ && preferences.get<boolean>('promptWorkspaceEdit', true)
    let listTarget = preferences.get<string>('listOfWorkspaceEdit', 'quickfix')
    try {
      if (documentChanges && documentChanges.length) {
        let changedUris = this.getChangedUris(documentChanges)
        changeCount = changedUris.length
        if (promptUser) {
          let diskCount = changedUris.reduce((p, c) => {
            return p + (documents.getDocument(c) == null ? 1 : 0)
          }, 0)
          if (diskCount) {
            let res = await ui.showPrompt(this.nvim, `${diskCount} documents on disk would be loaded for change, confirm?`)
            if (!res) return
          }
        }
        let changedMap: Map<string, string> = new Map()
        for (const change of documentChanges) {
          if (TextDocumentEdit.is(change)) {
            let { textDocument, edits } = change
            let doc = await this.loadResource(textDocument.uri)
            let current = textDocument.uri === uri
            if (current) currentChanged = true
            await doc.applyEdits(edits, false, current)
            for (let edit of edits) {
              locations.push({ uri: doc.uri, range: edit.range })
            }
          } else if (CreateFile.is(change)) {
            let file = URI.parse(change.uri).fsPath
            await this.createFile(file, change.options)
          } else if (RenameFile.is(change)) {
            changedMap.set(change.oldUri, change.newUri)
            await this.renameFile(URI.parse(change.oldUri).fsPath, URI.parse(change.newUri).fsPath, change.options)
          } else if (DeleteFile.is(change)) {
            await this.deleteFile(URI.parse(change.uri).fsPath, change.options)
          }
        }
        // fix location uris on renameFile
        if (changedMap.size) {
          locations.forEach(location => {
            let newUri = changedMap.get(location.uri)
            if (newUri) location.uri = newUri
          })
        }
      } else if (changes) {
        let uris = Object.keys(changes)
        let unloaded = uris.filter(uri => documents.getDocument(uri) == null)
        if (unloaded.length) {
          if (promptUser) {
            let res = await ui.showPrompt(this.nvim, `${unloaded.length} documents on disk would be loaded for change, confirm?`)
            if (!res) return
          }
          await this.loadResources(unloaded)
        }
        for (let uri of Object.keys(changes)) {
          let document = documents.getDocument(uri)
          let current = URI.parse(uri).toString() === uri
          if (current) currentChanged = true
          let edits = changes[uri]
          for (let edit of edits) {
            locations.push({ uri: document.uri, range: edit.range })
          }
          await document.applyEdits(edits, false, current)
        }
        changeCount = uris.length
      }
      if (currentChanged) this.nvim.redrawVim()
      if (locations.length) {
        let items = await this.documents.getQuickfixList(locations)
        let silent = locations.every(l => l.uri == uri)
        if (listTarget == 'quickfix') {
          await this.nvim.call('setqflist', [items])
          if (!silent) ui.showMessage(this.nvim, `changed ${changeCount} buffers, use :wa to save changes to disk and :copen to open quickfix list`, 'MoreMsg')
        } else if (listTarget == 'location') {
          await nvim.setVar('coc_jump_locations', items)
          if (!silent) ui.showMessage(this.nvim, `changed ${changeCount} buffers, use :wa to save changes to disk and :CocList location to manage changed locations`, 'MoreMsg')
        }
      }
    } catch (e) {
      logger.error('Error on applyEdits:', edit, e)
      ui.showMessage(this.nvim, `Error on applyEdits: ${e}`, 'Error')
      return false
    }
    await wait(50)
    return true
  }

  public getChangedUris(documentChanges: DocumentChange[] | null): string[] {
    let { documents } = this
    let uris: Set<string> = new Set()
    let createUris: Set<string> = new Set()
    for (let change of documentChanges) {
      if (TextDocumentEdit.is(change)) {
        let { textDocument } = change
        let { uri, version } = textDocument
        uris.add(uri)
        if (typeof version === 'number' && version > 0) {
          let doc = documents.getDocument(uri)
          if (!doc) throw new Error(`${uri} not loaded`)
          if (doc.version != version) {
            throw new Error(`${uri} changed before apply edit`)
          }
        }
      } else if (CreateFile.is(change) || DeleteFile.is(change)) {
        if (!isFile(change.uri)) {
          throw new Error(`change of scheme ${change.uri} not supported`)
        }
        createUris.add(change.uri)
        uris.add(change.uri)
      } else if (RenameFile.is(change)) {
        if (!isFile(change.oldUri) || !isFile(change.newUri)) {
          throw new Error(`change of scheme ${change.oldUri} not supported`)
        }
        let newFile = URI.parse(change.newUri).fsPath
        if (fs.existsSync(newFile)) {
          throw new Error(`file "${newFile}" already exists for rename`)
        }
        uris.add(change.oldUri)
      } else {
        throw new Error(`Invalid document change: ${JSON.stringify(change, null, 2)}`)
      }
    }
    return Array.from(uris)
  }

  public async findFiles(include: GlobPattern, exclude?: GlobPattern | null, maxResults?: number, token?: CancellationToken): Promise<URI[]> {
    let folders = this.workspaceFolderControl.workspaceFolders
    if (token?.isCancellationRequested || !folders.length || maxResults === 0) return []
    maxResults = maxResults ?? Infinity
    let roots = folders.map(o => URI.parse(o.uri).fsPath)
    if (typeof include !== 'string') {
      let base = include.baseUri.fsPath
      roots = roots.filter(r => isParentFolder(base, r, true))
    }
    let pattern = typeof include === 'string' ? include : include.pattern
    let res: URI[] = []
    for (let root of roots) {
      if (res.length >= maxResults) break
      let files = await promisify(glob)(pattern, {
        dot: true,
        cwd: root,
        nodir: true,
        absolute: false
      })
      if (token?.isCancellationRequested) return []
      for (let file of files) {
        if (exclude && fileMatch(root, file, exclude)) continue
        res.push(URI.file(path.join(root, file)))
        if (res.length === maxResults) break
      }
    }
    return res
  }

  private async fireWaitUntilEvent<T extends WaitUntilEvent>(emitter: Emitter<T>, properties: Omit<T, 'waitUntil'>, recovers?: RecoverFunc[]): Promise<void> {
    let firing = true
    let promises: Promise<any>[] = []
    emitter.fire({
      ...properties,
      waitUntil: thenable => {
        if (!firing) throw errors.shouldNotAsync('waitUntil')
        let tp = new Promise(resolve => {
          setTimeout(resolve, this.operationTimeout)
        })
        let promise = Promise.race([thenable, tp]).then(edit => {
          if (edit && WorkspaceEdit.is(edit)) {
            return this.applyEdit(edit, recovers)
          }
        })
        promises.push(promise)
      }
    } as any)
    firing = false
    await Promise.all(promises)
  }
}

function fileMatch(root: string, relpath: string, pattern: GlobPattern): boolean {
  let filepath = path.join(root, relpath)
  if (typeof pattern !== 'string') {
    let base = pattern.baseUri.fsPath
    if (!isParentFolder(base, filepath)) return false
    let rp = path.relative(base, filepath)
    return minimatch(rp, pattern.pattern, { dot: true })
  }
  return minimatch(relpath, pattern, { dot: true })
}

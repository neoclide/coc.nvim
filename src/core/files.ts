'use strict'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs-extra'
import glob from 'glob'
import minimatch from 'minimatch'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { CancellationToken, CreateFile, CreateFileOptions, DeleteFile, DeleteFileOptions, Emitter, Event, Location, Position, RenameFile, RenameFileOptions, TextDocumentEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import Configurations from '../configuration'
import Document from '../model/document'
import RelativePattern from '../model/relativePattern'
import { DocumentChange, Env, FileCreateEvent, FileDeleteEvent, FileRenameEvent, FileWillCreateEvent, FileWillDeleteEvent, FileWillRenameEvent } from '../types'
import { wait } from '../util'
import { fixDriver, isFile, isParentFolder, renameAsync, statAsync } from '../util/fs'
import { byteLength } from '../util/string'
import Documents from './documents'
import * as ui from './ui'
import WorkspaceFolderController from './workspaceFolder'

export type GlobPattern = string | RelativePattern

const logger = require('../util/logger')('core-files')

export default class Files {
  private nvim: Neovim
  private env: Env
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
      if (!fs.existsSync(uri.fsPath)) throw new Error(`${uri.fsPath} not exists.`)
      fs.accessSync(uri.fsPath, fs.constants.R_OK)
    }
    if (scheme == 'untitled') {
      await this.nvim.command(`edit ${uri.path}`)
      doc = await this.documents.document
      await this.jumpTo(doc.uri)
      return doc
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
  public loadResource(uri: string): Promise<Document> {
    let doc = this.documents.getDocument(uri)
    if (doc) return Promise.resolve(doc)
    return this.loadResources([uri]).then(arr => {
      return Array.isArray(arr) ? arr[0] : undefined
    })
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

  public async renameCurrent(): Promise<void> {
    let { nvim, documents } = this
    let bufnr = await nvim.call('bufnr', '%')
    let cwd = await nvim.call('getcwd')
    let doc = documents.getDocument(bufnr)
    if (!doc || doc.buftype != '' || doc.schema != 'file') {
      nvim.echoError('current buffer is not file.')
      return
    }
    let oldPath = URI.parse(doc.uri).fsPath
    // await nvim.callAsync()
    let newPath = await nvim.callAsync('coc#util#with_callback', ['input', ['New path: ', oldPath, 'file']])
    newPath = newPath ? newPath.trim() : null
    if (newPath == oldPath || !newPath) return
    let lines = await doc.buffer.lines
    let exists = fs.existsSync(oldPath)
    if (exists) {
      let modified = await nvim.eval('&modified')
      if (modified) await nvim.command('noa w')
      if (oldPath.toLowerCase() != newPath.toLowerCase() && fs.existsSync(newPath)) {
        let overwrite = await ui.showPrompt(this.nvim, `${newPath} exists, overwrite?`)
        if (!overwrite) return
        fs.unlinkSync(newPath)
      }
      fs.renameSync(oldPath, newPath)
    }
    // TODO need wait for thenable resolve
    this._onWillRenameFiles.fire({
      files: [{ newUri: URI.parse(newPath), oldUri: URI.parse(oldPath) }],
      waitUntil: async thenable => {
        const edit = await Promise.resolve(thenable)
        if (edit && WorkspaceEdit.is(edit)) {
          await this.applyEdit(edit)
        }
      }
    })
    this._onDidRenameFiles.fire({
      files: [{ newUri: URI.parse(newPath), oldUri: URI.parse(oldPath) }],
    })
    let filepath = isParentFolder(cwd, newPath) ? path.relative(cwd, newPath) : newPath
    let view = await nvim.call('winsaveview')
    nvim.pauseNotification()
    if (oldPath.toLowerCase() == newPath.toLowerCase()) {
      nvim.command(`keepalt ${bufnr}bwipeout!`, true)
      nvim.call('coc#util#open_file', ['keepalt edit', filepath], true)
    } else {
      nvim.call('coc#util#open_file', ['keepalt edit', filepath], true)
      nvim.command(`${bufnr}bwipeout!`, true)
    }
    if (!exists && lines.join('\n') != '\n') {
      nvim.call('append', [0, lines], true)
      nvim.command('normal! Gdd', true)
    }
    nvim.call('winrestview', [view], true)
    await nvim.resumeNotification()
  }

  /**
   * Create a file in vim and disk
   */
  public async createFile(filepath: string, opts: CreateFileOptions = {}): Promise<void> {
    let { documents } = this
    let stat = await statAsync(filepath)
    if (stat && !opts.overwrite && !opts.ignoreIfExists) {
      ui.showMessage(this.nvim, `${filepath} already exists!`, 'Error')
      return
    }
    if (!stat || opts.overwrite) {
      // directory
      if (filepath.endsWith('/')) {
        filepath = documents.expand(filepath)
        await fs.mkdirp(filepath)
      } else {
        let uri = URI.file(filepath).toString()
        let doc = documents.getDocument(uri)
        if (doc) return
        if (!fs.existsSync(path.dirname(filepath))) {
          fs.mkdirpSync(path.dirname(filepath))
        }
        fs.writeFileSync(filepath, '', 'utf8')
        await this.loadResource(uri)
      }
    }
  }

  /**
   * Delete file from vim and disk.
   */
  public async deleteFile(filepath: string, opts: DeleteFileOptions = {}): Promise<void> {
    let { ignoreIfNotExists, recursive } = opts
    let stat = await statAsync(filepath.replace(/\/$/, ''))
    let isDir = stat && stat.isDirectory()
    if (filepath.endsWith('/') && !isDir) {
      ui.showMessage(this.nvim, `${filepath} is not directory`, 'Error')
      return
    }
    if (!stat && !ignoreIfNotExists) {
      ui.showMessage(this.nvim, `${filepath} not exists`, 'Error')
      return
    }
    if (stat == null) return
    if (isDir && !recursive) {
      ui.showMessage(this.nvim, `Can't remove directory, recursive not set`, 'Error')
      return
    }
    try {
      if (isDir && recursive) {
        await fs.remove(filepath)
      } else if (isDir) {
        await fs.rmdir(filepath)
      } else {
        await fs.unlink(filepath)
      }
      if (!isDir) {
        let uri = URI.file(filepath).toString()
        let doc = this.documents.getDocument(uri)
        if (doc) await this.nvim.command(`silent! bwipeout! ${doc.bufnr}`)
      }
    } catch (e) {
      ui.showMessage(this.nvim, `Error on delete ${filepath}: ${e}`, 'Error')
    }
  }

  /**
   * Rename file in vim and disk
   */
  public async renameFile(oldPath: string, newPath: string, opts: RenameFileOptions = {}): Promise<void> {
    let { overwrite, ignoreIfExists } = opts
    let { nvim, documents } = this
    try {
      let stat = await statAsync(newPath)
      if (stat && !overwrite && !ignoreIfExists) {
        throw new Error(`${newPath} already exists`)
      }
      if (!stat || overwrite) {
        let uri = URI.file(oldPath).toString()
        let newUri = URI.file(newPath).toString()
        let doc = documents.getDocument(uri)
        if (doc != null) {
          let isCurrent = doc.bufnr == documents.bufnr
          let newDoc = documents.getDocument(newUri)
          if (newDoc) await this.nvim.command(`silent ${newDoc.bufnr}bwipeout!`)
          let content = doc.getDocumentContent()
          await fs.writeFile(newPath, content, 'utf8')
          // open renamed file
          if (!isCurrent) {
            await nvim.call('coc#ui#open_files', [[newPath]])
            await nvim.command(`silent ${doc.bufnr}bwipeout!`)
          } else {
            let view = await nvim.call('winsaveview')
            nvim.pauseNotification()
            nvim.call('coc#util#open_file', ['keepalt edit', newPath], true)
            nvim.command(`silent ${doc.bufnr}bwipeout!`, true)
            nvim.call('winrestview', [view], true)
            await nvim.resumeNotification()
          }
          // avoid vim detect file unlink
          await fs.unlink(oldPath)
        } else {
          await renameAsync(oldPath, newPath)
        }
      }
    } catch (e) {
      ui.showMessage(this.nvim, `Rename error: ${e}`, 'Error')
    }
  }

  private async currentUri(): Promise<string> {
    let bufnr = await this.nvim.call('bufnr', ['%'])
    let document = this.documents.getDocument(bufnr)
    return document ? document.uri : null
  }

  /**
   * Apply WorkspaceEdit.
   */
  public async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
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

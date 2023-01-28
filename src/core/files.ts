'use strict'
import { Neovim } from '@chemzqm/neovim'
import type { TextDocument } from 'vscode-languageserver-textdocument'
import { ChangeAnnotation, CreateFile, CreateFileOptions, DeleteFile, DeleteFileOptions, Position, RenameFile, RenameFileOptions, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import Configurations from '../configuration'
import events from '../events'
import { createLogger } from '../logger'
import Document from '../model/document'
import EditInspect, { EditState, RecoverFunc } from '../model/editInspect'
import { DocumentChange, Env, GlobPattern } from '../types'
import * as errors from '../util/errors'
import { isFile, isParentFolder, normalizeFilePath, statAsync } from '../util/fs'
import { crypto, fs, glob, minimatch, os, path, promisify } from '../util/node'
import { CancellationToken, CancellationTokenSource, Emitter, Event, TextDocumentSaveReason } from '../util/protocol'
import { byteIndex } from '../util/string'
import { createFilteredChanges, getConfirmAnnotations, toDocumentChanges } from '../util/textedit'
import type { Window } from '../window'
import Documents from './documents'
import type Keymaps from './keymaps'
import WorkspaceFolderController from './workspaceFolder'
const logger = createLogger('core-files')

export interface LinesChange {
  uri: string
  lnum: number
  oldLines: ReadonlyArray<string>
  newLines: ReadonlyArray<string>
}

/**
 * An event that is fired when a [document](#TextDocument) will be saved.
 *
 * To make modifications to the document before it is being saved, call the
 * [`waitUntil`](#TextDocumentWillSaveEvent.waitUntil)-function with a thenable
 * that resolves to an array of [text edits](#TextEdit).
 */
export interface TextDocumentWillSaveEvent {

  /**
   * The document that will be saved.
   */
  document: TextDocument

  /**
   * The reason why save was triggered.
   */
  reason: TextDocumentSaveReason

  /**
   * Allows to pause the event loop and to apply [pre-save-edits](#TextEdit).
   * Edits of subsequent calls to this function will be applied in order. The
   * edits will be *ignored* if concurrent modifications of the document happened.
   *
   * *Note:* This function can only be called during event dispatch and not
   * in an asynchronous manner:
   *
   * @param thenable A thenable that resolves to [pre-save-edits](#TextEdit).
   */
  waitUntil(thenable: Thenable<TextEdit[] | any>): void
}

/**
 * An event that is fired when files are going to be renamed.
 *
 * To make modifications to the workspace before the files are renamed,
 * call the [`waitUntil](#FileWillCreateEvent.waitUntil)-function with a
 * thenable that resolves to a [workspace edit](#WorkspaceEdit).
 */
export interface FileWillRenameEvent {

  /**
   * The files that are going to be renamed.
   */
  readonly files: ReadonlyArray<{ oldUri: URI, newUri: URI }>

  /**
   * Allows to pause the event and to apply a [workspace edit](#WorkspaceEdit).
   *
   * *Note:* This function can only be called during event dispatch and not
   * in an asynchronous manner:
   *
   * ```ts
   * workspace.onWillCreateFiles(event => {
   * 	// async, will *throw* an error
   * 	setTimeout(() => event.waitUntil(promise));
   *
   * 	// sync, OK
   * 	event.waitUntil(promise);
   * })
   * ```
   *
   * @param thenable A thenable that delays saving.
   */
  waitUntil(thenable: Thenable<WorkspaceEdit | any>): void
}

/**
 * An event that is fired after files are renamed.
 */
export interface FileRenameEvent {

  /**
   * The files that got renamed.
   */
  readonly files: ReadonlyArray<{ oldUri: URI, newUri: URI }>
}

/**
 * An event that is fired when files are going to be created.
 *
 * To make modifications to the workspace before the files are created,
 * call the [`waitUntil](#FileWillCreateEvent.waitUntil)-function with a
 * thenable that resolves to a [workspace edit](#WorkspaceEdit).
 */
export interface FileWillCreateEvent {

  /**
   * A cancellation token.
   */
  readonly token: CancellationToken

  /**
   * The files that are going to be created.
   */
  readonly files: ReadonlyArray<URI>

  /**
   * Allows to pause the event and to apply a [workspace edit](#WorkspaceEdit).
   *
   * *Note:* This function can only be called during event dispatch and not
   * in an asynchronous manner:
   *
   * ```ts
   * workspace.onWillCreateFiles(event => {
   *     // async, will *throw* an error
   *     setTimeout(() => event.waitUntil(promise));
   *
   *     // sync, OK
   *     event.waitUntil(promise);
   * })
   * ```
   *
   * @param thenable A thenable that delays saving.
   */
  waitUntil(thenable: Thenable<WorkspaceEdit | any>): void
}

/**
 * An event that is fired after files are created.
 */
export interface FileCreateEvent {

  /**
   * The files that got created.
   */
  readonly files: ReadonlyArray<URI>
}

/**
 * An event that is fired when files are going to be deleted.
 *
 * To make modifications to the workspace before the files are deleted,
 * call the [`waitUntil](#FileWillCreateEvent.waitUntil)-function with a
 * thenable that resolves to a [workspace edit](#WorkspaceEdit).
 */
export interface FileWillDeleteEvent {

  /**
   * The files that are going to be deleted.
   */
  readonly files: ReadonlyArray<URI>

  /**
   * Allows to pause the event and to apply a [workspace edit](#WorkspaceEdit).
   *
   * *Note:* This function can only be called during event dispatch and not
   * in an asynchronous manner:
   *
   * ```ts
   * workspace.onWillCreateFiles(event => {
   *     // async, will *throw* an error
   *     setTimeout(() => event.waitUntil(promise));
   *
   *     // sync, OK
   *     event.waitUntil(promise);
   * })
   * ```
   *
   * @param thenable A thenable that delays saving.
   */
  waitUntil(thenable: Thenable<WorkspaceEdit | any>): void
}

/**
 * An event that is fired after files are deleted.
 */
export interface FileDeleteEvent {

  /**
   * The files that got deleted.
   */
  readonly files: ReadonlyArray<URI>
}

interface WaitUntilEvent {
  waitUntil(thenable: Thenable<WorkspaceEdit | any>): void
}

export default class Files {
  private nvim: Neovim
  private env: Env
  private window: Window
  private editState: EditState | undefined
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
    private workspaceFolderControl: WorkspaceFolderController,
    private keymaps: Keymaps
  ) {
  }

  public attach(nvim: Neovim, env: Env, window: Window): void {
    this.nvim = nvim
    this.env = env
    this.window = window
  }

  public async openTextDocument(uri: URI | string): Promise<Document> {
    uri = typeof uri === 'string' ? URI.file(uri) : uri
    let doc = this.documents.getDocument(uri.toString())
    if (doc) return doc
    const scheme = uri.scheme
    if (scheme == 'file') {
      if (!fs.existsSync(uri.fsPath)) throw errors.fileNotExists(uri.fsPath)
      fs.accessSync(uri.fsPath, fs.constants.R_OK)
    }
    if (scheme == 'untitled') {
      await this.nvim.call('coc#util#open_file', ['tab drop', uri.path])
      return await this.documents.document
    }
    return await this.loadResource(uri.toString(), null)
  }

  public async jumpTo(uri: string | URI, position?: Position | null, openCommand?: string): Promise<void> {
    if (!openCommand) openCommand = this.configurations.initialConfiguration.get<string>('coc.preferences.jumpCommand', 'edit')
    let { nvim } = this
    let u = uri instanceof URI ? uri : URI.parse(uri)
    let doc = this.documents.getDocument(u.with({ fragment: '' }).toString())
    let bufnr = doc ? doc.bufnr : -1
    if (!position && u.scheme === 'file' && u.fragment) {
      let parts = u.fragment.split(',')
      let lnum = parseInt(parts[0], 10)
      if (!isNaN(lnum)) {
        let col = parts.length > 0 && /^\d+$/.test(parts[1]) ? parseInt(parts[1], 10) : undefined
        position = Position.create(lnum - 1, col == null ? 0 : col - 1)
      }
    }
    if (bufnr != -1 && openCommand == 'edit') {
      // use buffer command since edit command would reload the buffer
      nvim.pauseNotification()
      nvim.command(`silent! normal! m'`, true)
      nvim.command(`buffer ${bufnr}`, true)
      nvim.command(`if &filetype ==# '' | filetype detect | endif`, true)
      if (position) {
        let line = doc.getline(position.line)
        let col = byteIndex(line, position.character) + 1
        nvim.call('cursor', [position.line + 1, col], true)
      }
      await nvim.resumeNotification(true)
    } else {
      let { fsPath, scheme } = u
      let pos = position == null ? null : [position.line, position.character]
      if (scheme == 'file') {
        let bufname = normalizeFilePath(fsPath)
        await this.nvim.call('coc#util#jump', [openCommand, bufname, pos])
      } else {
        await this.nvim.call('coc#util#jump', [openCommand, uri.toString(), pos])
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
    await this.jumpTo(uri)
    await this.documents.document
  }

  /**
   * Load uri as document.
   */
  public async loadResource(uri: string, cmd?: string): Promise<Document> {
    let doc = this.documents.getDocument(uri)
    if (doc) return doc
    if (cmd === undefined) {
      const preferences = this.configurations.getConfiguration('workspace')
      cmd = preferences.get<string>('openResourceCommand', 'tab drop')
    }
    let u = URI.parse(uri)
    let bufname = u.scheme === 'file' ? u.fsPath : uri
    let bufnr: number
    if (cmd) {
      let winid = await this.nvim.call('win_getid') as number
      bufnr = await this.nvim.call('coc#util#open_file', [cmd, bufname]) as number
      await this.nvim.call('win_gotoid', [winid])
    } else {
      let arr = await this.nvim.call('coc#ui#open_files', [[bufname]])
      bufnr = arr[0]
    }
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
        fs.mkdirSync(dir, { recursive: true })
        recovers && recovers.push(() => {
          fs.rmSync(folder, { force: true, recursive: true })
        })
      }
      fs.writeFileSync(filepath, '', 'utf8')
      recovers && recovers.push(() => {
        fs.rmSync(filepath, { force: true, recursive: true })
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
    let folder = path.join(os.tmpdir(), 'coc-' + process.pid)
    fs.mkdirSync(folder, { recursive: true })
    let md5 = crypto.createHash('md5').update(filepath).digest('hex')
    if (isDir && recursive) {
      let dest = path.join(folder, md5)
      let dir = path.dirname(filepath)
      fs.renameSync(filepath, dest)
      recovers && recovers.push(async () => {
        fs.mkdirSync(dir, { recursive: true })
        fs.renameSync(dest, filepath)
      })
    } else if (isDir) {
      fs.rmdirSync(filepath)
      recovers && recovers.push(() => {
        fs.mkdirSync(filepath)
      })
    } else {
      let dest = path.join(folder, md5)
      let dir = path.dirname(filepath)
      fs.renameSync(filepath, dest)
      recovers && recovers.push(() => {
        fs.mkdirSync(dir, { recursive: true })
        fs.renameSync(dest, filepath)
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
      let bufnr = await nvim.call('coc#ui#rename_file', [oldPath, newPath, oldStat != null]) as number
      await this.documents.onBufCreate(bufnr)
    } else {
      if (oldStat.isDirectory()) {
        for (let doc of this.documents.attached('file')) {
          let u = URI.parse(doc.uri)
          if (isParentFolder(oldPath, u.fsPath, false)) {
            let filepath = u.fsPath.replace(oldPath, newPath)
            let bufnr = await nvim.call('coc#ui#rename_file', [u.fsPath, filepath, false]) as number
            await this.documents.onBufCreate(bufnr)
          }
        }
      }
      fs.renameSync(oldPath, newPath)
    }
    recovers && recovers.push(() => {
      return this.renameFile(newPath, oldPath, { skipEvent: true })
    })
    if (!opts.skipEvent) this._onDidRenameFiles.fire({ files: [file] })
  }

  /**
   * Return denied annotations
   */
  private async promptAnotations(documentChanges: DocumentChange[], changeAnnotations: { [id: string]: ChangeAnnotation } | undefined): Promise<string[]> {
    let toConfirm = changeAnnotations ? getConfirmAnnotations(documentChanges, changeAnnotations) : []
    let denied: string[] = []
    for (let key of toConfirm) {
      let annotation = changeAnnotations[key]
      let res = await this.window.showMenuPicker(['Yes', 'No'], {
        position: 'center',
        title: 'Confirm edits',
        content: annotation.label + (annotation.description ? ' ' + annotation.description : '')
      })
      if (res !== 0) denied.push(key)
    }
    return denied
  }

  /**
   * Apply WorkspaceEdit.
   */
  public async applyEdit(edit: WorkspaceEdit, nested?: boolean): Promise<boolean> {
    let documentChanges = toDocumentChanges(edit)
    let recovers: RecoverFunc[] = []
    let currentOnly = false
    try {
      let denied = await this.promptAnotations(documentChanges, edit.changeAnnotations)
      if (denied.length > 0) documentChanges = createFilteredChanges(documentChanges, denied)
      let changes: { [uri: string]: LinesChange } = {}
      let currentUri = await this.documents.getCurrentUri()
      currentOnly = documentChanges.every(o => TextDocumentEdit.is(o) && o.textDocument.uri === currentUri)
      this.validateChanges(documentChanges)
      for (const change of documentChanges) {
        if (TextDocumentEdit.is(change)) {
          let { textDocument, edits } = change
          let { uri } = textDocument
          let doc = await this.loadResource(uri)
          let revertEdit = await doc.applyEdits(edits, false, uri === currentUri)
          if (revertEdit) {
            let version = doc.version
            let { newText, range } = revertEdit
            changes[uri] = {
              uri,
              lnum: range.start.line + 1,
              newLines: doc.getLines(range.start.line, range.end.line),
              oldLines: newText.endsWith('\n') ? newText.slice(0, -1).split('\n') : newText.split('\n')
            }
            recovers.push(async () => {
              let doc = this.documents.getDocument(uri)
              if (!doc || !doc.attached || doc.version !== version) return
              await doc.applyEdits([revertEdit])
              textDocument.version = doc.version
            })
          }
        } else if (CreateFile.is(change)) {
          await this.createFile(fsPath(change.uri), change.options, recovers)
        } else if (DeleteFile.is(change)) {
          await this.deleteFile(fsPath(change.uri), change.options, recovers)
        } else if (RenameFile.is(change)) {
          await this.renameFile(fsPath(change.oldUri), fsPath(change.newUri), change.options, recovers)
        }
      }
      // nothing changed
      if (recovers.length === 0) return true
      if (!nested) this.editState = { edit: { documentChanges, changeAnnotations: edit.changeAnnotations }, changes, recovers, applied: true }
      this.nvim.redrawVim()
    } catch (e) {
      logger.error('Error on applyEdits:', edit, e)
      if (!nested) void this.window.showErrorMessage(`Error on applyEdits: ${e}`)
      await this.undoChanges(recovers)
      return false
    }
    // avoid message when change current file only.
    if (nested || currentOnly) return true
    void this.window.showInformationMessage(`Use ':wa' to save changes or ':CocCommand workspace.inspectEdit' to inspect.`)
    return true
  }

  private async undoChanges(recovers: RecoverFunc[]): Promise<void> {
    while (recovers.length > 0) {
      let fn = recovers.pop()
      await Promise.resolve(fn())
    }
  }

  public async inspectEdit(): Promise<void> {
    if (!this.editState) {
      void this.window.showWarningMessage('No workspace edit to inspect')
      return
    }
    let inspect = new EditInspect(this.nvim, this.keymaps)
    await inspect.show(this.editState)
  }

  public async undoWorkspaceEdit(): Promise<void> {
    let { editState } = this
    if (!editState || !editState.applied) {
      void this.window.showWarningMessage(`No workspace edit to undo`)
      return
    }
    editState.applied = false
    await this.undoChanges(editState.recovers)
  }

  public async redoWorkspaceEdit(): Promise<void> {
    let { editState } = this
    if (!editState || editState.applied) {
      void this.window.showWarningMessage(`No workspace edit to redo`)
      return
    }
    this.editState = undefined
    await this.applyEdit(editState.edit)
  }

  public validateChanges(documentChanges: ReadonlyArray<DocumentChange>): void {
    let { documents } = this
    for (let change of documentChanges) {
      if (TextDocumentEdit.is(change)) {
        let { uri, version } = change.textDocument
        let doc = documents.getDocument(uri)
        if (typeof version === 'number' && version > 0) {
          if (!doc) throw errors.notLoaded(uri)
          if (doc.version != version) throw new Error(`${uri} changed before apply edit`)
        } else if (!doc && !isFile(uri)) {
          throw errors.badScheme(uri)
        }
      } else if (CreateFile.is(change) || DeleteFile.is(change)) {
        if (!isFile(change.uri)) throw errors.badScheme(change.uri)
      } else if (RenameFile.is(change)) {
        if (!isFile(change.oldUri) || !isFile(change.newUri)) {
          throw errors.badScheme(change.oldUri)
        }
      }
    }
  }

  public async findFiles(include: GlobPattern, exclude?: GlobPattern | null, maxResults?: number, token?: CancellationToken): Promise<URI[]> {
    let folders = this.workspaceFolderControl.workspaceFolders
    if (token?.isCancellationRequested || !folders.length || maxResults === 0) return []
    maxResults = maxResults ?? Infinity
    let roots = folders.map(o => URI.parse(o.uri).fsPath)
    let pattern: string
    if (typeof include !== 'string') {
      pattern = include.pattern
      roots = [include.baseUri.fsPath]
    } else {
      pattern = include
    }
    let res: URI[] = []
    let exceed = false
    for (let root of roots) {
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
        if (res.length === maxResults) {
          exceed = true
          break
        }
      }
      if (exceed) break
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
            return this.applyEdit(edit, true)
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

function fsPath(uri: string): string {
  return URI.parse(uri).fsPath
}

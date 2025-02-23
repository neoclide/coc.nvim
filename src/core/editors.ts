'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import events from '../events'
import { createLogger } from '../logger'
import type Document from '../model/document'
import { sameFile } from '../util/fs'
import { Disposable, Emitter, Event } from '../util/protocol'
import Documents from './documents'
const logger = createLogger('core-editors')

interface EditorOption {
  bufnr: number
  winid: number
  tabpageid: number
  winnr: number
  visibleRanges: [number, number][]
  tabSize: number
  insertSpaces: boolean
}

interface EditorInfo {
  readonly winid: number
  readonly bufnr: number
  readonly tabid: number
  readonly fullpath: string
}

export interface TextEditorOptions {
  tabSize: number
  insertSpaces: boolean
}

export interface TextEditor {
  readonly id: string
  readonly tabpageid: number
  readonly winid: number
  readonly winnr: number
  readonly document: Document
  readonly visibleRanges: readonly Range[]
  readonly uri: string
  readonly bufnr: number
  options: TextEditorOptions
}

export function renamed(editor: TextEditor, info: EditorInfo): boolean {
  let { document, uri } = editor
  if (document.bufnr != info.bufnr) return false
  let u = URI.parse(uri)
  if (u.scheme === 'file') return !sameFile(u.fsPath, info.fullpath)
  return false
}

export default class Editors {
  private disposables: Disposable[] = []
  private winid: number
  private previousId: string | undefined
  private nvim: Neovim
  private editors: Map<number, TextEditor> = new Map()
  private tabIds: Set<number> = new Set()
  private readonly _onDidTabClose = new Emitter<number>()
  private readonly _onDidChangeActiveTextEditor = new Emitter<TextEditor | undefined>()
  private readonly _onDidChangeVisibleTextEditors = new Emitter<ReadonlyArray<TextEditor>>()
  public readonly onDidTabClose: Event<number> = this._onDidTabClose.event
  public readonly onDidChangeActiveTextEditor: Event<TextEditor | undefined> = this._onDidChangeActiveTextEditor.event
  public readonly onDidChangeVisibleTextEditors: Event<ReadonlyArray<TextEditor>> = this._onDidChangeVisibleTextEditors.event
  constructor(private documents: Documents) {
  }

  public get activeTextEditor(): TextEditor | undefined {
    return this.editors.get(this.winid)
  }

  public get visibleTextEditors(): TextEditor[] {
    return Array.from(this.editors.values())
  }

  public isVisible(bufnr: number): boolean {
    for (let editor of this.editors.values()) {
      if (editor.bufnr == bufnr) return true
    }
    return false
  }

  private onChangeCurrent(editor: TextEditor | undefined): void {
    let id = editor.id
    if (id === this.previousId) return
    this.previousId = id
    this._onDidChangeActiveTextEditor.fire(editor)
  }

  public async attach(nvim: Neovim): Promise<void> {
    this.nvim = nvim
    let [winid, infos] = await nvim.eval(`[win_getid(),coc#util#editor_infos()]`) as [number, EditorInfo[]]
    this.winid = winid
    await Promise.allSettled(infos.map(info => {
      return this.createTextEditor(info.winid)
    }))
    events.on('BufUnload', bufnr => {
      for (let [winid, editor] of this.editors.entries()) {
        if (bufnr == editor.bufnr) {
          this.editors.delete(winid)
        }
      }
    }, null, this.disposables)
    events.on('CursorHold', this.checkEditors, this, this.disposables)
    events.on('TabNew', (tabid: number) => {
      this.tabIds.add(tabid)
    }, null, this.disposables)
    events.on('TabClosed', this.checkTabs, this, this.disposables)
    events.on('WinEnter', (winid: number) => {
      this.winid = winid
      let editor = this.editors.get(winid)
      if (editor) this.onChangeCurrent(editor)
    }, null, this.disposables)
    events.on('WinClosed', (winid: number) => {
      if (this.editors.has(winid)) {
        this.editors.delete(winid)
        this._onDidChangeVisibleTextEditors.fire(this.visibleTextEditors)
      }
    }, null, this.disposables)
    events.on('BufWinEnter', async (_: number, winid: number) => {
      this.winid = winid
      let changed = await this.createTextEditor(winid)
      if (changed) this._onDidChangeVisibleTextEditors.fire(this.visibleTextEditors)
    }, null, this.disposables)
  }

  public checkTabs(ids: number[]): void {
    let changed = false
    for (let editor of this.editors.values()) {
      if (!ids.includes(editor.tabpageid)) {
        changed = true
        this.editors.delete(editor.winid)
      }
    }
    for (let id of Array.from(this.tabIds)) {
      if (!ids.includes(id)) this._onDidTabClose.fire(id)
    }
    this.tabIds = new Set(ids)
    if (changed) this._onDidChangeVisibleTextEditors.fire(this.visibleTextEditors)
  }

  public checkUnloadedBuffers(bufnrs: number[]): void {
    for (let bufnr of this.documents.bufnrs) {
      if (!bufnrs.includes(bufnr)) {
        void events.fire('BufUnload', [bufnr])
      }
    }
  }

  public async checkEditors(): Promise<void> {
    let [winid, bufnrs, infos] = await this.nvim.eval(`[win_getid(),coc#util#get_loaded_bufs(),coc#util#editor_infos()]`) as [number, number[], EditorInfo[]]
    this.winid = winid
    this.checkUnloadedBuffers(bufnrs)
    let changed = false
    let winids: Set<number> = new Set()
    for (let info of infos) {
      let editor = this.editors.get(info.winid)
      let create = false
      if (!editor) {
        create = true
      } else if (renamed(editor, info)) {
        await events.fire('BufRename', [info.bufnr])
        create = true
      } else if (editor.document.bufnr != info.bufnr || editor.tabpageid != info.tabid) {
        create = true
      }
      if (create) {
        await this.createTextEditor(info.winid)
        changed = true
      }
      winids.add(info.winid)
    }
    if (this.cleanupEditors(winids)) {
      changed = true
    }
    if (changed) this._onDidChangeVisibleTextEditors.fire(this.visibleTextEditors)
  }

  public cleanupEditors(winids: Set<number>): boolean {
    let changed = false
    for (let winid of Array.from(this.editors.keys())) {
      if (!winids.has(winid)) {
        changed = true
        this.editors.delete(winid)
      }
    }
    return changed
  }

  private async createTextEditor(winid: number): Promise<boolean> {
    let { documents, nvim } = this
    let opts = await nvim.call('coc#util#get_editoroption', [winid]) as EditorOption
    if (!opts) return false
    this.tabIds.add(opts.tabpageid)
    let doc = documents.getDocument(opts.bufnr)
    if (doc && doc.attached) {
      let editor = this.fromOptions(opts)
      this.editors.set(winid, editor)
      if (winid == this.winid) this.onChangeCurrent(editor)
      logger.debug('editor created winid & bufnr & tabpageid: ', winid, opts.bufnr, opts.tabpageid)
      return true
    } else {
      this.editors.delete(opts.winid)
    }
    return false
  }

  private fromOptions(opts: EditorOption): TextEditor {
    let { visibleRanges, bufnr } = opts
    let document = this.documents.getDocument(bufnr)
    return {
      id: `${opts.tabpageid}-${opts.winid}-${document.uri}`,
      tabpageid: opts.tabpageid,
      winid: opts.winid,
      winnr: opts.winnr,
      uri: document.uri,
      bufnr: document.bufnr,
      document,
      visibleRanges: visibleRanges.map(o => Range.create(o[0] - 1, 0, o[1], 0)),
      options: {
        tabSize: opts.tabSize,
        insertSpaces: !!opts.insertSpaces
      }
    }
  }
}

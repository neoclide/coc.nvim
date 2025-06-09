'use strict'
import { Neovim } from '@chemzqm/neovim'
import { FormattingOptions, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import events from '../events'
import { createLogger } from '../logger'
import type Document from '../model/document'
import { convertFormatOptions, VimFormatOption } from '../util/convert'
import { onUnexpectedError } from '../util/errors'
import { sameFile } from '../util/fs'
import { Mutex } from '../util/mutex'
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
  formatOptions: VimFormatOption
}

interface EditorInfo {
  readonly winid: number
  readonly bufnr: number
  readonly tabid: number
  readonly fullpath: string
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
  readonly options: FormattingOptions
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
  private winid = -1
  private mutex: Mutex = new Mutex()
  private previousId: string | undefined
  private nvim: Neovim
  private editors: Map<number, TextEditor> = new Map()
  private tabIds: Set<number> = new Set()
  private creating: Set<number> = new Set()
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

  public getFormatOptions(bufnr: number | string): FormattingOptions | undefined {
    for (let editor of this.editors.values()) {
      if (editor.bufnr === bufnr || editor.uri === bufnr) return editor.options
    }
    return undefined
  }

  public getBufWinids(bufnr: number): number[] {
    let winids: number[] = []
    for (let editor of this.editors.values()) {
      if (editor.bufnr == bufnr) winids.push(editor.winid)
    }
    return winids
  }

  private onChangeCurrent(editor: TextEditor | undefined): void {
    if (!editor) return
    let id = editor.id
    if (id === this.previousId) return
    this.previousId = id
    this._onDidChangeActiveTextEditor.fire(editor)
  }

  public async attach(nvim: Neovim): Promise<void> {
    this.nvim = nvim
    let [winid, infos] = await nvim.eval(`[win_getid(),coc#util#editor_infos()]`) as [number, EditorInfo[]]
    await Promise.allSettled(infos.map(info => {
      return this.createTextEditor(info.winid)
    }))
    this.winid = winid
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
    this.documents.onDidOpenTextDocument(async e => {
      let document = this.documents.getDocument(e.bufnr)
      let changed = false
      for (let winid of document.winids) {
        let editor = this.editors.get(winid)
        // buffer can be reloaded
        if (editor?.document !== document) {
          let res = await this.createTextEditor(winid).catch(onUnexpectedError)
          if (res) changed = true
        }
      }
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
    let { documents } = this
    await this.mutex.use(async () => {
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
          void events.fire('BufRename', [info.bufnr])
          create = true
        } else if (editor.document.bufnr != info.bufnr
          || editor.document !== documents.getDocument(info.bufnr)
          || editor.tabpageid != info.tabid) {
          create = true
        }
        if (create) {
          await this.createTextEditor(info.winid)
          changed = true
        }
        winids.add(info.winid)
      }
      if (this.cleanUpEditors(winids)) {
        changed = true
      }
      this.onChangeCurrent(this.activeTextEditor)
      if (changed) this._onDidChangeVisibleTextEditors.fire(this.visibleTextEditors)
    })
  }

  public cleanUpEditors(winids: Set<number>): boolean {
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
    let { documents, creating, nvim } = this
    if (creating.has(winid)) return false
    let changed = false
    creating.add(winid)
    let opts = await nvim.call('coc#util#get_editoroption', [winid]) as EditorOption
    if (opts) {
      this.tabIds.add(opts.tabpageid)
      let doc = documents.getDocument(opts.bufnr)
      if (doc && doc.attached) {
        let editor = this.fromOptions(opts)
        this.editors.set(winid, editor)
        if (winid == this.winid) this.onChangeCurrent(editor)
        logger.debug('editor created winid & bufnr & tabpageid: ', winid, opts.bufnr, opts.tabpageid)
        changed = true
      } else if (this.editors.has(winid)) {
        this.editors.delete(winid)
        changed = true
      }
    }
    creating.delete(winid)
    return changed
  }

  private fromOptions(opts: EditorOption): TextEditor {
    let { visibleRanges, bufnr, formatOptions } = opts
    let { documents } = this
    let document = documents.getDocument(bufnr)
    return {
      id: `${opts.tabpageid}-${opts.winid}-${document.uri}`,
      tabpageid: opts.tabpageid,
      winid: opts.winid,
      winnr: opts.winnr,
      uri: document.uri,
      bufnr: document.bufnr,
      document,
      visibleRanges: visibleRanges.map(o => Range.create(o[0] - 1, 0, o[1], 0)),
      options: convertFormatOptions(formatOptions)
    }
  }
}

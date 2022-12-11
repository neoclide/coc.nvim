'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Range } from 'vscode-languageserver-types'
import events from '../events'
import { createLogger } from '../logger'
import Document from '../model/document'
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
  options: TextEditorOptions
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

  private onChangeCurrent(editor: TextEditor | undefined): void {
    let id = editor.id
    if (id === this.previousId) return
    this.previousId = id
    this._onDidChangeActiveTextEditor.fire(editor)
  }

  public async attach(nvim: Neovim): Promise<void> {
    this.nvim = nvim
    let [winid, winids] = await nvim.eval(`[win_getid(),coc#util#editor_winids()]`) as [number, number[]]
    this.winid = winid
    await Promise.allSettled(winids.map(winid => {
      return this.createTextEditor(winid)
    }))
    events.on('TabNew', (tabid: number) => {
      this.tabIds.add(tabid)
    }, null, this.disposables)
    events.on('TabClosed', (ids: number[]) => {
      let changed = false
      for (let editor of this.visibleTextEditors) {
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
    }, null, this.disposables)
    events.on('WinEnter', (winid: number) => {
      this.winid = winid
      let editor = this.editors.get(winid)
      if (editor) this.onChangeCurrent(editor)
    }, null, this.disposables)
    events.on('CursorHold', async () => {
      let [winid, winids] = await nvim.eval(`[win_getid(),coc#util#editor_winids()]`) as [number, number[]]
      this.winid = winid
      let changed = false
      let curr = Array.from(this.editors.keys())
      await Promise.all(winids.filter(id => !curr.includes(id)).map(winid => {
        return this.createTextEditor(winid).then(created => {
          if (created) changed = true
        })
      }))
      if (this.checkEditors(winids)) {
        changed = true
      }
      if (changed) this._onDidChangeVisibleTextEditors.fire(this.visibleTextEditors)
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

  public checkEditors(winids: number[]): boolean {
    let changed = false
    for (let winid of Array.from(this.editors.keys())) {
      if (!winids.includes(winid)) {
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
    if (doc) {
      let editor = this.fromOptions(opts, doc)
      this.editors.set(winid, editor)
      if (winid == this.winid) this.onChangeCurrent(editor)
      logger.debug('editor created winid & bufnr & tabpageid: ', winid, opts.bufnr, opts.tabpageid)
      return true
    }
    logger.error(`document not found for window: ${winid}`)
    return false
  }

  private fromOptions(opts: EditorOption, document: Document): TextEditor {
    let { visibleRanges } = opts
    return {
      id: `${opts.tabpageid}-${opts.winid}-${document.uri}`,
      tabpageid: opts.tabpageid,
      winid: opts.winid,
      winnr: opts.winnr,
      document,
      visibleRanges: visibleRanges.map(o => Range.create(o[0] - 1, 0, o[1], 0)),
      options: {
        tabSize: opts.tabSize,
        insertSpaces: !!opts.insertSpaces
      }
    }
  }
}

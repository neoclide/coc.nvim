import { Neovim } from '@chemzqm/neovim'
import { Disposable, Emitter, Event, Location, Range, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { ConfigurationChangeEvent } from '../../types'
import workspace from '../../workspace'
import window from '../../window'
import { disposeAll } from '../../util'
import RefactorBuffer, { RefactorConfig, FileItem, RefactorBufferOpts, FileRange, SEPARATOR } from './buffer'
import BufferSync from '../../model/bufferSync'
import { getFileLineCount } from '../../util/fs'
import Search from '../search'
import { URI } from 'vscode-uri'
const logger = require('../../util/logger')('handler-refactor')

const name = '__coc_refactor__'
let refactorId = 0

export { FileItem }

export default class Refactor {
  private nvim: Neovim
  private srcId: number
  private timer: NodeJS.Timer
  private buffers: BufferSync<RefactorBuffer>
  private optionsMap: Map<number, RefactorBufferOpts> = new Map()
  public config: RefactorConfig
  private disposables: Disposable[] = []
  private readonly _onCreate = new Emitter<number>()
  public readonly onCreate: Event<number> = this._onCreate.event
  constructor() {
    this.nvim = workspace.nvim
    if (workspace.isNvim && this.nvim.hasFunction('nvim_buf_set_virtual_text')) {
      this.srcId = workspace.createNameSpace('coc-refactor')
    }
    this.setConfiguration()
    workspace.onDidChangeConfiguration(this.setConfiguration, this, this.disposables)
    this.buffers = new BufferSync(doc => {
      if (!/__coc_refactor__\d+$/.test(doc.uri)) return undefined
      let { bufnr } = doc
      this._onCreate.fire(bufnr)
      return new RefactorBuffer(bufnr, this.srcId, this.nvim, this.config, this.optionsMap.get(doc.bufnr))
    }, workspace)
  }

  private setConfiguration(e?: ConfigurationChangeEvent): void {
    if (e && !e.affectsConfiguration('refactor')) return
    let config = workspace.getConfiguration('refactor')
    this.config = Object.assign(this.config || {}, {
      afterContext: config.get('afterContext', 3),
      beforeContext: config.get('beforeContext', 3),
      openCommand: config.get('openCommand', 'edit'),
      saveToFile: config.get('saveToFile', true)
    })
  }

  private async ensureBuffer(bufnr: number): Promise<RefactorBuffer> {
    let buf = this.getBuffer(bufnr)
    if (buf) return buf
    return new Promise((resolve, reject) => {
      let timer = this.timer = setTimeout(() => {
        reject(new Error('Document create timeout after 2s.'))
      }, 2000)
      this.onCreate(e => {
        if (e == bufnr) {
          clearTimeout(timer)
          this.timer = null
          // need wait
          setImmediate(() => {
            resolve(this.buffers.getItem(bufnr))
          })
        }
      })
    })
  }

  public getBuffer(bufnr: number): RefactorBuffer {
    return this.buffers.getItem(bufnr)
  }

  /**
   * Search by rg
   */
  public async search(args: string[]): Promise<void> {
    let buf = await this.createRefactorBuffer()
    if (!buf) return
    let cwd = await this.nvim.call('getcwd', [])
    let search = new Search(this.nvim)
    await search.run(args, cwd, buf)
  }

  /**
   * Create initialized refactor buffer
   */
  public async createRefactorBuffer(filetype?: string): Promise<RefactorBuffer> {
    let { nvim } = this
    let [fromWinid, cwd] = await nvim.eval('[win_getid(),getcwd()]') as [number, string]
    let { openCommand } = this.config
    nvim.pauseNotification()
    nvim.command(`${openCommand} ${name}${refactorId++}`, true)
    nvim.command(`setl buftype=acwrite nobuflisted bufhidden=wipe nofen wrap conceallevel=2 concealcursor=n`, true)
    nvim.command(`setl undolevels=-1 nolist nospell noswapfile foldmethod=expr foldexpr=coc#util#refactor_foldlevel(v:lnum)`, true)
    nvim.command(`setl foldtext=coc#util#refactor_fold_text(v:foldstart)`, true)
    nvim.call('setline', [1, ['Save current buffer to make changes', SEPARATOR]], true)
    nvim.call('matchadd', ['Comment', '\\%1l'], true)
    nvim.call('matchadd', ['Conceal', '^\\%u3000'], true)
    nvim.call('matchadd', ['Label', '^\\%u3000\\zs\\S\\+'], true)
    nvim.command('setl nomod', true)
    if (filetype) nvim.command(`runtime! syntax/${filetype}.vim`, true)
    nvim.call('coc#util#do_autocmd', ['CocRefactorOpen'], true)
    let [, err] = await nvim.resumeNotification()
    if (err) {
      logger.error(err)
      window.showMessage(`Error on open refactor window: ${err}`, 'error')
      return
    }
    let [bufnr, win] = await nvim.eval('[bufnr("%"),win_getid()]') as [number, number]
    this.optionsMap.set(bufnr, { fromWinid, winid: win, cwd })
    return await this.ensureBuffer(bufnr)
  }

  /**
   * Create refactor buffer from lines
   */
  public async fromLines(lines: string[]): Promise<RefactorBuffer> {
    let buf = await this.createRefactorBuffer()
    if (buf) await buf.buffer.setLines(lines, { start: 0, end: -1, strictIndexing: false })
    return buf
  }

  /**
   * Create refactor buffer from locations
   */
  public async fromLocations(locations: Location[], filetype?: string): Promise<RefactorBuffer> {
    if (!locations || locations.length == 0) return null
    let changes: { [uri: string]: TextEdit[] } = {}
    let edit: WorkspaceEdit = { changes }
    for (let location of locations) {
      let edits: TextEdit[] = changes[location.uri] || []
      edits.push({ range: location.range, newText: '' })
      changes[location.uri] = edits
    }
    return await this.fromWorkspaceEdit(edit, filetype)
  }

  /**
   * Start refactor from workspaceEdit
   */
  public async fromWorkspaceEdit(edit: WorkspaceEdit, filetype?: string): Promise<RefactorBuffer> {
    if (!edit || emptyWorkspaceEdit(edit)) return undefined
    let items: FileItem[] = []
    let { beforeContext, afterContext } = this.config
    let { changes, documentChanges } = edit
    if (!changes) {
      changes = {}
      for (let change of documentChanges || []) {
        if (TextDocumentEdit.is(change)) {
          let { textDocument, edits } = change
          if (textDocument.uri.startsWith('file:')) {
            changes[textDocument.uri] = edits
          }
        }
      }
    }
    for (let key of Object.keys(changes)) {
      let max = await this.getLineCount(key)
      let edits = changes[key]
      let ranges: FileRange[] = []
      // start end highlights
      let start = null
      let end = null
      let highlights: Range[] = []
      edits.sort((a, b) => a.range.start.line - b.range.start.line)
      for (let edit of edits) {
        let { line } = edit.range.start
        let s = Math.max(0, line - beforeContext)
        if (start != null && s < end) {
          end = Math.min(max, line + afterContext + 1)
          highlights.push(adjustRange(edit.range, start))
        } else {
          if (start != null) ranges.push({ start, end, highlights })
          start = s
          end = Math.min(max, line + afterContext + 1)
          highlights = [adjustRange(edit.range, start)]
        }
      }
      if (start != null) ranges.push({ start, end, highlights })
      items.push({
        ranges,
        filepath: URI.parse(key).fsPath
      })
    }
    let buf = await this.createRefactorBuffer(filetype)
    await buf.addFileItems(items)
    return buf
  }

  public async save(bufnr: number): Promise<boolean> {
    let buf = this.buffers.getItem(bufnr)
    if (buf) return await buf.save()
  }

  private async getLineCount(uri: string): Promise<number> {
    let doc = workspace.getDocument(uri)
    if (doc) return doc.lineCount
    return await getFileLineCount(URI.parse(uri).fsPath)
  }

  public reset(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.optionsMap.clear()
    this.buffers.reset()
  }

  public dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.optionsMap.clear()
    this._onCreate.dispose()
    this.buffers.dispose()
    disposeAll(this.disposables)
  }
}

function adjustRange(range: Range, offset: number): Range {
  let { start, end } = range
  return Range.create(start.line - offset, start.character, end.line - offset, end.character)
}

function emptyWorkspaceEdit(edit: WorkspaceEdit): boolean {
  let { changes, documentChanges } = edit
  if (documentChanges && documentChanges.length) return false
  if (changes && Object.keys(changes).length) return false
  return true
}

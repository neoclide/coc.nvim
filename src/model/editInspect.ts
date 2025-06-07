'use strict'
import { Neovim } from '@chemzqm/neovim'
import { ChangeAnnotation, CreateFile, DeleteFile, Position, RenameFile, SnippetTextEdit, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import type { LinesChange } from '../core/files'
import type Keymaps from '../core/keymaps'
import events from '../events'
import { DocumentChange } from '../types'
import { disposeAll } from '../util'
import { toArray } from '../util/array'
import { isParentFolder } from '../util/fs'
import { fastDiff, path } from '../util/node'
import { Disposable } from '../util/protocol'
import { getAnnotationKey, getPositionFromEdits, mergeSortEdits } from '../util/textedit'
import Highlighter from './highlighter'

export type RecoverFunc = () => Promise<any> | void

export interface EditState {
  edit: WorkspaceEdit
  changes: {
    [uri: string]: LinesChange
  }
  recovers: RecoverFunc[]
  applied: boolean
}

export interface ChangedFileItem {
  index: number
  filepath: string
  lnum?: number
}

let global_id = 0

export default class EditInspect {
  private disposables: Disposable[] = []
  private bufnr: number
  private items: ChangedFileItem[] = []
  private renameMap: Map<string, string> = new Map()
  constructor(private nvim: Neovim, private keymaps: Keymaps) {
    events.on('BufUnload', bufnr => {
      if (bufnr == this.bufnr) this.dispose()
    }, null, this.disposables)
  }

  private addFile(filepath: string, highlighter: Highlighter, lnum?: number): void {
    this.items.push({
      index: highlighter.length,
      filepath,
      lnum
    })
  }

  public async show(state: EditState): Promise<void> {
    let { nvim } = this
    let id = global_id++
    nvim.pauseNotification()
    nvim.command(`tabe +setl\\ buftype=nofile CocWorkspaceEdit${id}`, true)
    nvim.command(`setl bufhidden=wipe nolist`, true)
    nvim.command('setl nobuflisted wrap undolevels=-1 filetype=cocedits noswapfile', true)
    await nvim.resumeNotification(true)
    let buffer = await nvim.buffer
    let cwd = await nvim.call('getcwd') as string
    this.bufnr = buffer.id
    const relpath = (uri: string): string => {
      let fsPath = URI.parse(uri).fsPath
      return isParentFolder(cwd, fsPath, true) ? path.relative(cwd, fsPath) : fsPath
    }
    const absPath = filepath => {
      return path.isAbsolute(filepath) ? filepath : path.join(cwd, filepath)
    }
    let highlighter = new Highlighter()
    let changes = toArray(state.edit.documentChanges)
    let map = grouByAnnotation(changes, state.edit.changeAnnotations ?? {})
    for (let [label, changes] of map.entries()) {
      if (label) {
        highlighter.addLine(label, 'MoreMsg')
        highlighter.addLine('')
      }
      for (let change of changes) {
        if (TextDocumentEdit.is(change)) {
          let linesChange = state.changes[change.textDocument.uri]
          let fsPath = relpath(change.textDocument.uri)
          highlighter.addTexts([
            { text: 'Change', hlGroup: 'Title' },
            { text: ' ' },
            { text: fsPath, hlGroup: 'Directory' },
            { text: `:${linesChange.lnum}`, hlGroup: 'LineNr' },
          ])
          this.addFile(fsPath, highlighter, linesChange.lnum)
          highlighter.addLine('')
          this.addChangedLines(highlighter, linesChange, fsPath, linesChange.lnum)
          highlighter.addLine('')
        } else if (CreateFile.is(change) || DeleteFile.is(change)) {
          let title = DeleteFile.is(change) ? 'Delete' : 'Create'
          let fsPath = relpath(change.uri)
          highlighter.addTexts([
            { text: title, hlGroup: 'Title' },
            { text: ' ' },
            { text: fsPath, hlGroup: 'Directory' }
          ])
          this.addFile(fsPath, highlighter)
          highlighter.addLine('')
        } else if (RenameFile.is(change)) {
          let oldPath = relpath(change.oldUri)
          let newPath = relpath(change.newUri)
          highlighter.addTexts([
            { text: 'Rename', hlGroup: 'Title' },
            { text: ' ' },
            { text: oldPath, hlGroup: 'Directory' },
            { text: '->', hlGroup: 'Comment' },
            { text: newPath, hlGroup: 'Directory' }
          ])
          this.renameMap.set(oldPath, newPath)
          this.addFile(newPath, highlighter)
          highlighter.addLine('')
        }
      }
    }
    nvim.pauseNotification()
    highlighter.render(buffer)
    buffer.setOption('modifiable', false, true)
    await nvim.resumeNotification(true)
    this.disposables.push(this.keymaps.registerLocalKeymap(buffer.id, 'n', '<CR>', async () => {
      let lnum = await nvim.call('line', '.') as number
      let col = await nvim.call('col', '.') as number
      let find: ChangedFileItem
      for (let i = this.items.length - 1; i >= 0; i--) {
        let item = this.items[i]
        if (lnum >= item.index) {
          find = item
          break
        }
      }
      if (!find) return
      let uri = URI.file(absPath(find.filepath)).toString()
      let filepath = this.renameMap.has(find.filepath) ? this.renameMap.get(find.filepath) : find.filepath
      await nvim.call('coc#util#open_file', ['tab drop', absPath(filepath)])
      let documentChanges = toArray(state.edit.documentChanges)
      let change = documentChanges.find(o => TextDocumentEdit.is(o) && o.textDocument.uri == uri) as TextDocumentEdit
      let originLine = getOriginalLine(find, change)
      if (originLine !== undefined) await nvim.call('cursor', [originLine, col])
      nvim.redrawVim()
    }, true))
    this.disposables.push(this.keymaps.registerLocalKeymap(buffer.id, 'n', '<esc>', async () => {
      nvim.command('bwipeout!', true)
    }, true))
  }

  public addChangedLines(highlighter: Highlighter, linesChange: LinesChange, fsPath: string, lnum: number): void {
    let diffs = fastDiff(linesChange.oldLines.join('\n'), linesChange.newLines.join('\n'))
    for (let i = 0; i < diffs.length; i++) {
      let diff = diffs[i]
      if (diff[0] == fastDiff.EQUAL) {
        let text = diff[1]
        if (!text.includes('\n')) {
          highlighter.addText(text)
        } else {
          let parts = text.split('\n')
          highlighter.addText(parts[0])
          let curr = lnum + parts.length - 1
          highlighter.addLine('')
          highlighter.addTexts([
            { text: 'Change', hlGroup: 'Title' },
            { text: ' ' },
            { text: fsPath, hlGroup: 'Directory' },
            { text: `:${curr}`, hlGroup: 'LineNr' },
          ])
          this.addFile(fsPath, highlighter, curr)
          highlighter.addLine('')
          let last = parts[parts.length - 1]
          highlighter.addText(last)
        }
        lnum += text.split('\n').length - 1
      } else if (diff[0] == fastDiff.DELETE) {
        lnum += diff[1].split('\n').length - 1
        highlighter.addText(diff[1], 'DiffDelete')
      } else {
        highlighter.addText(diff[1], 'DiffAdd')
      }
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export function getOriginalLine(item: ChangedFileItem, change: TextDocumentEdit | undefined): number | undefined {
  if (typeof item.lnum !== 'number') return undefined
  let lnum = item.lnum
  if (change) {
    // Use snippet value as text should be fine to get the line number.
    let edits: TextEdit[] = change.edits.map(o => SnippetTextEdit.is(o) ? { range: o.range, newText: o.snippet.value } : o)
    edits = mergeSortEdits(edits)
    let pos = getPositionFromEdits(Position.create(lnum - 1, 0), edits)
    lnum = pos.line + 1
  }
  return lnum
}

function grouByAnnotation(changes: DocumentChange[], annotations: { [id: string]: ChangeAnnotation }): Map<string | null, DocumentChange[]> {
  let map: Map<string | null, DocumentChange[]> = new Map()
  for (let change of changes) {
    let id = getAnnotationKey(change) ?? null
    let key = id ? annotations[id]?.label : null
    let arr = map.get(key)
    if (arr) {
      arr.push(change)
    } else {
      map.set(key, [change])
    }
  }
  return map
}

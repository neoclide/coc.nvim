'use strict'
import { Neovim } from '@chemzqm/neovim'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import commandManager from '../commands'
import events from '../events'
import languages, { ProviderName } from '../languages'
import { createLogger } from '../logger'
import Document from '../model/document'
import snippetManager from '../snippets/manager'
import { IConfigurationChangeEvent } from '../types'
import { isFalsyOrEmpty } from '../util/array'
import { defaultValue, pariedCharacters } from '../util/index'
import { CancellationTokenSource } from '../util/protocol'
import { isAlphabet } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { HandlerDelegate } from './types'
const logger = createLogger('handler-format')

interface FormatPreferences {
  formatOnType: boolean
  formatOnTypeFiletypes: string[] | null
  bracketEnterImprove: boolean
}

export default class FormatHandler {
  private preferences: FormatPreferences
  constructor(
    private nvim: Neovim,
    private handler: HandlerDelegate
  ) {
    this.setConfiguration()
    handler.addDisposable(workspace.onDidChangeConfiguration(this.setConfiguration, this))
    handler.addDisposable(window.onDidChangeActiveTextEditor(() => {
      this.setConfiguration()
    }))
    handler.addDisposable(workspace.onWillSaveTextDocument(event => {
      // the document could be not current one.
      if (this.shouldFormatOnSave(event.document)) {
        let willSaveWaitUntil = async (): Promise<TextEdit[] | undefined> => {
          if (!languages.hasFormatProvider(event.document)) {
            logger.warn(`Format provider not found for ${event.document.uri}`)
            return undefined
          }
          let options = await workspace.getFormatOptions(event.document.uri)
          let formatOnSaveTimeout = workspace.initialConfiguration.get<number>('coc.preferences.formatOnSaveTimeout', 500)
          let timer: NodeJS.Timer
          let tokenSource = new CancellationTokenSource()
          const tp = new Promise<undefined>(c => {
            timer = setTimeout(() => {
              logger.warn(`Attempt to format ${event.document.uri} on save timed out after ${formatOnSaveTimeout}ms`)
              tokenSource.cancel()
              c(undefined)
            }, formatOnSaveTimeout)
          })
          const provideEdits = languages.provideDocumentFormattingEdits(event.document, options, tokenSource.token)
          let textEdits = await Promise.race([tp, provideEdits])
          clearTimeout(timer)
          return Array.isArray(textEdits) ? textEdits : undefined
        }
        event.waitUntil(willSaveWaitUntil())
      }
    }))
    handler.addDisposable(events.on('Enter', async bufnr => {
      let res = await events.race(['CursorMovedI'], 100)
      if (res.args && res.args[0] === bufnr) {
        await this.handleEnter(bufnr)
      }
    }))
    handler.addDisposable(events.on('TextInsert', async (bufnr: number, _info, character: string) => {
      let doc = workspace.getDocument(bufnr)
      if (!events.pumvisible && doc && doc.attached) await this.tryFormatOnType(character, doc)
    }))
    handler.addDisposable(commandManager.registerCommand('editor.action.formatDocument', async (uri?: string | number) => {
      const doc = uri ? workspace.getDocument(uri) : (await this.handler.getCurrentState()).doc
      await this.documentFormat(doc)
    }))
    commandManager.titles.set('editor.action.formatDocument', 'Format Document')
  }

  public shouldFormatOnSave(doc: TextDocument): boolean {
    let { languageId, uri } = doc
    // the document could be not current one.
    let config = workspace.getConfiguration('coc.preferences', { uri, languageId })
    let filetypes = config.get<string[] | null>('formatOnSaveFiletypes', null)
    let formatOnSave = config.get<boolean>('formatOnSave', false)
    if (Array.isArray(filetypes)) return filetypes.includes('*') || filetypes.includes(languageId)
    return formatOnSave
  }

  private setConfiguration(e?: IConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('coc.preferences')) {
      let doc = window.activeTextEditor?.document
      let config = workspace.getConfiguration('coc.preferences', doc)
      this.preferences = {
        formatOnType: config.get<boolean>('formatOnType', false),
        formatOnTypeFiletypes: config.get('formatOnTypeFiletypes', null),
        bracketEnterImprove: config.get<boolean>('bracketEnterImprove', true),
      }
    }
  }

  public shouldFormatOnType(filetype: string): boolean {
    const filetypes = this.preferences.formatOnTypeFiletypes
    return isFalsyOrEmpty(filetypes) || filetypes.includes(filetype) || filetypes.includes('*')
  }

  public async tryFormatOnType(ch: string, doc: Document): Promise<boolean> {
    if (!ch || isAlphabet(ch.charCodeAt(0)) || !this.preferences.formatOnType) return false
    if (snippetManager.getSession(doc.bufnr) != null || !this.shouldFormatOnType(doc.filetype)) return false
    if (!languages.hasProvider(ProviderName.FormatOnType, doc.textDocument)) {
      logger.warn(`Format on type provider not found for buffer: ${doc.uri}`)
      return false
    }
    if (!languages.canFormatOnType(ch, doc.textDocument)) return false
    let position: Position
    let edits = await this.handler.withRequestToken('Format on type', async token => {
      position = await window.getCursorPosition()
      await doc.synchronize()
      return await languages.provideDocumentOnTypeEdits(ch, doc.textDocument, position, token)
    })
    await doc.applyEdits(defaultValue(edits, []), false, true)
    return true
  }

  public async formatCurrentBuffer(): Promise<boolean> {
    let { doc } = await this.handler.getCurrentState()
    return await this.documentFormat(doc)
  }

  public async formatCurrentRange(mode: string): Promise<number> {
    let { doc } = await this.handler.getCurrentState()
    return await this.documentRangeFormat(doc, mode)
  }

  public async documentFormat(doc: Document): Promise<boolean> {
    await doc.synchronize()
    if (!languages.hasFormatProvider(doc.textDocument)) {
      throw new Error(`Format provider not found for buffer: ${doc.bufnr}`)
    }
    let options = await workspace.getFormatOptions(doc.uri)
    let textEdits = await this.handler.withRequestToken('format', token => {
      return languages.provideDocumentFormattingEdits(doc.textDocument, options, token)
    })
    if (textEdits && textEdits.length > 0) {
      await doc.applyEdits(textEdits, false, true)
      return true
    }
    return false
  }

  public async handleEnter(bufnr: number): Promise<void> {
    let { nvim } = this
    let { bracketEnterImprove } = this.preferences
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) return
    await this.tryFormatOnType('\n', doc)
    if (bracketEnterImprove) {
      let line = (await nvim.call('line', '.') as number) - 1
      await doc._fetchContent(false)
      let pre = doc.getline(line - 1)
      let curr = doc.getline(line)
      let prevChar = pre[pre.length - 1]
      if (prevChar && pariedCharacters.has(prevChar)) {
        let nextChar = curr.trim()[0]
        if (nextChar && pariedCharacters.get(prevChar) == nextChar) {
          let edits: TextEdit[] = []
          let pos: Position = Position.create(line - 1, pre.length)
          // make sure indent of current line
          if (doc.filetype == 'vim') {
            let opts = await workspace.getFormatOptions(doc.uri)
            let space = opts.insertSpaces ? ' '.repeat(opts.tabSize) : '\t'
            let currIndent = curr.match(/^\s*/)[0]
            let newText = '\n' + currIndent + space
            edits.push({ range: Range.create(line, currIndent.length, line, currIndent.length), newText: '  \\ ' })
            newText = newText + '\\ '
            edits.push({ range: Range.create(pos, pos), newText })
            await doc.applyEdits(edits)
            await window.moveTo(Position.create(line, newText.length - 1))
          } else {
            await nvim.eval(`feedkeys("\\<Esc>O", 'in')`)
          }
        }
      }
    }
  }

  public async documentRangeFormat(doc: Document, mode?: string): Promise<number> {
    this.handler.checkProvider(ProviderName.FormatRange, doc.textDocument)
    await doc.synchronize()
    let range: Range
    if (mode) {
      range = await window.getSelectedRange(mode)
      if (!range) return -1
    } else {
      let [lnum, count, mode] = await this.nvim.eval("[v:lnum,v:count,mode()]") as [number, number, string]
      // we can't handle
      if (count == 0 || mode == 'i' || mode == 'R') return -1
      range = Range.create(lnum - 1, 0, lnum - 1 + count, 0)
    }
    let options = await workspace.getFormatOptions(doc.uri)
    let textEdits = await this.handler.withRequestToken('Format range', token => {
      return languages.provideDocumentRangeFormattingEdits(doc.textDocument, range, options, token)
    })
    if (!isFalsyOrEmpty(textEdits)) {
      await doc.applyEdits(textEdits, false, true)
      return 0
    }
    return -1
  }
}

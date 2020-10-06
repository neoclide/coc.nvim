import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, CodeActionContext, CodeActionKind, Definition, Disposable, DocumentLink, DocumentSymbol, ExecuteCommandParams, ExecuteCommandRequest, Hover, Location, LocationLink, MarkedString, MarkupContent, Position, Range, SelectionRange, SymbolInformation, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { Document, StatusBarItem } from '..'
import commandManager from '../commands'
import diagnosticManager from '../diagnostic/manager'
import events from '../events'
import languages from '../languages'
import listManager from '../list/manager'
import FloatFactory from '../model/floatFactory'
import { TextDocumentContentProvider } from '../provider'
import services from '../services'
import snippetManager from '../snippets/manager'
import { CodeAction, Documentation, TagDefinition } from '../types'
import { disposeAll, wait } from '../util'
import { getSymbolKind } from '../util/convert'
import { equals } from '../util/object'
import { emptyRange, getChangedFromEdits, positionInRange, rangeInRange } from '../util/position'
import { byteLength, isWord } from '../util/string'
import workspace from '../workspace'
import CodeLensManager from './codelens'
import Colors from './colors'
import DocumentHighlighter from './documentHighlight'
import Refactor from './refactor'
import Search from './search'
import debounce = require('debounce')
const logger = require('../util/logger')('Handler')
const pairs: Map<string, string> = new Map([
  ['<', '>'],
  ['>', '<'],
  ['{', '}'],
  ['[', ']'],
  ['(', ')'],
])

interface SymbolInfo {
  filepath?: string
  lnum: number
  col: number
  text: string
  kind: string
  level?: number
  containerName?: string
  range: Range
  selectionRange?: Range
}

interface CommandItem {
  id: string
  title: string
}

interface SignaturePart {
  text: string
  type: 'Label' | 'MoreMsg' | 'Normal'
}

interface Preferences {
  signatureMaxHeight: number
  signaturePreferAbove: boolean
  signatureHideOnChange: boolean
  signatureHelpTarget: string
  signatureFloatMaxWidth: number
  triggerSignatureHelp: boolean
  triggerSignatureWait: number
  formatOnType: boolean
  formatOnTypeFiletypes: string[]
  formatOnInsertLeave: boolean
  hoverTarget: string
  previewAutoClose: boolean
  previewMaxHeight: number
  bracketEnterImprove: boolean
  currentFunctionSymbolAutoUpdate: boolean
}

export default class Handler {
  private preferences: Preferences
  private documentHighlighter: DocumentHighlighter
  /* bufnr and srcId list*/
  private hoverPosition: [number, number, number]
  private colors: Colors
  private hoverFactory: FloatFactory
  private signatureFactory: FloatFactory
  private refactorMap: Map<number, Refactor> = new Map()
  private documentLines: string[] = []
  private codeLensManager: CodeLensManager
  private signatureTokenSource: CancellationTokenSource
  private disposables: Disposable[] = []
  private labels: { [key: string]: string } = {}
  private selectionRange: SelectionRange = null
  private signaturePosition: Position
  private requestStatusItem: StatusBarItem
  private requestTokenSource: CancellationTokenSource | undefined
  private requestTimer: NodeJS.Timer
  private symbolsTokenSources: Map<number, CancellationTokenSource> = new Map()
  private cachedSymbols: Map<number, [number, SymbolInfo[]]> = new Map()

  constructor(private nvim: Neovim) {
    this.getPreferences()
    this.requestStatusItem = workspace.createStatusBarItem(0, { progress: true })
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('coc.preferences')) {
        this.getPreferences()
      }
    })
    this.hoverFactory = new FloatFactory(nvim, workspace.env)
    this.disposables.push(this.hoverFactory)
    let { signaturePreferAbove, signatureFloatMaxWidth, signatureMaxHeight } = this.preferences
    this.signatureFactory = new FloatFactory(
      nvim,
      workspace.env,
      signaturePreferAbove,
      signatureMaxHeight,
      signatureFloatMaxWidth,
      false)
    this.disposables.push(this.signatureFactory)
    workspace.onWillSaveUntil(event => {
      let { languageId } = event.document
      let config = workspace.getConfiguration('coc.preferences', event.document.uri)
      let filetypes = config.get<string[]>('formatOnSaveFiletypes', [])
      if (filetypes.includes(languageId) || filetypes.some(item => item === '*')) {
        let willSaveWaitUntil = async (): Promise<TextEdit[]> => {
          let options = await workspace.getFormatOptions(event.document.uri)
          let tokenSource = new CancellationTokenSource()
          let timer = setTimeout(() => {
            tokenSource.cancel()
          }, 1000)
          let textEdits = await languages.provideDocumentFormattingEdits(event.document, options, tokenSource.token)
          clearTimeout(timer)
          return textEdits
        }
        event.waitUntil(willSaveWaitUntil())
      }
    }, null, 'languageserver')

    events.on('BufUnload', async bufnr => {
      let refactor = this.refactorMap.get(bufnr)
      if (refactor) {
        refactor.dispose()
        this.refactorMap.delete(bufnr)
      }
    }, null, this.disposables)
    events.on(['CursorMoved', 'InsertEnter'], () => {
      if (this.requestTokenSource) {
        this.requestTokenSource.cancel()
      }
    }, null, this.disposables)
    events.on('CursorMovedI', async (bufnr, cursor) => {
      if (!this.signaturePosition) return
      let doc = workspace.getDocument(bufnr)
      if (!doc) return
      let { line, character } = this.signaturePosition
      if (cursor[0] - 1 == line) {
        let currline = doc.getline(cursor[0] - 1)
        let col = byteLength(currline.slice(0, character)) + 1
        if (cursor[1] >= col) return
      }
      this.signatureFactory.close()
    }, null, this.disposables)
    events.on('InsertLeave', () => {
      this.signatureFactory.close()
    }, null, this.disposables)
    events.on(['TextChangedI', 'TextChangedP'], async () => {
      if (this.preferences.signatureHideOnChange) {
        this.signatureFactory.close()
      }
      this.hoverFactory.close()
    }, null, this.disposables)

    let lastInsert: number
    events.on('InsertCharPre', async character => {
      lastInsert = Date.now()
      if (character == ')') this.signatureFactory.close()
    }, null, this.disposables)
    events.on('Enter', async bufnr => {
      let { bracketEnterImprove } = this.preferences
      await this.tryFormatOnType('\n', bufnr)
      if (bracketEnterImprove) {
        let line = (await nvim.call('line', '.') as number) - 1
        let doc = workspace.getDocument(bufnr)
        if (!doc) return
        await doc.checkDocument()
        let pre = doc.getline(line - 1)
        let curr = doc.getline(line)
        let prevChar = pre[pre.length - 1]
        if (prevChar && pairs.has(prevChar)) {
          let nextChar = curr.trim()[0]
          if (nextChar && pairs.get(prevChar) == nextChar) {
            let edits: TextEdit[] = []
            let opts = await workspace.getFormatOptions(doc.uri)
            let space = opts.insertSpaces ? ' '.repeat(opts.tabSize) : '\t'
            let preIndent = pre.match(/^\s*/)[0]
            let currIndent = curr.match(/^\s*/)[0]
            let newText = '\n' + preIndent + space
            let pos: Position = Position.create(line - 1, pre.length)
            // make sure indent of current line
            if (preIndent != currIndent) {
              let newText = doc.filetype == 'vim' ? '  \\ ' + preIndent : preIndent
              edits.push({ range: Range.create(Position.create(line, 0), Position.create(line, currIndent.length)), newText })
            } else if (doc.filetype == 'vim') {
              edits.push({ range: Range.create(line, currIndent.length, line, currIndent.length), newText: '  \\ ' })
            }
            if (doc.filetype == 'vim') {
              newText = newText + '\\ '
            }
            edits.push({ range: Range.create(pos, pos), newText })
            await doc.applyEdits(edits)
            await workspace.moveTo(Position.create(line, newText.length - 1))
          }
        }
      }
    }, null, this.disposables)

    events.on('TextChangedI', async bufnr => {
      let curr = Date.now()
      if (!lastInsert || curr - lastInsert > 300) return
      lastInsert = null
      let doc = workspace.getDocument(bufnr)
      if (!doc || doc.isCommandLine || !doc.attached) return
      let { triggerSignatureHelp, formatOnType } = this.preferences
      if (!triggerSignatureHelp && !formatOnType) return
      let [pos, line] = await nvim.eval('[coc#util#cursor(), getline(".")]') as [[number, number], string]
      let pre = pos[1] == 0 ? '' : line.slice(pos[1] - 1, pos[1])
      if (!pre || isWord(pre)) return
      await this.tryFormatOnType(pre, bufnr)
      if (triggerSignatureHelp && languages.shouldTriggerSignatureHelp(doc.textDocument, pre)) {
        try {
          let [mode, cursor] = await nvim.eval('[mode(),coc#util#cursor()]') as [string, [number, number]]
          if (mode !== 'i') return
          await synchronizeDocument(doc)
          await this.triggerSignatureHelp(doc, { line: cursor[0], character: cursor[1] })
        } catch (e) {
          logger.error(`Error on signature help:`, e)
        }
      }
    }, null, this.disposables)

    events.on('InsertLeave', async bufnr => {
      if (!this.preferences.formatOnInsertLeave) return
      await wait(30)
      if (workspace.insertMode) return
      await this.tryFormatOnType('\n', bufnr, true)
    }, null, this.disposables)
    events.on('CursorMoved', debounce((bufnr: number, cursor: [number, number]) => {
      if (!this.preferences.previewAutoClose || !this.hoverPosition) return
      if (this.preferences.hoverTarget == 'float') return
      let arr = [bufnr, cursor[0], cursor[1]]
      if (equals(arr, this.hoverPosition)) return
      let doc = workspace.documents.find(doc => doc.uri.startsWith('coc://'))
      if (doc && doc.bufnr != bufnr) {
        nvim.command('pclose', true)
      }
    }, 100), null, this.disposables)

    if (this.preferences.currentFunctionSymbolAutoUpdate) {
      events.on('CursorHold', () => {
        this.getCurrentFunctionSymbol().logError()
      }, null, this.disposables)
    }

    let provider: TextDocumentContentProvider = {
      onDidChange: null,
      provideTextDocumentContent: async () => {
        nvim.pauseNotification()
        nvim.command('setlocal conceallevel=2 nospell nofoldenable wrap', true)
        nvim.command('setlocal bufhidden=wipe nobuflisted', true)
        nvim.command('setfiletype markdown', true)
        nvim.command(`if winnr('j') != winnr('k') | exe "normal! z${Math.min(this.documentLines.length, this.preferences.previewMaxHeight)}\\<cr> | endif"`, true)
        await nvim.resumeNotification()
        return this.documentLines.join('\n')
      }
    }
    this.disposables.push(workspace.registerTextDocumentContentProvider('coc', provider))
    this.codeLensManager = new CodeLensManager(nvim)
    this.colors = new Colors(nvim)
    this.documentHighlighter = new DocumentHighlighter(nvim, this.colors)
    this.disposables.push(commandManager.registerCommand('editor.action.organizeImport', async (bufnr?: number) => {
      if (!bufnr) bufnr = await nvim.call('bufnr', '%')
      let doc = workspace.getDocument(bufnr)
      if (!doc) return false
      let range: Range = Range.create(0, 0, doc.lineCount, 0)
      let actions = await this.getCodeActions(bufnr, range, [CodeActionKind.SourceOrganizeImports])
      if (actions && actions.length) {
        await this.applyCodeAction(actions[0])
        return true
      }
      workspace.showMessage(`Organize import action not found.`, 'warning')
      return false
    }))
    commandManager.titles.set('editor.action.organizeImport', 'run organize import code action.')
  }

  private getRequestToken(name: string): CancellationToken {
    if (this.requestTokenSource) {
      this.requestTokenSource.cancel()
    }
    let statusItem = this.requestStatusItem
    this.requestTokenSource = new CancellationTokenSource()
    let { token } = this.requestTokenSource
    let disposable = token.onCancellationRequested(() => {
      disposable.dispose()
      statusItem.text = `${name} request canceled`
      statusItem.isProgress = false
      this.requestTimer = setTimeout(() => {
        statusItem.hide()
      }, 500)
    })
    statusItem.isProgress = true
    statusItem.text = `requesting ${name}`
    statusItem.show()
    if (this.requestTimer) {
      clearTimeout(this.requestTimer)
    }
    return token
  }

  public async getCurrentFunctionSymbol(): Promise<string> {
    let position = await workspace.getCursorPosition()
    let buffer = await this.nvim.buffer
    let document = workspace.getDocument(buffer.id)
    if (!document) return
    let symbols = await this.getDocumentSymbols(document)
    if (!symbols || symbols.length === 0) {
      buffer.setVar('coc_current_function', '', true)
      this.nvim.call('coc#util#do_autocmd', ['CocStatusChange'], true)
      return ''
    }
    symbols = symbols.filter(s => [
      'Class',
      'Method',
      'Function',
      'Struct',
    ].includes(s.kind))
    let functionName = ''
    for (let sym of symbols.reverse()) {
      if (sym.range
        && positionInRange(position, sym.range) == 0
        && !sym.text.endsWith(') callback')) {
        functionName = sym.text
        let label = this.labels[sym.kind.toLowerCase()]
        if (label) functionName = `${label} ${functionName}`
        break
      }
    }
    buffer.setVar('coc_current_function', functionName, true)
    this.nvim.call('coc#util#do_autocmd', ['CocStatusChange'], true)
    return functionName
  }

  public async hasProvider(id: string): Promise<boolean> {
    let bufnr = await this.nvim.call('bufnr', '%')
    let doc = workspace.getDocument(bufnr)
    if (!doc) return false
    return languages.hasProvider(id, doc.textDocument)
  }

  public async onHover(): Promise<boolean> {
    let doc = await workspace.document
    let position = await workspace.getCursorPosition()
    let winid = await this.nvim.call('win_getid') as number
    let token = this.getRequestToken('hover')
    let hovers = await languages.getHover(doc.textDocument, position, token)
    if (token.isCancellationRequested) return false
    if (this.checkEmpty('hover', hovers)) return false
    if (!token.isCancellationRequested && !this.checkEmpty('hover', hovers)) {
      let hover = hovers.find(o => Range.is(o.range))
      if (hover) {
        doc.matchAddRanges([hover.range], 'CocHoverRange', 999)
        setTimeout(() => {
          this.nvim.call('coc#util#clear_pos_matches', ['^CocHoverRange', winid], true)
          if (workspace.isVim) this.nvim.command('redraw', true)
        }, 1000)
      }
      await this.previewHover(hovers)
      return true
    }
    let target = this.preferences.hoverTarget
    if (target == 'float') {
      this.hoverFactory.close()
    } else if (target == 'preview') {
      this.nvim.command('pclose', true)
    }
    return false
  }

  public async gotoDefinition(openCommand?: string): Promise<boolean> {
    let { document, position } = await workspace.getCurrentState()
    let token = this.getRequestToken('definition')
    let definition = await languages.getDefinition(document, position, token)
    if (token.isCancellationRequested) return false
    if (this.checkEmpty('definition', definition)) return false
    await this.handleLocations(definition, openCommand)
    return true
  }

  public async gotoDeclaration(openCommand?: string): Promise<boolean> {
    let { document, position } = await workspace.getCurrentState()
    let token = this.getRequestToken('declaration')
    let definition = await languages.getDeclaration(document, position, token)
    if (token.isCancellationRequested) return false
    if (this.checkEmpty('declaration', definition)) return false
    await this.handleLocations(definition, openCommand)
    return true
  }

  public async gotoTypeDefinition(openCommand?: string): Promise<boolean> {
    let { document, position } = await workspace.getCurrentState()
    let token = this.getRequestToken('type definition')
    let definition = await languages.getTypeDefinition(document, position, token)
    if (token.isCancellationRequested) return false
    if (this.checkEmpty('type definition', definition)) return false
    await this.handleLocations(definition, openCommand)
    return true
  }

  public async gotoImplementation(openCommand?: string): Promise<boolean> {
    let { document, position } = await workspace.getCurrentState()
    let token = this.getRequestToken('implementation')
    let definition = await languages.getImplementation(document, position, token)
    if (token.isCancellationRequested) return false
    if (this.checkEmpty('implementation', definition)) return false
    await this.handleLocations(definition, openCommand)
    return true
  }

  public async gotoReferences(openCommand?: string, includeDeclaration = true): Promise<boolean> {
    let { document, position } = await workspace.getCurrentState()
    let token = this.getRequestToken('references')
    let locs = await languages.getReferences(document, { includeDeclaration }, position, token)
    if (token.isCancellationRequested) return false
    if (this.checkEmpty('references', locs)) return false
    await this.handleLocations(locs, openCommand)
    return true
  }

  public async getDocumentSymbols(doc: Document): Promise<SymbolInfo[]> {
    if (!doc) return []
    await synchronizeDocument(doc)
    let cached = this.cachedSymbols.get(doc.bufnr)
    if (cached && cached[0] == doc.version) {
      return cached[1]
    }
    this.symbolsTokenSources.get(doc.bufnr)?.cancel()
    let tokenSource = new CancellationTokenSource()
    this.symbolsTokenSources.set(doc.bufnr, tokenSource)
    let { version } = doc
    let symbols = await languages.getDocumentSymbol(doc.textDocument, tokenSource.token)
    this.symbolsTokenSources.delete(doc.bufnr)
    if (!symbols || symbols.length == 0) return null
    let level = 0
    let res: SymbolInfo[] = []
    let pre = null
    if (isDocumentSymbols(symbols)) {
      symbols.sort(sortDocumentSymbols)
      symbols.forEach(s => addDoucmentSymbol(res, s, level))
    } else {
      symbols.sort(sortSymbolInformations)
      for (let sym of symbols) {
        let { name, kind, location, containerName } = sym
        if (!containerName || !pre) {
          level = 0
        } else {
          if (pre.containerName == containerName) {
            level = pre.level || 0
          } else {
            let container = getPreviousContainer(containerName, res)
            level = container ? container.level + 1 : 0
          }
        }
        let { start } = location.range
        let o: SymbolInfo = {
          col: start.character + 1,
          lnum: start.line + 1,
          text: name,
          level,
          kind: getSymbolKind(kind),
          range: location.range,
          containerName
        }
        res.push(o)
        pre = o
      }
    }
    this.cachedSymbols.set(doc.bufnr, [version, res])
    return res
  }

  public async getWordEdit(): Promise<WorkspaceEdit> {
    let bufnr = await this.nvim.call('bufnr', '%')
    let doc = workspace.getDocument(bufnr)
    if (!doc) return null
    let position = await workspace.getCursorPosition()
    let range = doc.getWordRangeAtPosition(position)
    if (!range || emptyRange(range)) return null
    let curname = doc.textDocument.getText(range)
    if (languages.hasProvider('rename', doc.textDocument)) {
      await synchronizeDocument(doc)
      let requestTokenSource = new CancellationTokenSource()
      let res = await languages.prepareRename(doc.textDocument, position, requestTokenSource.token)
      if (res === false) return null
      let edit = await languages.provideRenameEdits(doc.textDocument, position, curname, requestTokenSource.token)
      if (edit) return edit
    }
    workspace.showMessage('Rename provider not found, extract word ranges from current buffer', 'more')
    let ranges = doc.getSymbolRanges(curname)
    return {
      changes: {
        [doc.uri]: ranges.map(r => ({ range: r, newText: curname }))
      }
    }
  }

  public async rename(newName?: string): Promise<boolean> {
    let bufnr = await this.nvim.call('bufnr', '%')
    let doc = workspace.getDocument(bufnr)
    if (!doc) return false
    let { nvim } = this
    let statusItem = this.requestStatusItem
    let position = await workspace.getCursorPosition()
    if (!languages.hasProvider('rename', doc.textDocument)) {
      workspace.showMessage(`Rename provider not found for current document`, 'warning')
      return false
    }
    await synchronizeDocument(doc)
    try {
      let token = (new CancellationTokenSource()).token
      let res = await languages.prepareRename(doc.textDocument, position, token)
      if (res === false) {
        statusItem.hide()
        workspace.showMessage('Invalid position for renmame', 'warning')
        return false
      }
      if (token.isCancellationRequested) return false
      let curname: string
      if (!newName) {
        if (Range.is(res)) {
          curname = doc.textDocument.getText(res)
        } else if (res && typeof res.placeholder === 'string') {
          curname = res.placeholder
        } else {
          curname = await nvim.eval('expand("<cword>")') as string
        }
        newName = await workspace.requestInput('New name', curname)
      }
      if (!newName) {
        statusItem.hide()
        return false
      }
      let edit = await languages.provideRenameEdits(doc.textDocument, position, newName, token)
      if (token.isCancellationRequested) return false
      statusItem.hide()
      if (!edit) {
        workspace.showMessage('Invalid position for rename', 'warning')
        return false
      }
      await workspace.applyEdit(edit)
      return true
    } catch (e) {
      statusItem.hide()
      workspace.showMessage(`Error on rename: ${e.message}`, 'error')
      logger.error(e)
      return false
    }
  }

  public async documentFormatting(): Promise<boolean> {
    let bufnr = await this.nvim.eval('bufnr("%")') as number
    let document = workspace.getDocument(bufnr)
    if (!document) return false
    await synchronizeDocument(document)
    let token = this.getRequestToken('format')
    try {
      let options = await workspace.getFormatOptions(document.uri)
      let textEdits = await languages.provideDocumentFormattingEdits(document.textDocument, options, token)
      if (token.isCancellationRequested) return false
      if (Array.isArray(textEdits) && textEdits.length == 0) {
        // no change
        this.requestStatusItem.hide()
        return true
      }
      if (this.checkEmpty('format', textEdits)) return false
      await document.applyEdits(textEdits)
      return true
    } catch (e) {
      this.requestStatusItem.hide()
      workspace.showMessage(`Error on format: ${e.message}`, 'error')
      logger.error(e)
      return false
    }
  }

  public async documentRangeFormatting(mode: string): Promise<number> {
    let document = await workspace.document
    if (!document) return -1
    await synchronizeDocument(document)
    let range: Range
    if (mode) {
      range = await workspace.getSelectedRange(mode, document)
      if (!range) return -1
    } else {
      let lnum = await this.nvim.getVvar('lnum') as number
      let count = await this.nvim.getVvar('count') as number
      let mode = await this.nvim.call('mode')
      // we can't handle
      if (count == 0 || mode == 'i' || mode == 'R') return -1
      range = Range.create(lnum - 1, 0, lnum - 1 + count, 0)
    }
    let token = this.getRequestToken('range format')
    try {
      let options = await workspace.getFormatOptions(document.uri)
      let textEdits = await languages.provideDocumentRangeFormattingEdits(document.textDocument, range, options, token)
      if (token.isCancellationRequested) return -1
      this.requestStatusItem.hide()
      if (textEdits && textEdits.length == 0) {
        this.requestStatusItem.hide()
        return 0
      }
      if (this.checkEmpty('range format', textEdits)) return -1
      await document.applyEdits(textEdits)
      return 0
    } catch (e) {
      this.requestStatusItem.hide()
      workspace.showMessage(`Error on range format: ${e.message}`, 'error')
      logger.error(e)
      return -1
    }
  }

  public async getTagList(): Promise<TagDefinition[] | null> {
    let position = await workspace.getCursorPosition()
    let document = await workspace.document
    let word = await this.nvim.call('expand', '<cword>')
    if (!word) return null
    if (!languages.hasProvider('definition', document.textDocument)) {
      return null
    }
    let tokenSource = new CancellationTokenSource()
    let definitions = await languages.getDefinition(document.textDocument, position, tokenSource.token)
    if (!definitions || !definitions.length) return null
    return definitions.map(location => {
      let parsedURI = URI.parse(location.uri)
      const filename = parsedURI.scheme == 'file' ? parsedURI.fsPath : parsedURI.toString()
      return {
        name: word,
        cmd: `keepjumps ${location.range.start.line + 1} | normal ${location.range.start.character + 1}|`,
        filename,
      }
    })
  }

  public async runCommand(id?: string, ...args: any[]): Promise<any> {
    if (id) {
      await events.fire('Command', [id])
      let res = await commandManager.executeCommand(id, ...args)
      if (args.length == 0) {
        await commandManager.addRecent(id)
      }
      return res
    } else {
      await listManager.start(['commands'])
    }
  }

  public async getCodeActions(bufnr: number, range?: Range, only?: CodeActionKind[]): Promise<CodeAction[]> {
    let document = workspace.getDocument(bufnr)
    if (!document) return []
    range = range || Range.create(0, 0, document.lineCount, 0)
    let diagnostics = diagnosticManager.getDiagnosticsInRange(document.textDocument, range)
    let context: CodeActionContext = { diagnostics }
    if (only && Array.isArray(only)) context.only = only
    let token = this.getRequestToken('code action')
    let codeActionsMap = await languages.getCodeActions(document.textDocument, range, context, token)
    if (token.isCancellationRequested) return []
    this.requestStatusItem.hide()
    if (!codeActionsMap) return []
    let codeActions: CodeAction[] = []
    for (let clientId of codeActionsMap.keys()) {
      let actions = codeActionsMap.get(clientId)
      for (let action of actions) {
        codeActions.push({ clientId, ...action })
      }
    }
    codeActions.sort((a, b) => {
      if (a.isPreferred && !b.isPreferred) {
        return -1
      }
      if (b.isPreferred && !a.isPreferred) {
        return 1
      }
      return 0
    })
    return codeActions
  }

  public async doCodeAction(mode: string | null, only?: CodeActionKind[] | string): Promise<void> {
    let bufnr = await this.nvim.call('bufnr', '%')
    let range: Range
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    if (mode) range = await workspace.getSelectedRange(mode, doc)
    await synchronizeDocument(doc)
    let codeActions = await this.getCodeActions(bufnr, range, Array.isArray(only) ? only : null)
    if (only && typeof only == 'string') {
      codeActions = codeActions.filter(o => o.title == only || (o.command && o.command.title == only))
    }
    if (!codeActions || codeActions.length == 0) {
      workspace.showMessage(`No${only ? ' ' + only : ''} code action available`, 'warning')
      return
    }
    let idx = await workspace.showQuickpick(codeActions.map(o => o.title))
    let action = codeActions[idx]
    if (action) await this.applyCodeAction(action)
  }

  /**
   * Get current codeActions
   *
   * @public
   * @returns {Promise<CodeAction[]>}
   */
  public async getCurrentCodeActions(mode?: string, only?: CodeActionKind[]): Promise<CodeAction[]> {
    let bufnr = await this.nvim.call('bufnr', '%') as number
    let document = workspace.getDocument(bufnr)
    if (!document) return []
    let range: Range
    if (mode) range = await workspace.getSelectedRange(mode, workspace.getDocument(bufnr))
    return await this.getCodeActions(bufnr, range, only)
  }

  /**
   * Invoke preferred quickfix at current position, return false when failed
   *
   * @returns {Promise<boolean>}
   */
  public async doQuickfix(): Promise<boolean> {
    let actions = await this.getCurrentCodeActions('n', [CodeActionKind.QuickFix])
    if (!actions || actions.length == 0) {
      workspace.showMessage('No quickfix action available', 'warning')
      return false
    }
    await this.applyCodeAction(actions[0])
    await this.nvim.command(`silent! call repeat#set("\\<Plug>(coc-fix-current)", -1)`)
    return true
  }

  public async applyCodeAction(action: CodeAction): Promise<void> {
    let { command, edit } = action
    if (edit) await workspace.applyEdit(edit)
    if (command) {
      if (commandManager.has(command.command)) {
        commandManager.execute(command)
      } else {
        let clientId = (action as any).clientId
        let service = services.getService(clientId)
        let params: ExecuteCommandParams = {
          command: command.command,
          arguments: command.arguments
        }
        if (service.client) {
          let { client } = service
          client
            .sendRequest(ExecuteCommandRequest.type, params)
            .then(undefined, error => {
              workspace.showMessage(`Execute '${command.command} error: ${error}'`, 'error')
            })
        }
      }
    }
  }

  public async doCodeLensAction(): Promise<void> {
    await this.codeLensManager.doAction()
  }

  public async fold(kind?: string): Promise<boolean> {
    let doc = await workspace.document
    if (!doc || !doc.attached) {
      workspace.showMessage('document not attached', 'warning')
      return false
    }
    await synchronizeDocument(doc)
    let win = await this.nvim.window
    let foldmethod = await win.getOption('foldmethod')
    if (foldmethod != 'manual') {
      workspace.showMessage('foldmethod option should be manual!', 'warning')
      return false
    }
    let token = this.getRequestToken('folding range')
    let ranges = await languages.provideFoldingRanges(doc.textDocument, {}, token)
    if (this.checkEmpty('folding range', ranges)) return false
    if (kind) {
      ranges = ranges.filter(o => o.kind == kind)
    }
    if (ranges && ranges.length) {
      this.nvim.pauseNotification()
      win.setOption('foldenable', true, true)
      for (let range of ranges.reverse()) {
        let { startLine, endLine } = range
        let cmd = `${startLine + 1}, ${endLine + 1}fold`
        this.nvim.command(cmd, true)
      }
      await this.nvim.resumeNotification()
      return true
    }
    return false
  }

  public async pickColor(): Promise<void> {
    await this.colors.pickColor()
  }

  public async pickPresentation(): Promise<void> {
    await this.colors.pickPresentation()
  }

  public async highlight(): Promise<void> {
    let [bufnr, arr, winid] = await this.nvim.eval('[bufnr("%"),coc#util#cursor(),win_getid()]') as [number, [number, number], number]
    await this.documentHighlighter.highlight(bufnr, winid, Position.create(arr[0], arr[1]))
  }

  public async getSymbolsRanges(): Promise<Range[]> {
    let [bufnr, arr] = await this.nvim.eval('[bufnr("%"),coc#util#cursor()]') as [number, [number, number]]
    let highlights = await this.documentHighlighter.getHighlights(workspace.getDocument(bufnr), Position.create(arr[0], arr[1]))
    if (!highlights) return null
    return highlights.map(o => o.range)
  }

  public async links(): Promise<DocumentLink[]> {
    let doc = await workspace.document
    let links = await languages.getDocumentLinks(doc.textDocument)
    links = links || []
    let res: DocumentLink[] = []
    for (let link of links) {
      if (link.target) {
        res.push(link)
      } else {
        link = await languages.resolveDocumentLink(link)
        res.push(link)
      }
    }
    return links
  }

  public async openLink(): Promise<boolean> {
    let { document, position } = await workspace.getCurrentState()
    let links = await languages.getDocumentLinks(document)
    if (!links || links.length == 0) return false
    for (let link of links) {
      if (positionInRange(position, link.range)) {
        let { target } = link
        if (!target) {
          link = await languages.resolveDocumentLink(link)
          target = link.target
        }
        if (target) {
          await workspace.openResource(target)
          return true
        }
        return false
      }
    }
    return false
  }

  public async getCommands(): Promise<CommandItem[]> {
    let list = commandManager.commandList
    let res: CommandItem[] = []
    let { titles } = commandManager
    for (let item of list) {
      res.push({
        id: item.id,
        title: titles.get(item.id) || ''
      })
    }
    return res
  }

  /*
   * supportedSymbols must be string values of symbolKind
   */
  public async selectSymbolRange(inner: boolean, visualmode: string, supportedSymbols: string[]): Promise<void> {
    let doc = await workspace.document
    if (!doc || !doc.attached) return
    await synchronizeDocument(doc)
    let range: Range
    if (visualmode) {
      range = await workspace.getSelectedRange(visualmode, doc)
    } else {
      let pos = await workspace.getCursorPosition()
      range = Range.create(pos, pos)
    }
    let symbols = await this.getDocumentSymbols(doc)
    if (!symbols || symbols.length === 0) {
      workspace.showMessage('No symbols found', 'warning')
      return
    }
    let properties = symbols.filter(s => s.kind == 'Property')
    symbols = symbols.filter(s => supportedSymbols.includes(s.kind))
    let selectRange: Range
    for (let sym of symbols.reverse()) {
      if (sym.range && !equals(sym.range, range) && rangeInRange(range, sym.range)) {
        selectRange = sym.range
        break
      }
    }
    if (!selectRange) {
      for (let sym of properties) {
        if (sym.range && !equals(sym.range, range) && rangeInRange(range, sym.range)) {
          selectRange = sym.range
          break
        }
      }
    }
    if (inner && selectRange) {
      let { start, end } = selectRange
      let line = doc.getline(start.line + 1)
      let endLine = doc.getline(end.line - 1)
      selectRange = Range.create(start.line + 1, line.match(/^\s*/)[0].length, end.line - 1, endLine.length)
    }
    if (selectRange) await workspace.selectRange(selectRange)
  }

  private async tryFormatOnType(ch: string, bufnr: number, insertLeave = false): Promise<void> {
    if (!ch || isWord(ch) || !this.preferences.formatOnType) return
    if (snippetManager.getSession(bufnr) != null) return
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) return
    if (!languages.hasOnTypeProvider(ch, doc.textDocument)) return
    const filetypes = this.preferences.formatOnTypeFiletypes
    if (filetypes.length && !filetypes.includes(doc.filetype)) {
      // Only check formatOnTypeFiletypes when set, avoid breaking change
      return
    }
    let position = await workspace.getCursorPosition()
    let origLine = doc.getline(position.line)
    let pos: Position = insertLeave ? { line: position.line, character: origLine.length } : position
    let { changedtick } = doc
    await synchronizeDocument(doc)
    if (doc.changedtick != changedtick) return
    let tokenSource = new CancellationTokenSource()
    let disposable = doc.onDocumentChange(() => {
      clearTimeout(timer)
      disposable.dispose()
      tokenSource.cancel()
    })
    let timer = setTimeout(() => {
      disposable.dispose()
      tokenSource.cancel()
    }, 2000)
    let edits: TextEdit[]
    try {
      edits = await languages.provideDocumentOnTypeEdits(ch, doc.textDocument, pos, tokenSource.token)
    } catch (e) {
      logger.error(`Error on format: ${e.message}`, e.stack)
    }
    if (!edits || !edits.length) return
    if (tokenSource.token.isCancellationRequested) return
    clearTimeout(timer)
    disposable.dispose()
    let changed = getChangedFromEdits(position, edits)
    await doc.applyEdits(edits)
    let to = changed ? Position.create(position.line + changed.line, position.character + changed.character) : null
    if (to) await workspace.moveTo(to)
  }

  private async triggerSignatureHelp(document: Document, position: Position): Promise<boolean> {
    let { signatureHelpTarget } = this.preferences
    if (this.signatureTokenSource) {
      this.signatureTokenSource.cancel()
      this.signatureTokenSource = null
    }
    let part = document.getline(position.line).slice(0, position.character)
    if (part.endsWith(')')) {
      this.signatureFactory.close()
      return
    }
    let tokenSource = this.signatureTokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    let timer = setTimeout(() => {
      if (!token.isCancellationRequested) {
        tokenSource.cancel()
      }
    }, 3000)
    let signatureHelp = await languages.getSignatureHelp(document.textDocument, position, token)
    clearTimeout(timer)
    if (token.isCancellationRequested || !signatureHelp || signatureHelp.signatures.length == 0) {
      this.signatureFactory.close()
      return false
    }
    let { activeParameter, activeSignature, signatures } = signatureHelp
    if (activeSignature) {
      // make active first
      let [active] = signatures.splice(activeSignature, 1)
      if (active) signatures.unshift(active)
    }
    if (signatureHelpTarget == 'echo') {
      let columns = workspace.env.columns
      signatures = signatures.slice(0, workspace.env.cmdheight)
      let signatureList: SignaturePart[][] = []
      for (let signature of signatures) {
        let parts: SignaturePart[] = []
        let { label } = signature
        label = label.replace(/\n/g, ' ')
        if (label.length >= columns - 16) {
          label = label.slice(0, columns - 16) + '...'
        }
        let nameIndex = label.indexOf('(')
        if (nameIndex == -1) {
          parts = [{ text: label, type: 'Normal' }]
        } else {
          parts.push({
            text: label.slice(0, nameIndex),
            type: 'Label'
          })
          let after = label.slice(nameIndex)
          if (signatureList.length == 0 && activeParameter != null) {
            let active = signature.parameters[activeParameter]
            if (active) {
              let start: number
              let end: number
              if (typeof active.label === 'string') {
                let str = after.slice(0)
                let ms = str.match(new RegExp('\\b' + active.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'))
                let idx = ms ? ms.index : str.indexOf(active.label)
                if (idx == -1) {
                  parts.push({ text: after, type: 'Normal' })
                } else {
                  start = idx
                  end = idx + active.label.length
                }
              } else {
                [start, end] = active.label
                start = start - nameIndex
                end = end - nameIndex
              }
              if (start != null && end != null) {
                parts.push({ text: after.slice(0, start), type: 'Normal' })
                parts.push({ text: after.slice(start, end), type: 'MoreMsg' })
                parts.push({ text: after.slice(end), type: 'Normal' })
              }
            }
          } else {
            parts.push({
              text: after,
              type: 'Normal'
            })
          }
        }
        signatureList.push(parts)
      }
      this.nvim.callTimer('coc#util#echo_signatures', [signatureList], true)
    } else {
      let offset = 0
      let paramDoc: string | MarkupContent = null
      let docs: Documentation[] = signatures.reduce((p: Documentation[], c, idx) => {
        let activeIndexes: [number, number] = null
        let nameIndex = c.label.indexOf('(')
        if (idx == 0 && activeParameter != null) {
          let active = c.parameters[activeParameter]
          if (active) {
            let after = c.label.slice(nameIndex == -1 ? 0 : nameIndex)
            paramDoc = active.documentation
            if (typeof active.label === 'string') {
              let str = after.slice(0)
              let ms = str.match(new RegExp('\\b' + active.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'))
              let index = ms ? ms.index : str.indexOf(active.label)
              if (index != -1) {
                activeIndexes = [
                  index + nameIndex,
                  index + active.label.length + nameIndex
                ]
              }
            } else {
              activeIndexes = active.label
            }
          }
        }
        if (activeIndexes == null) {
          activeIndexes = [nameIndex + 1, nameIndex + 1]
        }
        if (offset == 0) {
          offset = activeIndexes[0] + 1
        }
        p.push({
          content: c.label,
          filetype: document.filetype,
          active: activeIndexes
        })
        if (paramDoc) {
          let content = typeof paramDoc === 'string' ? paramDoc : paramDoc.value
          if (content.trim().length) {
            p.push({
              content,
              filetype: MarkupContent.is(c.documentation) ? 'markdown' : 'txt'
            })
          }
        }
        if (idx == 0 && c.documentation) {
          let { documentation } = c
          let content = typeof documentation === 'string' ? documentation : documentation.value
          if (content.trim().length) {
            p.push({
              content,
              filetype: MarkupContent.is(c.documentation) ? 'markdown' : 'txt'
            })
          }
        }
        return p
      }, [])
      if (signatureHelpTarget == 'float') {
        let session = snippetManager.getSession(document.bufnr)
        if (session && session.isActive) {
          let { value } = session.placeholder
          if (!value.includes('\n')) offset += value.length
          this.signaturePosition = Position.create(position.line, position.character - value.length)
        } else {
          this.signaturePosition = position
        }
        await this.signatureFactory.create(docs, true, offset)
        // show float
      } else {
        this.documentLines = docs.reduce((p, c) => {
          p.push('``` ' + c.filetype)
          p.push(...c.content.split(/\r?\n/))
          p.push('```')
          return p
        }, [])
        await this.nvim.command(`pedit coc://document`)
      }
    }
    return true
  }

  public async showSignatureHelp(): Promise<boolean> {
    let buffer = await this.nvim.buffer
    let document = workspace.getDocument(buffer.id)
    if (!document) return false
    let position = await workspace.getCursorPosition()
    return await this.triggerSignatureHelp(document, position)
  }

  public async findLocations(id: string, method: string, params: any, openCommand?: string | false): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    params = params || {}
    Object.assign(params, {
      textDocument: { uri: document.uri },
      position
    })
    let res: any = await services.sendRequest(id, method, params)
    res = res || []
    let locations: Location[] = []
    if (Array.isArray(res)) {
      locations = res as Location[]
    } else if (res.hasOwnProperty('location') && res.hasOwnProperty('children')) {
      let getLocation = (item: any): void => {
        locations.push(item.location as Location)
        if (item.children && item.children.length) {
          for (let loc of item.children) {
            getLocation(loc)
          }
        }
      }
      getLocation(res)
    }
    await this.handleLocations(locations, openCommand)
  }

  public async handleLocations(definition: Definition | LocationLink[], openCommand?: string | false): Promise<void> {
    if (!definition) return
    let locations: Location[] = Array.isArray(definition) ? definition as Location[] : [definition]
    let len = locations.length
    if (len == 0) return
    if (len == 1 && openCommand !== false) {
      let location = definition[0] as Location
      if (LocationLink.is(definition[0])) {
        let link = definition[0]
        location = Location.create(link.targetUri, link.targetRange)
      }
      let { uri, range } = location
      await workspace.jumpTo(uri, range.start, openCommand)
    } else {
      await workspace.showLocations(definition as Location[])
    }
  }

  public async getSelectionRanges(): Promise<SelectionRange[] | null> {
    let { document, position } = await workspace.getCurrentState()
    let token = this.getRequestToken('selection ranges')
    let selectionRanges: SelectionRange[] = await languages.getSelectionRanges(document, [position], token)
    if (token.isCancellationRequested) return null
    if (this.checkEmpty('selection ranges', selectionRanges)) return null
    if (selectionRanges && selectionRanges.length) return selectionRanges
    return null
  }

  public async selectRange(visualmode: string, forward: boolean): Promise<void> {
    let { nvim } = this
    let positions: Position[] = []
    let bufnr = await nvim.call('bufnr', '%')
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    if (!forward && (!this.selectionRange || !visualmode)) return
    if (visualmode) {
      let range = await workspace.getSelectedRange(visualmode, doc)
      positions.push(range.start, range.end)
    } else {
      let position = await workspace.getCursorPosition()
      positions.push(position)
    }
    if (!forward) {
      let curr = Range.create(positions[0], positions[1])
      let { selectionRange } = this
      while (selectionRange && selectionRange.parent) {
        if (equals(selectionRange.parent.range, curr)) {
          break
        }
        selectionRange = selectionRange.parent
      }
      if (selectionRange && selectionRange.parent) {
        await workspace.selectRange(selectionRange.range)
      }
      return
    }
    let token = this.getRequestToken('selection ranges')
    let selectionRanges: SelectionRange[] = await languages.getSelectionRanges(doc.textDocument, positions, token)
    if (token.isCancellationRequested) return
    if (this.checkEmpty('selection ranges', selectionRanges)) return
    let mode = await nvim.eval('mode()')
    if (mode != 'n') await nvim.eval(`feedkeys("\\<Esc>", 'in')`)
    let selectionRange: SelectionRange
    if (selectionRanges.length == 1) {
      selectionRange = selectionRanges[0]
    } else if (positions.length > 1) {
      let r = Range.create(positions[0], positions[1])
      selectionRange = selectionRanges[0]
      while (selectionRange) {
        if (equals(r, selectionRange.range)) {
          selectionRange = selectionRange.parent
          continue
        }
        if (positionInRange(positions[1], selectionRange.range) == 0) {
          break
        }
        selectionRange = selectionRange.parent
      }
    }
    if (!selectionRange) return
    this.selectionRange = selectionRanges[0]
    await workspace.selectRange(selectionRange.range)
  }

  public async codeActionRange(start: number, end: number, only?: string): Promise<void> {
    let doc = await workspace.document
    if (!doc) return
    await wait(10)
    await synchronizeDocument(doc)
    let line = doc.getline(end - 1)
    let range = Range.create(start - 1, 0, end - 1, line.length)
    let codeActions = await this.getCodeActions(doc.bufnr, range, only ? [only] : null)
    if (!codeActions || codeActions.length == 0) {
      workspace.showMessage(`No${only ? ' ' + only : ''} code action available`, 'warning')
      return
    }
    let idx = await workspace.showQuickpick(codeActions.map(o => o.title))
    let action = codeActions[idx]
    if (action) await this.applyCodeAction(action)
  }

  /**
   * Refactor of current symbol
   */
  public async doRefactor(): Promise<void> {
    let [bufnr, cursor, filetype] = await this.nvim.eval('[bufnr("%"),coc#util#cursor(),&filetype]') as [number, [number, number], string]
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    let position = { line: cursor[0], character: cursor[1] }
    let token = this.getRequestToken('refactor')
    try {
      let res = await languages.prepareRename(doc.textDocument, position, token)
      if (token.isCancellationRequested) return
      if (res === false) {
        this.requestStatusItem.hide()
        workspace.showMessage('Invalid position for rename', 'warning')
        return
      }
      let edit = await languages.provideRenameEdits(doc.textDocument, position, 'NewName', token)
      if (token.isCancellationRequested) return
      this.requestStatusItem.hide()
      if (!edit) {
        workspace.showMessage('Empty workspaceEdit from server', 'warning')
        return
      }
      let refactor = await Refactor.createFromWorkspaceEdit(edit, filetype)
      if (!refactor.buffer) return
      this.refactorMap.set(refactor.buffer.id, refactor)
    } catch (e) {
      this.requestStatusItem.hide()
      workspace.showMessage(`Error on refactor ${e.message}`, 'error')
      logger.error(e)
    }
  }

  public async saveRefactor(bufnr: number): Promise<void> {
    let refactor = this.refactorMap.get(bufnr)
    if (refactor) {
      await refactor.saveRefactor()
    }
  }

  public async search(args: string[]): Promise<void> {
    let cwd = await this.nvim.call('getcwd')
    let refactor = new Refactor()
    await refactor.createRefactorBuffer()
    if (!refactor.buffer) return
    this.refactorMap.set(refactor.buffer.id, refactor)
    let search = new Search(this.nvim)
    search.run(args, cwd, refactor).logError()
  }

  private async previewHover(hovers: Hover[]): Promise<void> {
    let lines: string[] = []
    let target = this.preferences.hoverTarget
    let i = 0
    let docs: Documentation[] = []
    for (let hover of hovers) {
      let { contents } = hover
      if (i > 0) lines.push('---')
      if (Array.isArray(contents)) {
        for (let item of contents) {
          if (typeof item === 'string') {
            if (item.trim().length) {
              lines.push(...item.split('\n'))
              docs.push({ content: item, filetype: 'markdown' })
            }
          } else {
            let content = item.value.trim()
            if (target == 'preview') {
              content = '``` ' + item.language + '\n' + content + '\n```'
            }
            lines.push(...content.trim().split('\n'))
            docs.push({ filetype: item.language, content: item.value })
          }
        }
      } else if (typeof contents == 'string') {
        lines.push(...contents.split('\n'))
        docs.push({ content: contents, filetype: 'markdown' })
      } else if (MarkedString.is(contents)) {
        let content = contents.value.trim()
        if (target == 'preview') {
          content = '``` ' + contents.language + '\n' + content + '\n```'
        }
        lines.push(...content.split('\n'))
        docs.push({ filetype: contents.language, content: contents.value })
      } else if (MarkupContent.is(contents)) {
        lines.push(...contents.value.split('\n'))
        docs.push({ filetype: contents.kind == 'markdown' ? 'markdown' : 'txt', content: contents.value })
      }
      i++
    }
    if (target == 'echo') {
      const msg = lines.join('\n').trim()
      if (msg.length) {
        await this.nvim.call('coc#util#echo_hover', msg)
      }
    } else if (target == 'float') {
      diagnosticManager.hideFloat()
      await this.hoverFactory.create(docs)
    } else {
      this.documentLines = lines
      let arr = await this.nvim.call('getcurpos') as number[]
      this.hoverPosition = [workspace.bufnr, arr[1], arr[2]]
      await this.nvim.command(`pedit coc://document`)
    }
  }

  private getPreferences(): void {
    let config = workspace.getConfiguration('coc.preferences')
    let hoverTarget = config.get<string>('hoverTarget', 'float')
    if (hoverTarget == 'float' && !workspace.env.floating && !workspace.env.textprop) {
      hoverTarget = 'preview'
    }
    let signatureConfig = workspace.getConfiguration('signature')
    let signatureHelpTarget = signatureConfig.get<string>('target', 'float')
    if (signatureHelpTarget == 'float' && !workspace.floatSupported) {
      signatureHelpTarget = 'echo'
    }
    this.labels = workspace.getConfiguration('suggest').get<any>('completionItemKindLabels', {})
    this.preferences = {
      hoverTarget,
      signatureHelpTarget,
      signatureMaxHeight: signatureConfig.get<number>('maxWindowHeight', 8),
      triggerSignatureHelp: signatureConfig.get<boolean>('enable', true),
      triggerSignatureWait: Math.max(signatureConfig.get<number>('triggerSignatureWait', 50), 50),
      signaturePreferAbove: signatureConfig.get<boolean>('preferShownAbove', true),
      signatureFloatMaxWidth: signatureConfig.get<number>('floatMaxWidth', 60),
      signatureHideOnChange: signatureConfig.get<boolean>('hideOnTextChange', false),
      formatOnType: config.get<boolean>('formatOnType', false),
      formatOnTypeFiletypes: config.get('formatOnTypeFiletypes', []),
      formatOnInsertLeave: config.get<boolean>('formatOnInsertLeave', false),
      bracketEnterImprove: config.get<boolean>('bracketEnterImprove', true),
      previewMaxHeight: config.get<number>('previewMaxHeight', 12),
      previewAutoClose: config.get<boolean>('previewAutoClose', false),
      currentFunctionSymbolAutoUpdate: config.get<boolean>('currentFunctionSymbolAutoUpdate', false),
    }
  }

  private checkEmpty(name: string, location: any | null): boolean {
    if (this.requestTokenSource) {
      this.requestTokenSource.dispose()
      this.requestTokenSource = undefined
    }
    this.requestStatusItem.hide()
    if (location == null) {
      workspace.showMessage(`${name} provider not found for current buffer`, 'warning')
      return true
    }
    if (Array.isArray(location) && location.length == 0) {
      workspace.showMessage(`${name} not found`, 'warning')
      return true
    }
    return false
  }

  public dispose(): void {
    this.colors.dispose()
    disposeAll(this.disposables)
  }
}

function getPreviousContainer(containerName: string, symbols: SymbolInfo[]): SymbolInfo {
  if (!symbols.length) return null
  let i = symbols.length - 1
  let last = symbols[i]
  if (last.text == containerName) {
    return last
  }
  while (i >= 0) {
    let sym = symbols[i]
    if (sym.text == containerName) {
      return sym
    }
    i--
  }
  return null
}

function sortDocumentSymbols(a: DocumentSymbol, b: DocumentSymbol): number {
  let ra = a.selectionRange
  let rb = b.selectionRange
  if (ra.start.line < rb.start.line) {
    return -1
  }
  if (ra.start.line > rb.start.line) {
    return 1
  }
  return ra.start.character - rb.start.character
}

function addDoucmentSymbol(res: SymbolInfo[], sym: DocumentSymbol, level: number): void {
  let { name, selectionRange, kind, children, range } = sym
  let { start } = selectionRange
  res.push({
    col: start.character + 1,
    lnum: start.line + 1,
    text: name,
    level,
    kind: getSymbolKind(kind),
    range,
    selectionRange
  })
  if (children && children.length) {
    children.sort(sortDocumentSymbols)
    for (let sym of children) {
      addDoucmentSymbol(res, sym, level + 1)
    }
  }
}

function sortSymbolInformations(a: SymbolInformation, b: SymbolInformation): number {
  let sa = a.location.range.start
  let sb = b.location.range.start
  let d = sa.line - sb.line
  return d == 0 ? sa.character - sb.character : d

}

function isDocumentSymbol(a: DocumentSymbol | SymbolInformation): a is DocumentSymbol {
  return a && !a.hasOwnProperty('location')
}

function isDocumentSymbols(a: DocumentSymbol[] | SymbolInformation[]): a is DocumentSymbol[] {
  return isDocumentSymbol(a[0])
}

async function synchronizeDocument(doc: Document): Promise<void> {
  let { changedtick } = doc
  await doc.patchChange()
  if (changedtick != doc.changedtick) {
    await wait(50)
  }
}

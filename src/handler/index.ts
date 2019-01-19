import { NeovimClient as Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CodeAction, Definition, Disposable, DocumentHighlight, DocumentLink, DocumentSymbol, ExecuteCommandParams, ExecuteCommandRequest, Hover, Location, MarkedString, MarkupContent, Position, Range, SymbolInformation, SymbolKind, TextDocument, DocumentHighlightKind, CodeActionContext, CodeActionKind, LocationLink } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import CodeLensManager from './codelens'
import Colors from './colors'
import commandManager from '../commands'
import diagnosticManager from '../diagnostic/manager'
import snippetManager from '../snippets/manager'
import events from '../events'
import extensions from '../extensions'
import languages from '../languages'
import { TextDocumentContentProvider } from '../provider'
import services from '../services'
import { disposeAll, wait } from '../util'
import { isWord, indexOf } from '../util/string'
import workspace from '../workspace'
import Document from '../model/document'
const logger = require('../util/logger')('Handler')

interface SymbolInfo {
  filepath?: string
  lnum: number
  col: number
  text: string
  kind: string
  level?: number
  containerName?: string
  selectionRange: Range
  range?: Range
}

interface CommandItem {
  id: string
  title: string
}

interface SignaturePart {
  text: string
  type: 'Label' | 'MoreMsg' | 'Normal'
}

export default class Handler {
  public showSignatureHelp: Function & { clear: () => void }
  /*bufnr and srcId list*/
  private highlightsMap: Map<number, number[]> = new Map()
  private highlightNamespace = 0
  private colors: Colors
  private documentLines: string[] = []
  private currentSymbols: SymbolInformation[]
  private codeLensManager: CodeLensManager
  private disposables: Disposable[] = []

  constructor(private nvim: Neovim) {
    this.showSignatureHelp = debounce(() => {
      this._showSignatureHelp().catch(e => {
        logger.error(e.stack)
      })
    }, 100)
    workspace.createNameSpace('coc-highlight').then(id => { // tslint:disable-line
      this.highlightNamespace = id
    })

    let timer: NodeJS.Timer
    events.on('InsertCharPre', async ch => {
      if (isWord(ch)) return
      let doc = await workspace.document
      if (doc && languages.shouldTriggerSignatureHelp(doc.textDocument, ch)) {
        let config = workspace.getConfiguration('coc.preferences')
        let triggerSignatureHelp = config.get<boolean>('triggerSignatureHelp', true)
        if (triggerSignatureHelp) {
          await wait(100)
          this.showSignatureHelp()
        }
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        await this.onCharacterType(ch, doc.bufnr)
      }, 40)
    }, null, this.disposables)
    events.on('TextChangedI', async bufnr => {
      let doc = workspace.getDocument(bufnr)
      if (!doc) return
      if (doc.lastChange == 'insert') {
        let line: string = await nvim.call('getline', '.')
        if (line.trim() == '') await this.onCharacterType('\n', bufnr)
      }
    }, null, this.disposables)
    events.on('InsertLeave', async () => {
      let buf = await nvim.buffer
      let { mode } = await nvim.mode
      if (mode != 'n') return
      let line = await nvim.call('getline', '.')
      if (/^\s*$/.test(line)) return
      await this.onCharacterType('\n', buf.id, true)
    }, null, this.disposables)
    events.on('BufWinLeave', bufnr => {
      this.clearHighlight(bufnr)
    }, null, this.disposables)
    events.on('BufUnload', async bufnr => {
      this.clearHighlight(bufnr)
    }, null, this.disposables)
    events.on('InsertEnter', () => {
      this.clearHighlight(workspace.bufnr)
    }, null, this.disposables)

    let provider: TextDocumentContentProvider = {
      onDidChange: null,
      provideTextDocumentContent: async () => {
        nvim.pauseNotification()
        nvim.command('setlocal conceallevel=2 nospell nofoldenable wrap', true)
        nvim.command('setlocal bufhidden=wipe nobuflisted', true)
        nvim.command('setfiletype markdown', true)
        nvim.command(`exe "normal! z${this.documentLines.length}\\<cr>"`, true)
        nvim.resumeNotification()
        return this.documentLines.join('\n')
      }
    }
    this.disposables.push(workspace.registerTextDocumentContentProvider('coc', provider))
    this.disposables.push(Disposable.create(() => {
      this.showSignatureHelp.clear()
    }))
    this.codeLensManager = new CodeLensManager(nvim)
    this.colors = new Colors(nvim)
  }

  public async onHover(): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    let hover = await languages.getHover(document, position)
    if (hover) {
      await this.previewHover(hover)
    } else {
      workspace.showMessage('Hover not found', 'warning')
    }
  }

  public async gotoDefinition(openCommand?: string): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    let definition = await languages.getDefinition(document, position)
    if (definition && definition.length != 0) {
      await this.handleLocations(definition, openCommand)
    } else {
      workspace.showMessage('Definition not found', 'warning')
    }
  }

  public async gotoDeclaration(openCommand?: string): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    let definition = await languages.getDeclaration(document, position)
    if (!definition) {
      workspace.showMessage('Definition not found', 'warning')
      return
    }
    await this.handleLocations(definition, openCommand)
  }

  public async gotoTypeDefinition(openCommand?: string): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    let definition = await languages.getTypeDefinition(document, position)
    if (definition && definition.length != 0) {
      await this.handleLocations(definition, openCommand)
    } else {
      workspace.showMessage('Type definition not found', 'warning')
    }
  }

  public async gotoImplementation(openCommand?: string): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    let definition = await languages.getImplementation(document, position)
    if (definition && definition.length != 0) {
      await this.handleLocations(definition, openCommand)
    } else {
      workspace.showMessage('Implementation not found', 'warning')
    }
  }

  public async gotoReferences(openCommand?: string): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    let locs = await languages.getReferences(document, { includeDeclaration: false }, position)
    if (locs && locs.length) {
      await this.handleLocations(locs, openCommand)
    } else {
      workspace.showMessage('References not found', 'warning')
    }
  }

  public async getDocumentSymbols(): Promise<SymbolInfo[]> {
    let document = await workspace.document
    if (!document) return []
    let symbols = await languages.getDocumentSymbol(document.textDocument)
    if (!symbols || symbols.length == 0) return []
    let isSymbols = !symbols[0].hasOwnProperty('location')
    let level = 0
    let res: SymbolInfo[] = []
    let pre = null
    if (isSymbols) {
      (symbols as DocumentSymbol[]).sort(sortSymbols)
      for (let sym of symbols) {
        addDoucmentSymbol(res, sym as DocumentSymbol, level)
      }
    } else {
      (symbols as SymbolInformation[]).sort((a, b) => {
        let sa = a.location.range.start
        let sb = b.location.range.start
        let d = sa.line - sb.line
        return d == 0 ? sa.character - sb.character : d
      })
      for (let sym of symbols) {
        let { name, kind, location, containerName } = sym as SymbolInformation
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
          selectionRange: location.range,
          containerName
        }
        res.push(o)
        pre = o
      }
    }
    return res
  }

  public async getWorkspaceSymbols(): Promise<SymbolInfo[]> {
    let document = await workspace.document
    if (!document) return
    let cword = await this.nvim.call('expand', '<cword>')
    let query = await this.nvim.call('input', ['Query:', cword])
    let symbols = await languages.getWorkspaceSymbols(document.textDocument, query)
    if (!symbols) {
      workspace.showMessage('service does not support workspace symbols', 'error')
      return []
    }
    this.currentSymbols = symbols
    let res: SymbolInfo[] = []
    for (let s of symbols) {
      if (!this.validWorkspaceSymbol(s)) continue
      let { name, kind, location } = s
      let { start } = location.range
      res.push({
        filepath: Uri.parse(location.uri).fsPath,
        col: start.character + 1,
        lnum: start.line + 1,
        text: name,
        kind: getSymbolKind(kind),
        selectionRange: location.range
      })
    }
    return res
  }

  public async resolveWorkspaceSymbol(symbolIndex: number): Promise<SymbolInformation> {
    if (!this.currentSymbols) return null
    let symbol = this.currentSymbols[symbolIndex]
    if (!symbol) return null
    return await languages.resolveWorkspaceSymbol(symbol)
  }

  public async rename(): Promise<void> {
    let { nvim } = this
    let { document, position } = await workspace.getCurrentState()
    if (!document) return
    let res = await languages.prepareRename(document, position)
    if (res === false) {
      workspace.showMessage('Invalid position for rename', 'error')
      return
    }
    let curname: string
    if (res == null) {
      curname = await nvim.call('expand', '<cword>')
    } else {
      if (Range.is(res)) {
        let doc = workspace.getDocument(document.uri)
        let line = doc.getline(res.start.line)
        curname = line.slice(res.start.character, res.end.character)
      } else {
        curname = res.placeholder
      }
    }
    if (!curname) return
    let newName = await nvim.call('input', ['new name:', curname])
    nvim.command('normal! :<C-u>', true)
    if (!newName) {
      workspace.showMessage('Empty word, canceled', 'warning')
      return
    }
    let edit = await languages.provideRenameEdits(document, position, newName)
    if (!edit) return
    await workspace.applyEdit(edit)
  }

  public async documentFormatting(): Promise<void> {
    let document = await workspace.document
    if (!document) return
    let options = await workspace.getFormatOptions()
    let textEdits = await languages.provideDocumentFormattingEdits(document.textDocument, options)
    if (!textEdits || textEdits.length == 0) return
    await document.applyEdits(this.nvim, textEdits)
  }

  public async documentRangeFormatting(mode: string): Promise<number> {
    let document = await workspace.document
    if (!document) return -1
    let range: Range
    if (mode) {
      range = await this.getSelectedRange(mode, document.textDocument)
      if (!range) return -1
    } else {
      let lnum = await this.nvim.getVvar('lnum') as number
      let count = await this.nvim.getVvar('count') as number
      let mode = await this.nvim.call('mode')
      // we can't handle
      if (count == 0 || mode == 'i' || mode == 'R') return -1
      range = Range.create(lnum - 1, 0, lnum - 1 + count, 0)
    }
    let options = await workspace.getFormatOptions()
    let textEdits = await languages.provideDocumentRangeFormattingEdits(document.textDocument, range, options)
    if (!textEdits) return - 1
    await document.applyEdits(this.nvim, textEdits)
  }

  public async runCommand(id?: string, ...args: any[]): Promise<void> {
    if (id) {
      await events.fire('Command', [id])
      if (!commandManager.has(id)) {
        return workspace.showMessage(`Command '${id}' not found`, 'error')
      }
      commandManager.executeCommand(id, ...args)
    } else {
      let cmds = await this.getCommands()
      let ids = cmds.map(o => o.id)
      let idx = await workspace.showQuickpick(ids)
      if (idx == -1) return
      commandManager.executeCommand(ids[idx])
    }
  }

  public async doCodeAction(mode: string | null, only?: CodeActionKind[]): Promise<void> {
    let document = await workspace.document
    if (!document) return
    let range: Range
    if (mode) {
      range = await this.getSelectedRange(mode, document.textDocument)
    } else {
      let lnum = await this.nvim.call('line', ['.'])
      range = {
        start: { line: lnum - 1, character: 0 },
        end: { line: lnum, character: 0 }
      }
    }
    let diagnostics = diagnosticManager.getDiagnosticsInRange(document.textDocument, range)
    let context: CodeActionContext = { diagnostics }
    if (only) context.only = only
    let codeActionsMap = await languages.getCodeActions(document.textDocument, range, context)
    if (!codeActionsMap) return workspace.showMessage('No action available', 'warning')
    let codeActions: CodeAction[] = []
    for (let clientId of codeActionsMap.keys()) {
      let actions = codeActionsMap.get(clientId)
      for (let action of actions) {
        (action as any).clientId = clientId
        codeActions.push(action)
      }
    }
    let idx = await workspace.showQuickpick(codeActions.map(o => o.title))
    if (idx == -1) return
    let action = codeActions[idx]
    if (action) await this.applyCodeAction(action)
  }

  /**
   * Get all quickfix actions of current buffer
   *
   * @public
   * @returns {Promise<CodeAction[]>}
   */
  public async getQuickfixActions(range?: Range): Promise<CodeAction[]> {
    let document = await workspace.document
    if (!document) return []
    range = range || Range.create(0, 0, document.lineCount, 0)
    let diagnostics = diagnosticManager.getDiagnosticsInRange(document.textDocument, range)
    let context: CodeActionContext = { diagnostics, only: [CodeActionKind.QuickFix] }
    let codeActionsMap = await languages.getCodeActions(document.textDocument, range, context, true)
    if (!codeActionsMap) return []
    let codeActions: CodeAction[] = []
    for (let clientId of codeActionsMap.keys()) {
      let actions = codeActionsMap.get(clientId)
      for (let action of actions) {
        if (action.kind !== CodeActionKind.QuickFix) continue
        (action as any).clientId = clientId
        codeActions.push(action)
      }
    }
    return codeActions
  }

  public async doQuickfix(): Promise<void> {
    let lnum = await this.nvim.call('line', ['.'])
    let range: Range = {
      start: { line: lnum - 1, character: 0 },
      end: { line: lnum, character: 0 }
    }
    let actions = await this.getQuickfixActions(range)
    if (!actions || actions.length == 0) {
      return workspace.showMessage('No action available', 'warning')
    }
    await this.applyCodeAction(actions[0])
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

  public async fold(kind?: string): Promise<void> {
    let document = await workspace.document
    let win = await this.nvim.window
    let foldmethod = await win.getOption('foldmethod')
    if (foldmethod != 'manual') {
      workspace.showMessage('foldmethod option should be manual!', 'error')
      return
    }
    let ranges = await languages.provideFoldingRanges(document.textDocument, {})
    if (!ranges || ranges.length == 0) {
      workspace.showMessage('no range found', 'warning')
      return
    }
    if (kind) {
      ranges = ranges.filter(o => o.kind == kind)
    }
    if (ranges && ranges.length) {
      await win.setOption('foldenable', true)
      for (let range of ranges.reverse()) {
        let { startLine, endLine } = range
        let cmd = `${startLine + 1}, ${endLine + 1}fold`
        this.nvim.command(cmd, true)
      }
    }
  }

  public async pickColor(): Promise<void> {
    await this.colors.pickColor()
  }

  public async pickPresentation(): Promise<void> {
    await this.colors.pickPresentation()
  }

  private async highlightDocument(document: Document): Promise<void> {
    let position = await workspace.getCursorPosition()
    let line = document.getline(position.line)
    let ch = line[position.character]
    if (!ch || !document.isWord(ch)) {
      this.clearHighlight(document.bufnr)
      return
    }
    let highlights: DocumentHighlight[] = await languages.getDocumentHighLight(document.textDocument, position)
    let newPosition = await workspace.getCursorPosition()
    if (position.line != newPosition.line || position.character != newPosition.character) {
      return
    }
    let ids = this.highlightsMap.get(document.bufnr)
    this.nvim.pauseNotification()
    if (ids && ids.length) {
      this.clearHighlight(document.bufnr)
    }
    if (highlights && highlights.length) {
      let groups: { [index: string]: Range[] } = {}
      for (let hl of highlights) {
        let hlGroup = hl.kind == DocumentHighlightKind.Text
          ? 'CocHighlightText'
          : hl.kind == DocumentHighlightKind.Read ? 'CocHighlightRead' : 'CocHighlightWrite'
        groups[hlGroup] = groups[hlGroup] || []
        groups[hlGroup].push(hl.range)
      }
      let ids = []
      for (let hlGroup of Object.keys(groups)) {
        let ranges = groups[hlGroup]
        let arr = await document.highlightRanges(ranges, hlGroup, this.highlightNamespace)
        ids.push(...arr)
        this.highlightsMap.set(document.bufnr, ids)
      }
    }
    this.nvim.resumeNotification()
    if (workspace.isVim) {
      this.nvim.command('redraw', true)
    }
  }

  public async highlight(): Promise<void> {
    let document = workspace.getDocument(workspace.bufnr)
    if (!document) return
    await this.highlightDocument(document)
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
      if (withIn(link.range, position)) {
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
  }

  private validWorkspaceSymbol(symbol: SymbolInformation): boolean {
    switch (symbol.kind) {
      case SymbolKind.Namespace:
      case SymbolKind.Class:
      case SymbolKind.Module:
      case SymbolKind.Method:
      case SymbolKind.Package:
      case SymbolKind.Interface:
      case SymbolKind.Function:
      case SymbolKind.Constant:
        return true
      default:
        return false
    }
  }

  public async getCommands(): Promise<CommandItem[]> {
    let list = commandManager.commandList
    let res: CommandItem[] = []
    let document = await workspace.document
    if (!document) return []
    let { commands } = extensions
    for (let key of Object.keys(commands)) {
      res.push({
        id: key,
        title: commands[key] || ''
      })
    }
    for (let o of list) {
      if (commands[o.id] == null) {
        res.push({ id: o.id, title: '' })
      }
    }
    return res
  }

  public dispose(): void {
    this.colors.dispose()
    disposeAll(this.disposables)
  }

  private async onCharacterType(ch: string, bufnr: number, insertLeave = false): Promise<void> {
    let config = workspace.getConfiguration('coc.preferences')
    let formatOnType = config.get<boolean>('formatOnType')
    if (!formatOnType || snippetManager.session) return
    let doc = workspace.getDocument(bufnr)
    if (!doc || doc.paused || workspace.bufnr != bufnr) return
    if (!languages.hasOnTypeProvider(ch, doc.textDocument)) return
    let position = await workspace.getCursorPosition()
    let origLine = doc.getline(position.line)
    let { changedtick, dirty } = doc
    if (dirty) {
      doc.forceSync()
      await wait(30)
    }
    let pos: Position = insertLeave ? { line: position.line + 1, character: 0 } : position
    try {
      let edits = await languages.provideDocumentOntTypeEdits(ch, doc.textDocument, pos)
      // changed by other process
      if (doc.changedtick != changedtick) return
      if (insertLeave) {
        edits = edits.filter(edit => {
          return edit.range.start.line < position.line + 1
        })
      }
      if (edits && edits.length) {
        await doc.applyEdits(this.nvim, edits)
        let newLine = doc.getline(position.line)
        if (newLine.length > origLine.length) {
          let character = position.character + (newLine.length - origLine.length)
          await workspace.moveTo(Position.create(position.line, character))
        }
      }
    } catch (e) {
      if (!/timeout\safter/.test(e.message)) {
        throw e
      }
    }
  }

  private async _showSignatureHelp(): Promise<void> {
    let position = await workspace.getCursorPosition()
    let document = await workspace.document
    let visible = await this.nvim.call('pumvisible')
    if (visible) return
    let part = document.getline(position.line).slice(0, position.character)
    let idx = Math.max(part.lastIndexOf(','), part.lastIndexOf('('))
    if (idx != -1) position.character = idx + 1
    let signatureHelp = await languages.getSignatureHelp(document.textDocument, position)
    if (!signatureHelp) return
    let { activeParameter, activeSignature, signatures } = signatureHelp
    if (activeSignature) {
      // make active first
      let [active] = signatures.splice(activeSignature, 1)
      if (active) signatures.unshift(active)
    }
    let height = await this.nvim.getOption('cmdheight') as number
    let columns = await this.nvim.getOption('columns') as number
    signatures = signatures.slice(0, height)
    if (signatures.length == 0) return
    let signatureList: SignaturePart[][] = []
    for (let signature of signatures) {
      let parts: SignaturePart[] = []
      let { label } = signature
      if (label.length >= columns) {
        label = label.slice(0, columns - 4) + '...'
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
              let startIndex = activeParameter == 0 ? 0 : indexOf(after, ',', activeParameter)
              startIndex = startIndex == -1 ? 0 : startIndex
              let str = after.slice(startIndex)
              let ms = str.match(new RegExp('\\b' + active.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'))
              let idx = ms ? ms.index : str.indexOf(active.label)
              if (idx == -1) {
                parts.push({ text: after, type: 'Normal' })
                continue
              }
              start = idx + startIndex
              end = idx + startIndex + active.label.length
            } else {
              [start, end] = active.label
              start = start - nameIndex
              end = end - nameIndex
            }
            parts.push({ text: after.slice(0, start), type: 'Normal' })
            parts.push({ text: after.slice(start, end), type: 'MoreMsg' })
            parts.push({ text: after.slice(end), type: 'Normal' })
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
    this.nvim.command('echo ""', true)
    await this.nvim.call('coc#util#echo_signatures', [signatureList])
  }

  public async handleLocations(definition: Definition | LocationLink[], openCommand?: string): Promise<void> {
    if (!definition) return
    if (Array.isArray(definition)) {
      let len = definition.length
      if (len == 0) return
      if (len == 1) {
        let location = definition[0] as Location
        if (LocationLink.is(definition[0])) {
          let link = definition[0] as LocationLink
          location = Location.create(link.targetUri, link.targetRange)
        }
        let { uri, range } = location
        await workspace.jumpTo(uri, range.start, openCommand)
      } else {
        await workspace.showLocations(definition as Location[])
      }
    } else {
      let { uri, range } = definition as Location
      await workspace.jumpTo(uri, range.start, openCommand)
    }
  }

  private async getSelectedRange(mode: string, document: TextDocument): Promise<Range> {
    let { nvim } = this
    if (['v', 'V', 'char', 'line'].indexOf(mode) == -1) {
      workspace.showMessage(`Mode '${mode}' is not supported`, 'error')
      return
    }
    let isVisual = ['v', 'V'].indexOf(mode) != -1
    let c = isVisual ? '<' : '['
    await nvim.command('normal! `' + c)
    let start = await workspace.getOffset()
    c = isVisual ? '>' : ']'
    await nvim.command('normal! `' + c)
    let end = await workspace.getOffset() + 1
    if (start == null || end == null || start == end) {
      workspace.showMessage(`Failed to get selected range`, 'error')
      return
    }
    return {
      start: document.positionAt(start),
      end: document.positionAt(end)
    }
  }

  private async previewHover(hover: Hover): Promise<void> {
    let { contents } = hover
    let lines: string[] = []
    let config = workspace.getConfiguration('coc.preferences')
    let target = config.get<string>('hoverTarget', 'preview')
    if (Array.isArray(contents)) {
      for (let item of contents) {
        if (typeof item === 'string') {
          lines.push(...item.split('\n'))
        } else {
          let content = item.value.trim()
          if (target == 'preview') {
            content = '``` ' + item.language + '\n' + content + '\n```'
          }
          lines.push(...content.split('\n'))
        }
      }
    } else if (typeof contents == 'string') {
      lines.push(...contents.split('\n'))
    } else if (MarkedString.is(contents)) { // tslint:disable-line
      let content = contents.value.trim()
      if (target == 'preview') {
        content = '``` ' + contents.language + '\n' + content + '\n```'
      }
      lines.push(...content.split('\n'))
    } else if (MarkupContent.is(contents)) {
      lines.push(...contents.value.split('\n'))
    }
    if (target == 'echo') {
      await this.nvim.call('coc#util#echo_hover', lines.join('\n').trim())
    } else {
      this.documentLines = lines
      await this.nvim.command(`pedit coc://document`)
    }
  }

  private clearHighlight(bufnr: number): void {
    let doc = workspace.getDocument(bufnr)
    let ids = this.highlightsMap.get(bufnr)
    if (ids && ids.length) {
      this.highlightsMap.delete(bufnr)
      if (doc) doc.clearMatchIds(ids)
    }
  }
}

function getSymbolKind(kind: SymbolKind): string {
  switch (kind) {
    case SymbolKind.File:
      return 'File'
    case SymbolKind.Module:
      return 'Module'
    case SymbolKind.Namespace:
      return 'Namespace'
    case SymbolKind.Package:
      return 'Package'
    case SymbolKind.Class:
      return 'Class'
    case SymbolKind.Method:
      return 'Method'
    case SymbolKind.Property:
      return 'Property'
    case SymbolKind.Field:
      return 'Field'
    case SymbolKind.Constructor:
      return 'Constructor'
    case SymbolKind.Enum:
      return 'Enum'
    case SymbolKind.Interface:
      return 'Interface'
    case SymbolKind.Function:
      return 'Function'
    case SymbolKind.Variable:
      return 'Variable'
    case SymbolKind.Constant:
      return 'Constant'
    case SymbolKind.String:
      return 'String'
    case SymbolKind.Number:
      return 'Number'
    case SymbolKind.Boolean:
      return 'Boolean'
    case SymbolKind.Array:
      return 'Array'
    case SymbolKind.Object:
      return 'Object'
    case SymbolKind.Key:
      return 'Key'
    case SymbolKind.Null:
      return 'Null'
    case SymbolKind.EnumMember:
      return 'EnumMember'
    case SymbolKind.Struct:
      return 'Struct'
    case SymbolKind.Event:
      return 'Event'
    case SymbolKind.Operator:
      return 'Operator'
    case SymbolKind.TypeParameter:
      return 'TypeParameter'
    default:
      return 'Unknown'
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

function sortSymbols(a: DocumentSymbol, b: DocumentSymbol): number {
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
    children.sort(sortSymbols)
    for (let sym of children) {
      addDoucmentSymbol(res, sym, level + 1)
    }
  }
}

function withIn(range: Range, position: Position): boolean {
  let { start, end } = range
  let { line, character } = position
  if (line < start.line || line > end.line) return false
  if (line == start.line && character < start.character) return false
  if ((line == end.line && character > end.character)) return false
  return true
}

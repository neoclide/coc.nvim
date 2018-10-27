import { NeovimClient as Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { Definition, Disposable, DocumentHighlight, DocumentLink, DocumentSymbol, Hover, Location, MarkedString, MarkupContent, Position, Range, SymbolInformation, SymbolKind, TextDocument } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import CodeLensBuffer from './codelens'
import commandManager from './commands'
import diagnosticManager from './diagnostic/manager'
import events from './events'
import languages from './languages'
import { disposeAll, wait } from './util'
import workspace from './workspace'
import extensions from './extensions'
import completion from './completion'
import { TextDocumentContentProvider } from './provider'
const logger = require('./util/logger')('Handler')

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

export default class Handler {
  public showSignatureHelp: Function & { clear: () => void }
  private documentLines: string[] = []
  private currentSymbols: SymbolInformation[]
  private codeLensBuffers: Map<number, CodeLensBuffer> = new Map()
  private disposables: Disposable[] = []
  // codeLens instances

  constructor(private nvim: Neovim) {
    this.showSignatureHelp = debounce(() => {
      this._showSignatureHelp().catch(e => {
        logger.error(e.stack)
      })
    }, 200)

    let lastChar = ''
    let lastTs = null
    events.on('InsertCharPre', ch => {
      lastChar = ch
      lastTs = Date.now()
    }, null, this.disposables)
    events.on('TextChangedI', async bufnr => {
      let doc = workspace.getDocument(bufnr)
      if (!doc) return
      let line: string = await nvim.call('getline', '.')
      let isEmpty = line.trim().length == 0
      if (Date.now() - lastTs < 40 && lastChar
        || (isEmpty && doc.lastChange == 'insert')) {
        let character = (isEmpty && doc.lastChange == 'insert') ? '\n' : lastChar
        lastChar = null
        await this.onCharacterType(character, bufnr)
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
    events.on('BufUnload', bufnr => {
      let codeLensBuffer = this.codeLensBuffers.get(bufnr)
      if (codeLensBuffer) {
        codeLensBuffer.dispose()
        this.codeLensBuffers.delete(bufnr)
      }
    }, null, this.disposables)
    let provider: TextDocumentContentProvider = {
      onDidChange: null,
      provideTextDocumentContent: async () => {
        await nvim.command('setlocal conceallevel=2 nospell nofoldenable wrap')
        await nvim.command('setfiletype markdown')
        let buf = await nvim.buffer
        await buf.setOption('bufhidden', 'wipe')
        await buf.setOption('buflisted', false)
        await nvim.command(`exe "normal! z${this.documentLines.length}\\<cr>"`)
        return this.documentLines.join('\n')
      }
    }
    this.disposables.push(workspace.registerTextDocumentContentProvider('coc', provider))
    this.disposables.push(Disposable.create(() => {
      this.showSignatureHelp.clear()
    }))
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

  public async gotoDefinition(): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    let definition = await languages.getDefinition(document, position)
    if (definition && definition.length != 0) {
      await this.handleDefinition(definition)
    } else {
      workspace.showMessage('Definition not found', 'warning')
    }
  }

  public async gotoTypeDefinition(): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    let definition = await languages.getTypeDefinition(document, position)
    if (definition && definition.length != 0) {
      await this.handleDefinition(definition)
    } else {
      workspace.showMessage('Type definition not found', 'warning')
    }
  }

  public async gotoImplementation(): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    let definition = await languages.getImplementation(document, position)
    if (definition && definition.length != 0) {
      await this.handleDefinition(definition)
    } else {
      workspace.showMessage('Implementation not found', 'warning')
    }
  }

  public async gotoReferences(): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    let locs = await languages.getReferences(document, { includeDeclaration: false }, position)
    if (locs && locs.length) {
      await this.handleDefinition(locs)
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

  public async documentRangeFormatting(mode: string): Promise<void> {
    let document = await workspace.document
    if (!document || !mode) return
    let range = await this.getSelectedRange(mode, document.textDocument)
    if (!range) return
    let options = await workspace.getFormatOptions()
    let textEdits = await languages.provideDocumentRangeFormattingEdits(document.textDocument, range, options)
    if (!textEdits) return
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

  public async doCodeAction(mode: string | null): Promise<void> {
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
    let context = { diagnostics }
    let codeActions = await languages.getCodeActions(document.textDocument, range, context)
    if (!codeActions || codeActions.length == 0) {
      return workspace.showMessage('No action available', 'warning')
    }
    let idx = await workspace.showQuickpick(codeActions.map(o => o.title))
    if (idx == -1) return
    let action = codeActions[idx]
    if (action) {
      let { command, edit } = action
      if (edit) await workspace.applyEdit(edit)
      if (command) commandManager.execute(command)
    }
  }

  public async doCodeLens(): Promise<void> {
    let { document } = await workspace.getCurrentState()
    if (!document) return
    let codeLens = await languages.getCodeLens(document)
    let buffer = await this.nvim.buffer
    let codeLensBuffer = new CodeLensBuffer(this.nvim, buffer.id, codeLens)
    this.codeLensBuffers.set(buffer.id, codeLensBuffer)
  }

  public async doCodeLensAction(): Promise<void> {
    let { nvim } = this
    let buffer = await nvim.buffer
    let bufnr = await buffer.getVar('bufnr')
    if (!bufnr) return
    let line = await nvim.call('getline', ['.'])
    let ms = line.match(/^\d+/)
    if (ms) {
      let codeLensBuffer = this.codeLensBuffers.get(Number(bufnr))
      if (codeLensBuffer) await codeLensBuffer.doAction(Number(ms[0]))
    }
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

  public async highlight(): Promise<void> {
    let document = await workspace.document
    if (!document) return
    let position = await workspace.getCursorPosition()
    let line = document.getline(position.line)
    let ch = line[position.character]
    if (!ch || !document.isWord(ch)) {
      document.clearHighlight()
      return
    }
    let highlights: DocumentHighlight[] = await languages.getDocumentHighLight(document.textDocument, position)
    if (!highlights || highlights.length == 0) {
      document.clearHighlight()
      return
    }
    await document.setHighlights(highlights)
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
        res.push()
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
    disposeAll(this.disposables)
  }

  private async onCharacterType(ch: string, bufnr: number, insertLeave = false): Promise<void> {
    let config = workspace.getConfiguration('coc.preferences')
    let formatOnType = config.get<boolean>('formatOnType')
    if (!formatOnType) return
    let doc = workspace.getDocument(bufnr)
    if (!doc || doc.paused || workspace.bufnr != bufnr) return
    if (!languages.hasOnTypeProvider(ch, doc.textDocument)) return
    let position = await workspace.getCursorPosition()
    let origLine = doc.getline(position.line)
    let { changedtick, dirty } = doc
    if (dirty) {
      await wait(20)
      doc.forceSync()
      await wait(20)
    }
    let pos: Position = insertLeave ? { line: position.line + 1, character: 0 } : position
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
    }
    let newLine = doc.getline(position.line)
    if (newLine.length > origLine.length) {
      let col = position.character + 1 + (newLine.length - origLine.length)
      await this.nvim.call('cursor', [position.line + 1, col])
    }
  }

  private async _showSignatureHelp(): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    let signatureHelp = await languages.getSignatureHelp(document, position)
    // let visible = await this.nvim.call('pumvisible')
    if (!signatureHelp || completion.isActivted) return
    let { activeParameter, activeSignature, signatures } = signatureHelp
    await this.nvim.command('echo ""')
    await this.nvim.call('coc#util#echo_signature', [activeParameter || 0, activeSignature || 0, signatures])
  }

  private async handleDefinition(definition: Definition): Promise<void> {
    if (!definition) return
    if (Array.isArray(definition)) {
      let len = definition.length
      if (len == 0) return
      if (len == 1) {
        let { uri, range } = definition[0] as Location
        await workspace.jumpTo(uri, range.start)
      } else {
        await this.addQuickfix(definition as Location[])
      }
    } else {
      let { uri, range } = definition as Location
      await workspace.jumpTo(uri, range.start)
    }
  }

  private async addQuickfix(locations: Location[]): Promise<void> {
    let items = await Promise.all(locations.map(loc => {
      return workspace.getQuickfixItem(loc)
    }))
    let { nvim } = this
    await nvim.call('setqflist', [[], ' ', { title: 'Results of coc', items }])
    await nvim.command('doautocmd User CocQuickfixChange')
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
    if (Array.isArray(contents)) {
      for (let item of contents) {
        if (typeof item === 'string') {
          lines.push(...item.split('\n'))
        } else {
          lines.push('``` ' + item.language)
          lines.push(...item.value.split('\n'))
          lines.push('```')
        }
      }
    } else if (typeof contents == 'string') {
      lines.push(...contents.split('\n'))
    } else if (MarkedString.is(contents)) { // tslint:disable-line
      lines.push('``` ' + contents.language)
      lines.push(...contents.value.split('\n'))
      lines.push('```')
    } else if (MarkupContent.is(contents)) {
      lines.push(...contents.value.split('\n'))
    }
    this.documentLines = lines
    await this.nvim.command(`pedit coc://document`)
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

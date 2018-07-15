import debounce from 'debounce'
import {Neovim} from 'neovim'
import {Definition, FormattingOptions, Hover, Location, MarkedString, MarkupContent, Range, SymbolInformation, SymbolKind, TextDocument} from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import CodeLensBuffer from './codelens'
import commandManager from './commands'
import diagnosticManager from './diagnostic/manager'
import languages from './languages'
import {ServiceStat} from './types'
import {echoErr, echoMessage, echoWarning, showQuickpick} from './util'
import workspace from './workspace'
const logger = require('./util/logger')('Handler')

interface SymbolInfo {
  lnum: number
  filepath: string
  col: number
  text: string
  kind: string
  level?: number
  containerName?: string
}

export default class Handler {
  public showSignatureHelp: () => void
  private currentSymbols: SymbolInformation[]
  private codeLensBuffers: Map<number, CodeLensBuffer> = new Map()
  // codeLens instances

  constructor(private nvim: Neovim, emitter, private services: import('./services').ServiceManager) {
    this.showSignatureHelp = debounce(() => {
      this._showSignatureHelp().catch(e => {
        logger.error(e.stack)
      })
    }, 100)
    emitter.on('BufUnload', bufnr => {
      let codeLensBuffer = this.codeLensBuffers.get(bufnr)
      if (codeLensBuffer) {
        codeLensBuffer.dispose()
        this.codeLensBuffers.delete(bufnr)
      }
    })
  }

  private async getSelectedRange(mode: string, document: TextDocument): Promise<Range> {
    let {nvim} = this
    if (['v', 'V', 'char', 'line'].indexOf(mode) == -1) {
      await echoErr(nvim, `Mode '${mode}' is not supported`)
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
      await echoErr(this.nvim, 'Failed to get selected range')
      return
    }
    return {
      start: document.positionAt(start),
      end: document.positionAt(end)
    }
  }

  private async previewHover(hover: Hover): Promise<void> {
    let {contents} = hover
    let lines: string[] = []
    if (Array.isArray(contents)) {
      for (let item of contents) {
        if (typeof item === 'string') {
          lines.push(item)
        } else {
          lines.push('``` ' + item.language)
          lines.push(item.value)
          lines.push('```')
        }
      }
    } else if (typeof contents == 'string') {
      lines.push(contents)
    } else if (MarkedString.is(contents)) { // tslint:disable-line
      lines.push('``` ' + contents.language)
      lines.push(contents.value)
      lines.push('```')
    } else if (MarkupContent.is(contents)) {
      lines.push(contents.value)
    }
    await this.nvim.call('coc#util#preview_info', [lines.join('\n')])
  }

  public async onHover(): Promise<void> {
    let {document, position} = await workspace.getCurrentState()
    if (!document) return
    let hover = await languages.getHover(document, position)
    if (!hover) return
    await this.previewHover(hover)
  }

  private async _showSignatureHelp(): Promise<void> {
    let {document, position} = await workspace.getCurrentState()
    if (!document) return
    let signatureHelp = await languages.getSignatureHelp(document, position)
    if (!signatureHelp) return
    let {activeParameter, activeSignature, signatures} = signatureHelp
    await this.nvim.command('echo ""')
    await this.nvim.call('coc#util#echo_signature', [activeParameter || 0, activeSignature || 0, signatures])
  }

  private async handleDefinition(definition: Definition): Promise<void> {
    if (!definition) return
    if (Array.isArray(definition)) {
      let len = definition.length
      if (len == 0) return
      if (len == 1) {
        let {uri, range} = definition[0] as Location
        await workspace.jumpTo(uri, range.start)
      } else {
        await this.addQuickfix(definition as Location[])
      }
    } else {
      let {uri, range} = definition as Location
      await workspace.jumpTo(uri, range.start)
    }
  }

  private async addQuickfix(locations: Location[]): Promise<void> {
    let items = await Promise.all(locations.map(loc => {
      return workspace.getQuickfixItem(loc)
    }))
    let {nvim} = this
    await nvim.call('setqflist', [items, ' ', 'Results of coc'])
    await nvim.command('doautocmd User CocQuickfixChange')
  }

  public async gotoDefinition(): Promise<void> {
    let {document, position} = await workspace.getCurrentState()
    let definition = await languages.getDeifinition(document, position)
    await this.handleDefinition(definition)
  }

  public async gotoTypeDefinition(): Promise<void> {
    let {document, position} = await workspace.getCurrentState()
    let definition = await languages.getTypeDefinition(document, position)
    await this.handleDefinition(definition)
  }

  public async gotoImplementaion(): Promise<void> {
    let {document, position} = await workspace.getCurrentState()
    let definition = await languages.getImplementation(document, position)
    await this.handleDefinition(definition)
  }

  public async gotoReferences(): Promise<void> {
    let {document, position} = await workspace.getCurrentState()
    let locs = await languages.getReferences(document, {includeDeclaration: false}, position)
    if (locs && locs.length) {
      await this.handleDefinition(locs)
    } else {
      await echoWarning(this.nvim, 'not found')
    }
  }

  public async getDocumentSymbols(): Promise<SymbolInfo[]> {
    let document = await workspace.document
    if (!document) return []
    let symbols = await languages.getDocumentSymbol(document.textDocument)
    if (!symbols) {
      await echoErr(this.nvim, 'service does not support document symbols')
      return []
    }
    let level = 0
    let res: SymbolInfo[] = []
    let pre = null
    symbols.sort((a, b) => {
      let sa = a.location.range.start
      let sb = b.location.range.start
      let d = sa.line - sb.line
      return d == 0 ? sa.character - sb.character : d
    })
    for (let sym of symbols) {
      let {name, kind, location, containerName} = sym
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
      let {start} = location.range
      let o: SymbolInfo = {
        filepath: Uri.parse(location.uri).fsPath,
        col: start.character + 1,
        lnum: start.line + 1,
        text: name,
        level,
        kind: getSymbolKind(kind),
        containerName
      }
      res.push(o)
      pre = o
    }
    return res
  }

  public async getWorkspaceSymbols(): Promise<SymbolInfo[]> {
    let document = await workspace.document
    if (!document) return
    let cword = await this.nvim.call('expand', ['<cword>'])
    let query = await this.nvim.call('input', ['Query:', cword])
    let symbols = await languages.getWorkspaceSymbols(document.textDocument, query)
    if (!symbols) {
      await echoErr(this.nvim, 'service does not support workspace symbols')
      return []
    }
    this.currentSymbols = symbols
    let res: SymbolInfo[] = []
    for (let s of symbols) {
      if (!this.validWorkspaceSymbol(s)) continue
      let {name, kind, location} = s
      let {start} = location.range
      res.push({
        filepath: Uri.parse(location.uri).fsPath,
        col: start.character + 1,
        lnum: start.line + 1,
        text: name,
        kind: getSymbolKind(kind),
      })
    }
    return res
  }

  public async resolveWorkspaceSymbol(symbolIndex: number): Promise<SymbolInformation> {
    if (!this.currentSymbols) return null
    let symbol = this.currentSymbols[symbolIndex]
    if (!symbol) return null
    let document = await workspace.document
    if (!document) return null
    return await languages.resolveWorkspaceSymbol(document.textDocument, symbol)
  }

  public async rename(): Promise<void> {
    let {nvim} = this
    let {document, position} = await workspace.getCurrentState()
    if (!document) return
    let curname = await nvim.call('expand', '<cword>')
    let doc = workspace.getDocument(document.uri)
    if (!doc.isWord(curname)) {
      await echoErr(nvim, `'${curname}' is not a valid word!`)
      return
    }
    let newName = await nvim.call('input', ['new name:', curname])
    await nvim.command('normal! :<C-u>')
    if (!newName) {
      await echoWarning(nvim, 'Empty word, canceled')
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
    if (!textEdits) return
    await document.applyEdits(this.nvim, textEdits)
  }

  public async documentRangeFormatting(mode: string): Promise<void> {
    let document = await workspace.document
    if (!document || !mode) return
    let range = await this.getSelectedRange(mode, document.textDocument)
    if (!range) return
    let buffer = await this.nvim.buffer
    let tabSize = await buffer.getOption('tabstop') as number
    let insertSpaces = (await buffer.getOption('expandtab')) == 1
    let options: FormattingOptions = {
      tabSize,
      insertSpaces
    }
    let textEdits = await languages.provideDocumentRangeFormattingEdits(document.textDocument, range, options)
    if (!textEdits) return
    await document.applyEdits(this.nvim, textEdits)
  }

  public async runCommand(id?: string): Promise<void> {
    if (id) {
      if (!commandManager.has(id)) {
        return echoErr(this.nvim, `Command '${id}' not found`)
      }
      commandManager.executeCommand(id)
    } else {
      let ids = await this.getCommands()
      let idx = await showQuickpick(this.nvim, ids)
      if (idx == -1) return
      await commandManager.executeCommand(ids[idx])
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
        start: {line: lnum - 1, character: 0},
        end: {line: lnum, character: 0}
      }
    }
    let diagnostics = diagnosticManager.getDiagnosticsInRange(document.textDocument, range)
    let context = {diagnostics}
    let codeActions = await languages.getCodeActions(document.textDocument, range, context)
    if (codeActions.length == 0) {
      return echoMessage(this.nvim, 'No action available')
    }
    let idx = await showQuickpick(this.nvim, codeActions.map(o => o.title))
    if (idx == -1) return
    let action = codeActions[idx]
    if (action) {
      let {command, edit} = action
      if (edit) await workspace.applyEdit(edit)
      if (command) commandManager.execute(command)
    } else {
      await echoErr(this.nvim, 'code action not found')
    }
  }

  public async doCodeLens(): Promise<void> {
    let {document} = await workspace.getCurrentState()
    if (!document) return
    let codeLens = await languages.getCodeLens(document)
    let buffer = await this.nvim.buffer
    let codeLensBuffer = new CodeLensBuffer(this.nvim, buffer.id, codeLens)
    this.codeLensBuffers.set(buffer.id, codeLensBuffer)
  }

  public async doCodeLensAction(): Promise<void> {
    let {nvim} = this
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

  public async getCommands(): Promise<string[]> {
    let list = commandManager.commandList
    let res = [] as string[]
    let document = await workspace.document
    if (!document) return
    for (let o of list) {
      let idx = o.id.indexOf('.')
      let serviceId = o.id.slice(0, idx)
      if (idx == -1 || serviceId == 'workspace') {
        res.push(o.id)
      } else {
        let service = this.services.getService(serviceId)
        if (!service || service.state !== ServiceStat.Running) {
          continue
        }
        if (service.languageIds.indexOf(document.filetype) == -1) {
          continue
        }
        res.push(o.id)
      }
    }
    return res
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

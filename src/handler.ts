import {Neovim} from 'neovim'
import languages from './languages'
import workspace from './workspace'
import diagnosticManager from './diagnostic/manager'
import commandManager from './commands'
import {
  Hover,
  MarkedString,
  MarkupContent,
  Position,
  Definition,
  Location,
  SymbolKind,
  SymbolInformation,
  FormattingOptions,
  TextDocument,
  Range,
} from 'vscode-languageserver-protocol'
import {
  QuickfixItem,
} from './types'
import {
  echoWarning,
  echoErr,
  showQuickpick,
} from './util'
import Uri from 'vscode-uri'
import {getLine} from './util/fs'
import debounce = require('debounce')
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
  public showSignatureHelp: ()=>void
  private currentSymbols: SymbolInformation[]

  constructor(private nvim:Neovim) {
    this.showSignatureHelp = debounce(() => {
      this._showSignatureHelp().catch(e=> {
        logger.error(e.stack)
      })
    }, 100)
  }

  private async getSelectedRange (mode: string, document: TextDocument): Promise<Range> {
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
    let end = await workspace.getOffset()
    if (start == null || end == null || start == end) {
      await echoErr(this.nvim, 'Failed to get selected range')
      return
    }
    return {
      start: document.positionAt(start),
      end: document.positionAt(end)
    }
  }

  private async previewHover(hover: Hover):Promise<void> {
    let {contents} = hover
    let lines:string[] = []
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

  public async onHover():Promise<void> {
    let {document, position} = await workspace.getCurrentState()
    if (!document) return
    let hover = await languages.getHover(document, position)
    if (!hover) return
    await this.previewHover(hover)
  }

  private async _showSignatureHelp():Promise<void> {
    let {document, position} = await workspace.getCurrentState()
    if (!document) return
    let signatureHelp = await languages.getSignatureHelp(document, position)
    if (!signatureHelp) return
    let {activeParameter, activeSignature, signatures} = signatureHelp
    await this.nvim.command('echo ""')
    await this.nvim.call('coc#util#echo_signature', [activeParameter ||0, activeSignature || 0, signatures])
  }

  private async handleDefinition(definition:Definition):Promise<void> {
    if (!definition) return
    if (Array.isArray(definition)) {
      let len = definition.length
      if (len == 0) return
      if (len == 1) {
        let {uri, range} = definition[0] as Location
        await this.jumpTo(uri, range.start)
      } else {
        await this.addQuickfix(definition as Location[])
      }
    } else {
      let {uri, range} = definition as Location
      await this.jumpTo(uri, range.start)
    }
  }

  private async getQuickfixItem(loc: Location):Promise<QuickfixItem> {
    let {uri, range} = loc
    let {line, character} = range.start
    let text:string
    let fullpath = Uri.parse(uri).fsPath
    let bufnr = await this.nvim.call('bufnr', fullpath)
    if (bufnr !== -1) {
      let document = workspace.getDocument(bufnr)
      if (document) text = document.getline(line)
    }
    if (text == null) {
      text = await getLine(fullpath, line)
    }
    let item:QuickfixItem = {
      filename: fullpath,
      lnum: line + 1,
      col: character + 1,
      text
    }
    if (bufnr !== -1) item.bufnr = bufnr
    return item
  }

  private async addQuickfix(locations:Location[]):Promise<void> {
    let show = await this.nvim.getVar('coc_show_quickfix')
    let items = await Promise.all(locations.map(loc => {
      return this.getQuickfixItem(loc)
    }))
    await this.nvim.call('setqflist', [items, 'r', 'Results of coc'])
    if (show) await this.nvim.command('copen')
    await this.nvim.command('doautocmd User CocQuickfixChange')
  }

  private async jumpTo(uri:string, position:Position):Promise<void> {
    let {line, character} = position
    let cmd = `+call\\ cursor(${line + 1},${character + 1})`
    let filepath = Uri.parse(uri).fsPath
    let bufnr = await this.nvim.call('bufnr', [filepath])
    let curbuf = await this.nvim.call('bufnr', ['%'])
    if (bufnr != -1) {
      if (bufnr != curbuf) {
        let winnr = await this.nvim.call('bufwinnr', [bufnr])
        if (winnr != -1) await this.nvim.command(`${winnr}wincmd w`)
      }
      await this.nvim.command(`buffer ${cmd} ${bufnr}`)
    } else {
      await this.nvim.command(`edit ${cmd} ${filepath}`)
    }
  }

  public async gotoDefinition():Promise<void> {
    let {document, position} = await workspace.getCurrentState()
    let definition = await languages.getDeifinition(document, position)
    await this.handleDefinition(definition)
  }

  public async gotoTypeDefinition():Promise<void> {
    let {document, position} = await workspace.getCurrentState()
    let definition = await languages.getTypeDefinition(document, position)
    await this.handleDefinition(definition)
  }

  public async gotoImplementaion():Promise<void> {
    let {document, position} = await workspace.getCurrentState()
    let definition = await languages.getImplementation(document, position)
    await this.handleDefinition(definition)
  }

  public async gotoReferences():Promise<void> {
    let {document, position} = await workspace.getCurrentState()
    let locs = await languages.getReferences(document, {includeDeclaration: false},position)
    if (locs && locs.length) {
      await this.handleDefinition(locs)
    } else {
      await echoWarning(this.nvim, 'not found')
    }
  }

  public async getDocumentSymbols():Promise<SymbolInfo[]> {
    let {document} = await workspace.getCurrentState()
    if (!document) return []
    let symbols = await languages.getDocumentSymbol(document)
    if (!symbols) {
      await echoErr(this.nvim, 'service does not support document symbols')
      return []
    }
    let level = 0
    let res:SymbolInfo[] = []
    let pre = null
    symbols.sort((a, b) => {
      let sa = a.location.range.start
      let sb = b.location.range.start
      let d = sa.line - sb.line
      return d == 0 ? sa.character - sb.character : d
    })
    for (let sym of symbols) {
      let {name, kind, location, containerName} = sym
      if (!containerName) {
        level = 0
      } else if (pre && containerName == pre.name) {
        level += 1
      } else if (containerName != pre.containerName) {
        level = Math.max(0, level - 1)
      }
      let {start} =  location.range
      res.push({
        filepath: Uri.parse(location.uri).fsPath,
        col: start.character + 1,
        lnum: start.line + 1,
        text: name,
        level,
        kind: getSymbolKind(kind),
        containerName
      })
      pre = sym
    }
    return res
  }

  public async getWorkspaceSymbols():Promise<SymbolInfo[]> {
    let {document} = await workspace.getCurrentState()
    if (!document) return
    let cword = await this.nvim.call('expand', ['<cword>'])
    let query = await this.nvim.call('input', ['Query:', cword])
    let symbols = await languages.getWorkspaceSymbols(document, query)
    if (!symbols) {
      await echoErr(this.nvim, 'service does not support workspace symbols')
      return []
    }
    this.currentSymbols = symbols
    let res:SymbolInfo[] = []
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

  public async resolveWorkspaceSymbol(symbolIndex:number):Promise<SymbolInformation> {
    // TODO find out better way to work with  workspace symbols
    if (!this.currentSymbols) return null
    let symbol = this.currentSymbols[symbolIndex]
    if (!symbol) return null
    let document = await workspace.currentDocument()
    if (!document) return null
    return await languages.resolveWorkspaceSymbol(document, symbol)
  }

  public async rename():Promise<void> {
    let {nvim} = this
    let {document, position} = await workspace.getCurrentState()
    if (!document) return
    try {
      await nvim.command('wa')
    } catch (e) {
      await echoErr(nvim, `Save buffer failed: ${e.message}`)
      return
    }
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

  public async documentFormatting():Promise<void> {
    let {document} = await workspace.getCurrentState()
    if (!document) return
    let buffer = await this.nvim.buffer
    let options = await workspace.getFormatOptions()
    let textEdits = await languages.provideDocumentFormattingEdits(document, options)
    if (!textEdits) return
    let content = TextDocument.applyEdits(document, textEdits)
    await buffer.setLines(content.split('\n'), {
      start: 0,
      end: -1,
      strictIndexing: false
    })
  }

  public async documentRangeFormatting(mode:string):Promise<void> {
    let {document} = await workspace.getCurrentState()
    if (!document || !mode) return
    let range = await this.getSelectedRange(mode, document)
    if (!range) return
    let buffer = await this.nvim.buffer
    let tabSize = await buffer.getOption('tabstop') as number
    let insertSpaces = (await buffer.getOption('expandtab')) == 1
    let options:FormattingOptions = {
      tabSize,
      insertSpaces
    }
    let textEdits = await languages.provideDocumentRangeFormattingEdits(document, range, options)
    if (!textEdits) return
    let content = TextDocument.applyEdits(document, textEdits)
    await buffer.setLines(content.split('\n'), {
      start: 0,
      end: -1,
      strictIndexing: false
    })
  }

  public async doCodeAction(mode:string|null):Promise<void> {
    let {document} = await workspace.getCurrentState()
    if (!document) return
    let range:Range
    if (mode) {
      range = await this.getSelectedRange(mode, document)
    } else {
      let lnum = await this.nvim.call('line', ['.'])
      range = {
        start: {
          line: lnum - 1,
          character: 0
        },
        end: {
          line: lnum,
          character: 0
        }
      }
    }
    let diagnostics = diagnosticManager.getDiagnosticsInRange(document, range)
    let context = {diagnostics}
    let codeActions = await languages.getCodeActions(document, range, context)
    let idx = await showQuickpick(this.nvim, codeActions.map(o => o.title))
    if (idx == -1) return
    let action = codeActions[idx]
    if (action && action.command) {
      commandManager.execute(action.command)
    }
  }

  private validWorkspaceSymbol(symbol: SymbolInformation):boolean {
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
}

function getSymbolKind(kind:SymbolKind):string {
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

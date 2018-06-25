import languages from './languages'
import workspace from './workspace'
import {Neovim} from 'neovim'
import debounce = require('debounce')
import {
  Hover,
  MarkedString,
  MarkupContent,
  Position,
  Definition,
  Location,
  SymbolKind,
} from 'vscode-languageserver-protocol'
import {
  QuickfixItem,
} from './types'
import {
  Uri,
  echoWarning,
} from './util'
import {getLine} from './util/fs'
const logger = require('./util/logger')('Handler')

interface SymbolInfo {
  lnum: number
  filepath: string
  col: number
  text: string
  level: number
  kind: string
  containerName: string
}

export default class Handler {
  public showSignatureHelp: ()=>void

  constructor(private nvim:Neovim) {
    this.showSignatureHelp = debounce(() => {
      this._showSignatureHelp().catch(e=> {
        logger.error(e.stack)
      })
    }, 100)
  }

  private async previewHover(hover: Hover) {
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
    } else if (MarkedString.is(contents)) {
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
    if (locs.length) {
      await this.handleDefinition(locs)
    } else {
      await echoWarning(this.nvim, 'not found')
    }
  }

  public async getDocumentSymbols():Promise<SymbolInfo[]> {
    let {document} = await workspace.getCurrentState()
    if (!document) return []
    let symbols = await languages.getDocumentSymbol(document)
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

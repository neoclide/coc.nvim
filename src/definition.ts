import {Neovim} from 'neovim'
import languages from './languages'
import {
  TextDocument,
  Position,
  Definition,
  Location,
} from 'vscode-languageserver-protocol'
import {
  byteIndex,
} from './util/string'
import {
  Uri,
  echoWarning,
} from './util'
import workspace from './workspace'
const logger = require('./util/logger')('definition')

interface EditerState {
  document: TextDocument
  position: Position
}

export default class DefinitionManager {
  constructor(private nvim:Neovim) {
  }

  private async getCurrentState():Promise<EditerState> {
    let buffer = await this.nvim.buffer
    let [, lnum, col] = await this.nvim.call('getcurpos')
    let document = workspace.getDocument(buffer.id)
    if (!document) return {document:null, position: null}
    let line = document.getline(lnum - 1)
    return {
      document: document.textDocument,
      position: {
        line: lnum - 1,
        character: byteIndex(line, col - 1)
      }
    }
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

  private async addQuickfix(locations:Location[]):Promise<void> {
    let show = await this.nvim.getVar('coc_show_quickfix')
    let items = []
    for (let loc of locations) {
      let {uri, range} = loc
      let {start} = range
      let filename = Uri.parse(uri).fsPath
      items.push({
        filename,
        lnum: start.line + 1,
        col: start.character + 1,
      })
    }
    await this.nvim.call('setqflist', [items, 'r', 'Results of coc'])
    if (show) await this.nvim.command('copen')
    await this.nvim.command('doautocmd User CocQuickfixChange')
  }

  private async jumpTo(uri:string, position:Position):Promise<void> {
    let {line, character} = position
    let cmd = `+call\\ cursor(${line + 1},${character + 1})`
    let filepath = Uri.parse(uri).fsPath
    let bufnr = await this.nvim.call('bufnr', filepath)
    if (bufnr != -1) {
      await this.nvim.command(`buffer ${cmd} ${bufnr}`)
    } else {
      await this.nvim.command(`edit ${cmd} ${filepath}`)
    }
  }

  public async gotoDefinition():Promise<void> {
    let {document, position} = await this.getCurrentState()
    if (!document) return
    let definition = await languages.getDeifinition(document, position)
    await this.handleDefinition(definition)
  }

  public async gotoTypeDefinition():Promise<void> {
    let {document, position} = await this.getCurrentState()
    if (!document) return
    let definition = await languages.getTypeDefinition(document, position)
    await this.handleDefinition(definition)
  }

  public async gotoImplementaion():Promise<void> {
    let {document, position} = await this.getCurrentState()
    if (!document) return
    let definition = await languages.getImplementation(document, position)
    await this.handleDefinition(definition)
  }

  public async gotoReferences():Promise<void> {
    let {document, position} = await this.getCurrentState()
    if (!document) return
    let locs = await languages.getReferences(document, {includeDeclaration: false},position)
    if (locs.length) {
      await this.handleDefinition(locs)
    } else {
      await echoWarning(this.nvim, 'not found')
    }
  }

}

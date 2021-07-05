import { Neovim } from '@chemzqm/neovim'
import { DocumentLink, Position } from 'vscode-languageserver-protocol'
import languages from '../languages'
import { HandlerDelegate } from '../types'
import { positionInRange } from '../util/position'
import workspace from '../workspace'

export default class Links {
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
  }

  public async getLinks(): Promise<DocumentLink[]> {
    let { doc } = await this.handler.getCurrentState()
    this.handler.checkProvier('documentLink', doc.textDocument)
    let links = await this.handler.withRequestToken('links', token => {
      return languages.getDocumentLinks(doc.textDocument, token)
    })
    return links || []
  }

  public async openLink(link: DocumentLink): Promise<void> {
    if (!link.target) {
      link = await languages.resolveDocumentLink(link)
      if (!link.target) throw new Error(`Failed to resolve link target`)
    }
    await workspace.openResource(link.target)
  }

  public async openCurrentLink(): Promise<boolean> {
    let [line, character] = await this.nvim.call('coc#util#cursor') as [number, number]
    let links = await this.getLinks()
    if (!links || links.length == 0) return false
    let position = Position.create(line, character)
    for (let link of links) {
      if (positionInRange(position, link.range) == 0) {
        await this.openLink(link)
        return true
      }
    }
    return false
  }
}

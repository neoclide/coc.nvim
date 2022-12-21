'use strict'
import { DocumentLink, Location } from 'vscode-languageserver-types'
import languages from '../../languages'
import type { CancellationToken } from '../../util/protocol'
import workspace from '../../workspace'
import BasicList from '../basic'
import { formatUri } from '../formatting'
import { ListContext, ListItem } from '../types'

export default class LinksList extends BasicList {
  public defaultAction = 'open'
  public description = 'links of current buffer'
  public name = 'links'

  constructor() {
    super()

    this.addAction('open', async item => {
      let { target } = item.data
      await workspace.openResource(target)
    })

    this.addAction('jump', async item => {
      let { location } = item.data
      await workspace.jumpTo(location.uri, location.range.start)
    })
  }

  public async loadItems(context: ListContext, token: CancellationToken): Promise<ListItem[]> {
    let buf = await context.window.buffer
    let doc = workspace.getAttachedDocument(buf.id)
    let items: ListItem[] = []
    let links = await languages.getDocumentLinks(doc.textDocument, token)
    if (links == null) throw new Error('Links provider not found.')
    let res: DocumentLink[] = []
    for (let link of links) {
      link = link.target ? link : await languages.resolveDocumentLink(link, token)
      if (link.target) {
        items.push({
          label: formatUri(link.target, workspace.cwd),
          data: {
            target: link.target,
            location: Location.create(doc.uri, link.range)
          }
        })
      }
      res.push(link)
    }
    return items
  }
}

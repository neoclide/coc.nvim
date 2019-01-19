import { Neovim } from '@chemzqm/neovim'
import languages from '../../languages'
import workspace from '../../workspace'
import path from 'path'
import { ListContext, ListItem } from '../../types'
import BasicList from '../basic'
import { DocumentLink, Location } from 'vscode-languageserver-types'
import Uri from 'vscode-uri'

export default class LinksList extends BasicList {
  public defaultAction = 'open'
  public description = 'links of current buffer'

  constructor(nvim: Neovim) {
    super(nvim)

    this.addAction('open', async item => {
      let { target } = item.data
      let uri = Uri.parse(target)
      if (uri.scheme.startsWith('http')) {
        await nvim.call('coc#util#open_url', target)
      } else {
        await workspace.jumpTo(target)
      }
    })

    this.addAction('jump', async item => {
      let { location } = item.data
      await workspace.jumpTo(location.uri, location.range.start)
    })
  }

  public get name(): string {
    return 'links'
  }

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    let buf = await context.window.buffer
    let doc = workspace.getDocument(buf.id)
    if (!doc) return []
    let items: ListItem[] = []
    let links = await languages.getDocumentLinks(doc.textDocument)
    links = links || []
    let res: DocumentLink[] = []
    for (let link of links) {
      if (link.target) {
        items.push({
          label: formatUri(link.target),
          data: {
            target: link.target,
            location: Location.create(doc.uri, link.range)
          }
        })
      } else {
        link = await languages.resolveDocumentLink(link)
        if (link.target) {
          items.push({
            label: formatUri(link.target),
            data: {
              target: link.target,
              location: Location.create(doc.uri, link.range)
            }
          })
        }
        res.push(link)
      }
    }
    return items
  }
}

function formatUri(uri: string): string {
  if (!uri.startsWith('file:')) return uri
  let filepath = Uri.parse(uri).fsPath
  return filepath.startsWith(workspace.cwd) ? path.relative(workspace.cwd, filepath) : filepath
}

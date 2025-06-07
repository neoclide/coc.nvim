import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import type Editors from '../core/editors'
import { Emitter, Event } from '../util/protocol'

export interface TabsModel {
  onClose: Event<Set<URI>>
  onOpen: Event<Set<URI>>
  isActive(document: TextDocument | URI): boolean
  isVisible(document: TextDocument | URI): boolean
  getTabResources(): Set<URI>
}

/**
 * Track visible documents
 */
export default class Tabs implements TabsModel {
  private open: Set<string> = new Set()
  private readonly _onOpen: Emitter<Set<URI>>
  private readonly _onClose: Emitter<Set<URI>>

  constructor(
    private editors: Editors
  ) {
    this._onOpen = new Emitter()
    this._onClose = new Emitter()
    this.editors.onDidChangeVisibleTextEditors(editors => {
      let uris = Array.from(this.open)
      let seen: Set<string> = new Set()
      let opened: Set<URI> = new Set()
      let closed: Set<URI> = new Set()
      for (let editor of editors) {
        if (!seen.has(editor.uri) && !uris.includes(editor.uri)) {
          this.open.add(editor.uri)
          opened.add(URI.parse(editor.uri))
        }
        seen.add(editor.uri)
      }
      for (let uri of uris) {
        if (!seen.has(uri)) {
          this.open.delete(uri)
          closed.add(URI.parse(uri))
        }
      }
      if (opened.size > 0) {
        this._onOpen.fire(opened)
      }
      if (closed.size > 0) {
        this._onClose.fire(closed)
      }
    })
  }

  public attach(): void {
    for (let editor of this.editors.visibleTextEditors) {
      this.open.add(editor.uri)
    }
  }

  public get onClose(): Event<Set<URI>> {
    return this._onClose.event
  }

  public get onOpen(): Event<Set<URI>> {
    return this._onOpen.event
  }

  public isActive(document: TextDocument | URI): boolean {
    const uri = document instanceof URI ? document : document.uri
    return this.editors.activeTextEditor?.document.uri === uri.toString()
  }

  public isVisible(document: TextDocument | URI): boolean {
    const uri = document instanceof URI ? document : document.uri
    return this.open.has(uri.toString())
  }

  public getTabResources(): Set<URI> {
    const result: Set<URI> = new Set()
    let seen: Set<string> = new Set()
    for (let editor of this.editors.visibleTextEditors) {
      if (!seen.has(editor.uri)) {
        result.add(URI.parse(editor.uri))
        seen.add(editor.uri)
      }
    }
    return result
  }
}

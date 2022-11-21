'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Position, Range, WorkspaceEdit } from 'vscode-languageserver-types'
import type { CancellationToken, Disposable } from '../util/protocol'
import { RenameProvider, DocumentSelector } from './index'
import Manager from './manager'

export default class RenameManager extends Manager<RenameProvider> {

  public register(selector: DocumentSelector, provider: RenameProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  /**
   * Multiple providers can be registered for a language. In that case providers are sorted
   * by their {@link workspace.match score} and asked in sequence. The first provider producing a result
   * defines the result of the whole operation.
   */
  public async provideRenameEdits(
    document: TextDocument,
    position: Position,
    newName: string,
    token: CancellationToken
  ): Promise<WorkspaceEdit | null> {
    let items = this.getProviders(document)
    let edit: WorkspaceEdit = null
    for (const item of items) {
      try {
        edit = await Promise.resolve(item.provider.provideRenameEdits(document, position, newName, token))
      } catch (e) {
        this.handleResults([{ status: 'rejected', reason: e }], 'provideRenameEdits')
      }
      if (edit != null) break
    }
    return edit
  }

  public async prepareRename(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<Range | { range: Range; placeholder: string } | false> {
    let items = this.getProviders(document)
    items = items.filter(o => typeof o.provider.prepareRename === 'function')
    if (items.length === 0) return null
    for (const item of items) {
      let res = await Promise.resolve(item.provider.prepareRename(document, position, token))
      // can rename
      if (res != null) return res
    }
    return false
  }
}

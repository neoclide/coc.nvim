import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, LinkedEditingRanges, Position, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { LinkedEditingRangeProvider } from './index'
import Manager, { ProviderItem } from './manager'
const logger = require('../util/logger')('linkedEditingManager')

export default class LinkedEditingRangeManager extends Manager<LinkedEditingRangeProvider> implements Disposable {
  public dispose(): void {
    this.providers = new Set()
  }

  public register(selector: DocumentSelector, provider: LinkedEditingRangeProvider): Disposable {
    let item: ProviderItem<LinkedEditingRangeProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideLinkedEditingRanges(document: TextDocument, position: Position, token: CancellationToken): Promise<LinkedEditingRanges> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    if (!provider.provideLinkedEditingRanges) return null

    return await Promise.resolve(provider.provideLinkedEditingRanges(document, position, token))
  }

  public async provideLinkedEdits(pre: string, document: TextDocument, position: Position, token: CancellationToken): Promise<TextEdit[]>{
    const edit = await this.provideLinkedEditingRanges(document, position, token)
    if (!edit) return []

    const edits: TextEdit[] = []
    edit.ranges.forEach(range => edits.push(TextEdit.replace(range, pre)))
    return edits
  }
}

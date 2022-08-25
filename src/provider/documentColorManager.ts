'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, ColorInformation, ColorPresentation, Disposable, DocumentSelector } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DocumentColorProvider } from './index'
import Manager from './manager'

export default class DocumentColorManager extends Manager<DocumentColorProvider> {

  public register(selector: DocumentSelector, provider: DocumentColorProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async provideDocumentColors(document: TextDocument, token: CancellationToken): Promise<ColorInformation[] | null> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    let res: ColorInformation[] = await Promise.resolve(provider.provideDocumentColors(document, token))
    return res
  }

  public async provideColorPresentations(colorInformation: ColorInformation, document: TextDocument, token: CancellationToken): Promise<ColorPresentation[]> {
    let { range, color } = colorInformation
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    let res = await Promise.resolve(provider.provideColorPresentations(color, { document, range }, token))
    return res
  }
}

import { CancellationToken, ColorInformation, ColorPresentation, Disposable, DocumentSelector, TextDocument } from 'vscode-languageserver-protocol'
import { DocumentColorProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')

export default class DocumentColorManager extends Manager<DocumentColorProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: DocumentColorProvider): Disposable {
    let item: ProviderItem<DocumentColorProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
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

  public dispose(): void {
    this.providers = new Set()
  }
}

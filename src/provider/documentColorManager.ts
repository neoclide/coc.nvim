import { CancellationToken, ColorInformation, ColorPresentation, Disposable, DocumentSelector, TextDocument } from 'vscode-languageserver-protocol'
import workspace from '../workspace'
import { DocumentColorProvider } from './index'
import uuid = require('uuid/v4')

export interface ProviderItem {
  id: string
  selector: DocumentSelector
  provider: DocumentColorProvider
  score?: number
}

export default class DocumentColorManager implements Disposable {
  private providers: Set<ProviderItem> = new Set()

  public register(selector: DocumentSelector, provider: DocumentColorProvider): Disposable {
    let item: ProviderItem = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  private getProvider(document: TextDocument): ProviderItem | null {
    let items = Array.from(this.providers)
    let provider: ProviderItem
    for (let item of items) {
      let { selector } = item
      let score = workspace.match(selector, document)
      if (score == 10) return item
      item.score = score
      if (!provider || score > provider.score) {
        provider = item
      }
    }
    return provider
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

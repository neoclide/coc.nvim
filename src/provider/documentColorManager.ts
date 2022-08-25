'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, ColorInformation, ColorPresentation, Disposable, DocumentSelector } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { equals } from '../util/object'
import { DocumentColorProvider } from './index'
import Manager from './manager'

interface ColorWithSource extends ColorInformation {
  source?: string
}

export default class DocumentColorManager extends Manager<DocumentColorProvider> {

  public register(selector: DocumentSelector, provider: DocumentColorProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async provideDocumentColors(document: TextDocument, token: CancellationToken): Promise<ColorInformation[] | null> {
    let items = this.getProviders(document)
    if (items.length === 0) return null
    let colors: ColorWithSource[] = []
    let n = 0
    const results = await Promise.allSettled(items.map(item => {
      let { id } = item
      return Promise.resolve(item.provider.provideDocumentColors(document, token)).then(arr => {
        if (Array.isArray(arr)) {
          for (let color of arr) {
            if (n == 0 || !colors.some(o => equals(o.range, color.range))) {
              colors.push(Object.assign({ source: id }, color))
            }
          }
        }
        n++
      })
    }))
    this.handleResults(results, 'provideDefinition')
    return colors
  }

  public async provideColorPresentations(colorInformation: ColorWithSource, document: TextDocument, token: CancellationToken): Promise<ColorPresentation[]> {
    let provider = this.getProviderById(colorInformation.source)
    if (!provider) return null
    let { range, color } = colorInformation
    return await Promise.resolve(provider.provideColorPresentations(color, { document, range }, token))
  }
}

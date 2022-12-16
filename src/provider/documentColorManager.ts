'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { ColorInformation, ColorPresentation } from 'vscode-languageserver-types'
import { equals } from '../util/object'
import { CancellationToken, Disposable } from '../util/protocol'
import { DocumentColorProvider, DocumentSelector } from './index'
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

  public async provideDocumentColors(document: TextDocument, token: CancellationToken): Promise<ColorInformation[]> {
    let items = this.getProviders(document)
    let colors: ColorWithSource[] = []
    const results = await Promise.allSettled(items.map(item => {
      let { id } = item
      return Promise.resolve(item.provider.provideDocumentColors(document, token)).then(arr => {
        let noCheck = colors.length == 0
        if (Array.isArray(arr)) {
          for (let color of arr) {
            if (noCheck || !colors.some(o => equals(o.range, color.range))) {
              colors.push(Object.assign({ source: id }, color))
            }
          }
        }
      })
    }))
    this.handleResults(results, 'provideDocumentColors')
    return colors
  }

  public async provideColorPresentations(colorInformation: ColorWithSource, document: TextDocument, token: CancellationToken): Promise<ColorPresentation[] | null> {
    let providers = this.getProviders(document)
    let { range, color } = colorInformation
    for (let item of providers) {
      let res = await Promise.resolve(item.provider.provideColorPresentations(color, { document, range }, token))
      if (res) return res
    }
    return null
  }
}

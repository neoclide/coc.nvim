/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as Proto from '../protocol'
import * as PConst from '../protocol.const'
import {ITypeScriptServiceClient} from '../typescriptService'
import {
  DocumentSymbolProvider,
} from '../../provider'
import * as typeConverters from '../utils/typeConverters'
import {
  TextDocument,
  CancellationToken,
  SymbolInformation,
  SymbolKind,
} from 'vscode-languageserver-protocol'

const getSymbolKind = (kind: string): SymbolKind => {
  switch (kind) {
    case PConst.Kind.module:
      return SymbolKind.Module
    case PConst.Kind.class:
      return SymbolKind.Class
    case PConst.Kind.enum:
      return SymbolKind.Enum
    case PConst.Kind.interface:
      return SymbolKind.Interface
    case PConst.Kind.memberFunction:
      return SymbolKind.Method
    case PConst.Kind.memberVariable:
      return SymbolKind.Property
    case PConst.Kind.memberGetAccessor:
      return SymbolKind.Property
    case PConst.Kind.memberSetAccessor:
      return SymbolKind.Property
    case PConst.Kind.variable:
      return SymbolKind.Variable
    case PConst.Kind.const:
      return SymbolKind.Variable
    case PConst.Kind.localVariable:
      return SymbolKind.Variable
    case PConst.Kind.variable:
      return SymbolKind.Variable
    case PConst.Kind.function:
      return SymbolKind.Function
    case PConst.Kind.localFunction:
      return SymbolKind.Function
  }
  return SymbolKind.Variable
}

export default class TypeScriptDocumentSymbolProvider implements DocumentSymbolProvider {
  public constructor(private readonly client: ITypeScriptServiceClient) {}

  public async provideDocumentSymbols(
    resource: TextDocument,
    token: CancellationToken
  ): Promise<SymbolInformation[]> {
    const filepath = this.client.toPath(resource.uri)
    if (!filepath) return []

    const args: Proto.FileRequestArgs = {
      file: filepath
    }

    try {
        const response = await this.client.execute('navtree', args, token)
        if (response.body) {
          // The root represents the file. Ignore this when showing in the UI
          const tree = response.body
          if (tree.childItems) {
            const result = new Array<SymbolInformation>()
            tree.childItems.forEach(item =>
              TypeScriptDocumentSymbolProvider.convertNavTree(
                resource.uri,
                result,
                item
              )
            )
            return result
          }
        }
      return []
    } catch (e) {
      return []
    }
  }

  private static convertNavTree(
    uri: string,
    bucket: SymbolInformation[],
    item: Proto.NavigationTree,
    containerName = ''
  ): boolean {
    const symbolInfo = SymbolInformation.create(
      item.text,
      getSymbolKind(item.kind),
      typeConverters.Range.fromTextSpan(item.spans[0]),
      uri,
      containerName)

    let shouldInclude = TypeScriptDocumentSymbolProvider.shouldInclueEntry(item)

    if (shouldInclude || (item.childItems && item.childItems.length)) {
      bucket.push(symbolInfo)
    }

    if (item.childItems) {
      for (const child of item.childItems) {
        const includedChild = TypeScriptDocumentSymbolProvider.convertNavTree(
          uri,
          bucket,
          child,
          symbolInfo.name
        )
        shouldInclude = shouldInclude || includedChild
      }
    }
    return shouldInclude
  }

  private static shouldInclueEntry(
    item: Proto.NavigationTree | Proto.NavigationBarItem
  ): boolean {
    if (item.kind === PConst.Kind.alias) {
      return false
    }
    return !!(
      item.text &&
      item.text !== '<function>' &&
      item.text !== '<class>'
    )
  }
}

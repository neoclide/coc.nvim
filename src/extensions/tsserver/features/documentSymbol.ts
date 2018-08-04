/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {CancellationToken, DocumentSymbol, SymbolKind, TextDocument, Range} from 'vscode-languageserver-protocol'
import {DocumentSymbolProvider} from '../../../provider'
import * as Proto from '../protocol'
import * as PConst from '../protocol.const'
import {ITypeScriptServiceClient} from '../typescriptService'
import * as typeConverters from '../utils/typeConverters'
const logger = require('../../../util/logger')('tsserver-documentSymbol')

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
    case PConst.Kind.constructSignature:
    case PConst.Kind.constructorImplementation:
    case PConst.Kind.function:
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
  ): Promise<DocumentSymbol[]> {
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
          const result = new Array<DocumentSymbol>()
          tree.childItems.forEach(item =>
            TypeScriptDocumentSymbolProvider.convertNavTree(
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
    bucket: DocumentSymbol[],
    item: Proto.NavigationTree,
  ): boolean {
    let shouldInclude = TypeScriptDocumentSymbolProvider.shouldInclueEntry(item)
    const children = new Set(item.childItems || [])
    for (const span of item.spans) {
      const range = typeConverters.Range.fromTextSpan(span)
      const symbolInfo = DocumentSymbol.create(
        item.text,
        '',
        getSymbolKind(item.kind),
        range,
        range)
      symbolInfo.children = children.size > 0 ? [] : null

      for (const child of children) {
        if (child.spans.some(span => !!containsRange(range, typeConverters.Range.fromTextSpan(span)))) {
          const includedChild = TypeScriptDocumentSymbolProvider.convertNavTree(symbolInfo.children, child)
          if (includedChild && !shouldInclude) {
            logger.debug(33)
          }
          shouldInclude = shouldInclude || includedChild
          children.delete(child)
        }
      }

      if (shouldInclude) {
        bucket.push(symbolInfo)
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

function containsRange(range: Range, otherRange: Range): boolean {
  if (otherRange.start.line < range.start.line || otherRange.end.line < range.start.line) {
    return false
  }
  if (otherRange.start.line > range.end.line || otherRange.end.line > range.end.line) {
    return false
  }
  if (otherRange.start.line === range.start.line && otherRange.start.character < range.start.character) {
    return false
  }
  if (otherRange.end.line === range.end.line && otherRange.end.character > range.end.character) {
    return false
  }
  return true
}


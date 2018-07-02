/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
  CodeLens,
  CancellationToken,
  TextDocument,
  Range,
  Event,
  Emitter
} from 'vscode-languageserver-protocol'
import * as Proto from '../protocol'
import { CodeLensProvider } from '../../provider'

import {ITypeScriptServiceClient} from '../typescriptService'
import * as typeConverters from '../utils/typeConverters'
import {escapeRegExp} from '../utils/regexp'

export class CachedNavTreeResponse {
  private response?: Promise<Proto.NavTreeResponse>
  private version: number = -1
  private document: string = ''

  public execute(document: TextDocument, f: () => Promise<Proto.NavTreeResponse>) {
    if (this.matches(document)) {
      return this.response
    }

    return this.update(document, f())
  }

  private matches(document: TextDocument): boolean {
    return (
      this.version === document.version &&
      this.document === document.uri.toString()
    )
  }

  private update(
    document: TextDocument,
    response: Promise<Proto.NavTreeResponse>
  ): Promise<Proto.NavTreeResponse> {
    this.response = response
    this.version = document.version
    this.document = document.uri.toString()
    return response
  }
}

export abstract class TypeScriptBaseCodeLensProvider implements CodeLensProvider {
  private onDidChangeCodeLensesEmitter = new Emitter<void>()

  public constructor(
    protected client: ITypeScriptServiceClient,
    private cachedResponse: CachedNavTreeResponse
  ) {}

  public get onDidChangeCodeLenses(): Event<void> {
    return this.onDidChangeCodeLensesEmitter.event
  }

  async provideCodeLenses(
    document: TextDocument,
    token: CancellationToken
  ): Promise<CodeLens[]> {
    const filepath = this.client.toPath(document.uri)
    if (!filepath) {
      return []
    }

    try {
      const response = await this.cachedResponse.execute(document, () =>
        this.client.execute('navtree', {file: filepath}, token)
      )
      if (!response) {
        return []
      }

      const tree = response.body
      const referenceableSpans: Range[] = []
      if (tree && tree.childItems) {
        tree.childItems.forEach(item =>
          this.walkNavTree(document, item, null, referenceableSpans)
        )
      }
      return referenceableSpans.map(
        range => {
          return {
            range,
            data: { uri: document.uri }
          }
        }
      )
    } catch {
      return []
    }
  }

  protected abstract extractSymbol(
    document: TextDocument,
    item: Proto.NavigationTree,
    parent: Proto.NavigationTree | null
  ): Range | null

  private walkNavTree(
    document: TextDocument,
    item: Proto.NavigationTree,
    parent: Proto.NavigationTree | null,
    results: Range[]
  ): void {
    if (!item) {
      return
    }

    const range = this.extractSymbol(document, item, parent)
    if (range) {
      results.push(range)
    }

    ;(item.childItems || []).forEach(child =>
      this.walkNavTree(document, child, item, results)
    )
  }
  protected getSymbolRange(
    document: TextDocument,
    item: Proto.NavigationTree
  ): Range | null {
    if (!item) {
      return null
    }

    // TS 3.0+ provides a span for just the symbol
    if ((item as any).nameSpan) {
      return typeConverters.Range.fromTextSpan((item as any).nameSpan)
    }

    // In older versions, we have to calculate this manually. See #23924
    const span = item.spans && item.spans[0]
    if (!span) {
      return null
    }

    const range = typeConverters.Range.fromTextSpan(span)
    const text = document.getText(range)

    const identifierMatch = new RegExp(
      `^(.*?(\\b|\\W))${escapeRegExp(item.text || '')}(\\b|\\W)`,
      'gm'
    )
    const match = identifierMatch.exec(text)
    const prefixLength = match ? match.index + match[1].length : 0
    const startOffset = document.offsetAt(range.start) + prefixLength
    return {
      start: document.positionAt(startOffset),
      end: document.positionAt(startOffset + item.text.length)
    }
  }
}

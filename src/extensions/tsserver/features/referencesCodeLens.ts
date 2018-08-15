/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken, CodeLens, Range, TextDocument } from 'vscode-languageserver-protocol'
import * as Proto from '../protocol'
import * as PConst from '../protocol.const'
import * as typeConverters from '../utils/typeConverters'
import { TypeScriptBaseCodeLensProvider } from './baseCodeLensProvider'

export default class TypeScriptReferencesCodeLensProvider extends TypeScriptBaseCodeLensProvider {
  public resolveCodeLens(
    codeLens: CodeLens,
    token: CancellationToken
  ): Promise<CodeLens> {
    let { uri } = codeLens.data
    let filepath = this.client.toPath(uri)
    const args = typeConverters.Position.toFileLocationRequestArgs(
      filepath,
      codeLens.range.start
    )
    return this.client
      .execute('references', args, token)
      .then(response => {
        if (!response || !response.body) {
          throw codeLens
        }

        const locations = response.body.refs
          .map(reference =>
            typeConverters.Location.fromTextSpan(
              this.client.toResource(reference.file),
              reference
            )
          )
          .filter(
            location =>
              // Exclude original definition from references
              !(
                location.uri.toString() === uri &&
                location.range.start.line === codeLens.range.start.line &&
                location.range.start.character ===
                codeLens.range.start.character
              )
          )

        codeLens.command = {
          title: locations.length === 1 ? '1 reference' : `${locations.length} references`,
          command: locations.length ? 'editor.action.showReferences' : '',
          arguments: [uri, codeLens.range.start, locations]
        }
        return codeLens
      })
      .catch(() => {
        codeLens.command = {
          title: 'Could not determine references',
          command: ''
        }
        return codeLens
      })
  }

  protected extractSymbol(
    document: TextDocument,
    item: Proto.NavigationTree,
    parent: Proto.NavigationTree | null
  ): Range | null {
    if (parent && parent.kind === PConst.Kind.enum) {
      return super.getSymbolRange(document, item)
    }

    switch (item.kind) {
      case PConst.Kind.const:
      case PConst.Kind.let:
      case PConst.Kind.variable:
      case PConst.Kind.function:
        // Only show references for exported variables
        if (!item.kindModifiers.match(/\bexport\b/)) {
          break
        }
      // fallthrough

      case PConst.Kind.class:
        if (item.text === '<class>') {
          break
        }
      // fallthrough

      case PConst.Kind.memberFunction:
      case PConst.Kind.memberVariable:
      case PConst.Kind.memberGetAccessor:
      case PConst.Kind.memberSetAccessor:
      case PConst.Kind.constructorImplementation:
      case PConst.Kind.interface:
      case PConst.Kind.type:
      case PConst.Kind.enum:
        return super.getSymbolRange(document, item)
    }

    return null
  }
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as Proto from '../protocol'
import {ITypeScriptServiceClient} from '../typescriptService'
import * as Previewer from '../utils/previewer'
import * as typeConverters from '../utils/typeConverters'
import {
  SignatureHelpProvider
} from '../../provider'
import {
  TextDocument,
  Position,
  CancellationToken,
  SignatureHelp,
  SignatureInformation,
} from 'vscode-languageserver-protocol'
const logger = require('../../util/logger')('typescript-signature')

export default class TypeScriptSignatureHelpProvider implements SignatureHelpProvider {
  public static readonly triggerCharacters = ['(', ',', '<']

  public constructor(private readonly client: ITypeScriptServiceClient) {}

  public async provideSignatureHelp(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<SignatureHelp | undefined> {
    const filepath = this.client.toPath(document.uri)
    if (!filepath) {
      return undefined
    }
    const args: Proto.SignatureHelpRequestArgs = typeConverters.Position.toFileLocationRequestArgs(
      filepath,
      position
    )

    let info: Proto.SignatureHelpItems | undefined
    try {
      const response = await this.client.execute('signatureHelp', args, token)
      info = response.body
      if (!info) return undefined
    } catch {
      return undefined
    }

    const result:SignatureHelp = {
      activeSignature: info.selectedItemIndex,
      activeParameter: this.getActiveParmeter(info),
      signatures: info.items.map(signature => {
        return this.convertSignature(signature)
      })
    }
    return result
  }

  private getActiveParmeter(info: Proto.SignatureHelpItems): number {
    const activeSignature = info.items[info.selectedItemIndex]
    if (activeSignature && activeSignature.isVariadic) {
      return Math.min(info.argumentIndex, activeSignature.parameters.length - 1)
    }
    return info.argumentIndex
  }

  private convertSignature(item: Proto.SignatureHelpItem):SignatureInformation {
    return {
      label: Previewer.plain(item.prefixDisplayParts).replace(/\($/, ''),
      documentation: Previewer.markdownDocumentation(
        item.documentation,
        item.tags.filter(x => x.name !== 'param')
      ),
      parameters: item.parameters.map(p => {
        return {
          label: Previewer.plain(p.displayParts),
          documentation: Previewer.markdownDocumentation(p.documentation, [])
        }
      })
    }
  }
}

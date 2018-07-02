/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {ITypeScriptServiceClient} from '../typescriptService'
import * as typeConverters from '../utils/typeConverters'
import {
  ReferenceProvider,
  ReferenceContext,
} from '../../provider'
import {
  Location,
  TextDocument,
  Position,
  CancellationToken,
} from 'vscode-languageserver-protocol'

export default class TypeScriptReferences implements ReferenceProvider {
  public constructor(private readonly client: ITypeScriptServiceClient) {
  }

  public async provideReferences(
    document: TextDocument,
    position: Position,
    context: ReferenceContext,
    token: CancellationToken
  ): Promise<Location[]> {
    const filepath = this.client.toPath(document.uri)
    if (!filepath) return []

    const args = typeConverters.Position.toFileLocationRequestArgs(
      filepath,
      position
    )
    try {
      const msg = await this.client.execute('references', args, token)
      if (!msg.body) {
        return []
      }
      const result: Location[] = []
      for (const ref of msg.body.refs) {
        if (!context.includeDeclaration && ref.isDefinition) {
          continue
        }
        const url = this.client.toResource(ref.file)
        const location = typeConverters.Location.fromTextSpan(url, ref)
        result.push(location)
      }
      return result
    } catch {
      return []
    }
  }
}

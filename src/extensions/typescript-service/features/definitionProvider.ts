/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {ITypeScriptServiceClient} from '../typescriptService'
import {
  DefinitionProvider,
  TypeDefinitionProvider,
  ImplementationProvider,
} from '../../../provider'
import * as typeConverters from '../utils/typeConverters'
import * as Proto from '../protocol'
import {
  TextDocument,
  Position,
  CancellationToken,
  Definition,
  Location,
} from 'vscode-languageserver-protocol'

export default class TypeScriptDefinitionProvider implements DefinitionProvider,TypeDefinitionProvider,ImplementationProvider {
  constructor(private client: ITypeScriptServiceClient) {}

  protected async getSymbolLocations(
    definitionType: 'definition' | 'implementation' | 'typeDefinition',
    document: TextDocument,
    position: Position,
    token: CancellationToken | boolean
  ): Promise<Location[] | undefined> {
    const filepath = this.client.toPath(document.uri)
    if (!filepath) {
      return undefined
    }

    const args = typeConverters.Position.toFileLocationRequestArgs(
      filepath,
      position
    )
    try {
      const response = await this.client.execute(definitionType, args, token)
      const locations: Proto.FileSpan[] = (response && response.body) || []
      return locations.map(location =>
        typeConverters.Location.fromTextSpan(
          this.client.toResource(location.file),
          location
        )
      )
    } catch {
      return []
    }
  }

  public provideDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken | boolean
  ): Promise<Definition | undefined> {
    return this.getSymbolLocations('definition', document, position, token)
  }

  public provideTypeDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken): Promise<Definition> {
    return this.getSymbolLocations('typeDefinition', document, position, token)
  }

  public provideImplementation(
    document: TextDocument,
    position: Position,
    token: CancellationToken): Promise<Definition> {
    return this.getSymbolLocations('implementation', document, position, token)
  }
}

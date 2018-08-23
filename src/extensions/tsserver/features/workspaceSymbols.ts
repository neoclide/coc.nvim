/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken, Range, SymbolInformation, SymbolKind } from 'vscode-languageserver-protocol'
import { WorkspaceSymbolProvider } from '../../../provider'
import workspace from '../../../workspace'
import * as Proto from '../protocol'
import { ITypeScriptServiceClient } from '../typescriptService'
import * as typeConverters from '../utils/typeConverters'
const logger = require('../../../util/logger')('typsscript-workspace-symbols')

function getSymbolKind(item: Proto.NavtoItem): SymbolKind {
  switch (item.kind) {
    case 'method':
      return SymbolKind.Method
    case 'enum':
      return SymbolKind.Enum
    case 'function':
      return SymbolKind.Function
    case 'class':
      return SymbolKind.Class
    case 'interface':
      return SymbolKind.Interface
    case 'var':
      return SymbolKind.Variable
    default:
      return SymbolKind.Variable
  }
}

export default class TypeScriptWorkspaceSymbolProvider implements WorkspaceSymbolProvider {
  public constructor(
    private readonly client: ITypeScriptServiceClient,
    private readonly languageIds: string[]
  ) { }

  public async provideWorkspaceSymbols(
    search: string,
    token: CancellationToken
  ): Promise<SymbolInformation[]> {
    const uri = this.getUri()
    if (!uri) return []

    const filepath = this.client.toPath(uri)
    if (!filepath) return []

    const args: Proto.NavtoRequestArgs = {
      file: filepath,
      searchValue: search
    }

    const response = await this.client.execute('navto', args, token)
    if (!response.body) return []

    const result: SymbolInformation[] = []
    for (const item of response.body) {
      if (!item.containerName && item.kind === 'alias') {
        continue
      }
      const label = TypeScriptWorkspaceSymbolProvider.getLabel(item)
      const range: Range = {
        start: typeConverters.Position.fromLocation(item.start),
        end: typeConverters.Position.fromLocation(item.end),
      }
      const symbolInfo = SymbolInformation.create(
        label,
        getSymbolKind(item),
        range,
        this.client.toResource(item.file))

      result.push(symbolInfo)
    }
    return result
  }

  private static getLabel(item: Proto.NavtoItem): string {
    let label = item.name
    if (item.kind === 'method' || item.kind === 'function') {
      label += '()'
    }
    return label
  }

  private getUri(): string {
    // typescript wants to have a resource even when asking
    // general questions so we check the active editor. If this
    // doesn't match we take the first TS document.
    const documents = workspace.textDocuments
    for (const document of documents) {
      if (this.languageIds.indexOf(document.languageId) >= 0) {
        return document.uri
      }
    }
    return undefined
  }
}

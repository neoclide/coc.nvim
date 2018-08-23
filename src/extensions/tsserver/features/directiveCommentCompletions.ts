/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CompletionContext, CompletionItem, CompletionItemKind, CompletionList, Position, Range, TextDocument } from 'vscode-languageserver-protocol'
import workspace from '../../../workspace'
import { ITypeScriptServiceClient } from '../typescriptService'

const logger = require('../../../util/logger')('directiveCommentCompletions')

interface Directive {
  readonly value: string
  readonly description: string
}

const directives: Directive[] = [
  {
    value: '@ts-check',
    description: 'Enables semantic checking in a JavaScript file. Must be at the top of a file.'
  },
  {
    value: '@ts-nocheck',
    description: 'Disables semantic checking in a JavaScript file. Must be at the top of a file.'
  },
  {
    value: '@ts-ignore',
    description: 'Suppresses @ts-check errors on the next line of a file.'
  }
]

export default class DirectiveCommentCompletionProvider {
  constructor(private readonly client: ITypeScriptServiceClient) { }

  public provideCompletionItems(
    document: TextDocument,
    position: Position,
    _token: CancellationToken,
    context: CompletionContext
  ): CompletionItem[] | CompletionList {
    if (context.triggerCharacter != '@') {
      return []
    }
    const file = this.client.toPath(document.uri)
    if (!file) {
      return []
    }
    const doc = workspace.getDocument(document.uri)

    const line = doc.getline(position.line)
    const prefix = line.slice(0, position.character)
    const match = prefix.match(/^\s*\/\/+\s?(@[a-zA-Z\-]*)?$/)
    if (match) {
      let items = directives.map(directive => {
        const item = CompletionItem.create(directive.value)
        item.kind = CompletionItemKind.Snippet
        item.detail = directive.description
        item.textEdit = {
          range: Range.create(
            position.line,
            Math.max(0, position.character - (match[1] ? match[1].length : 0)),
            position.line,
            position.character
          ),
          newText: directive.value
        }
        return item
      })
      let res: any = {
        isIncomplete: false,
        items
      }
      res.startcol = doc.fixStartcol(position, ['@'])
      return res as any
    }
    return []
  }
}

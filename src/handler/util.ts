import { MarkupContent } from 'vscode-languageserver-types'
import { Documentation } from '../types'
import { isMarkdown } from '../util/is'

export function toDocumentation(doc: string | MarkupContent): Documentation {
  return {
    content: typeof doc === 'string' ? doc : doc.value,
    filetype: isMarkdown(doc) ? 'markdown' : 'txt'
  }
}

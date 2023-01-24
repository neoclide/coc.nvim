import { MarkupContent } from 'vscode-languageserver-types'
import { createLogger } from '../logger/index'
import { Documentation } from '../types'
import { isMarkdown } from '../util/is'
import { toErrorText } from '../util/string'
const logger = createLogger('handler-util')

export function handleError(e: any) {
  logger.error(`Error on handler: `, toErrorText(e))
}

export function toDocumentation(doc: string | MarkupContent): Documentation {
  return {
    content: typeof doc === 'string' ? doc : doc.value,
    filetype: isMarkdown(doc) ? 'markdown' : 'txt'
  }
}

import {
  TextDocument
} from 'vscode-languageserver-protocol'

export const typescript = 'typescript'
export const typescriptreact = 'typescriptreact'
export const javascript = 'javascript'
export const javascriptreact = 'javascriptreact'
export const jsxTags = 'jsx-tags'

export function isSupportedLanguageMode(doc: TextDocument):boolean {
  return [typescript, typescriptreact, javascript, javascriptreact].indexOf(doc.languageId) != -1
}

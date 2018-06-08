import {
  TextDocument
} from 'vscode-languageserver-protocol'

export const typescript = 'typescript'
export const typescriptreact = 'typescript.jsx'
export const javascript = 'javascript'
export const javascriptreact = 'javascript.jsx'
export const jsxTags = 'jsx-tags'

export function isSupportedLanguageMode(doc: TextDocument):boolean {
  return [typescript, typescriptreact, javascript, javascriptreact, jsxTags].indexOf(doc.languageId) != -1

}

import { Buffer, Neovim } from '@chemzqm/neovim'
import { Disposable, SemanticTokensLegend } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import SemanticTokensHighlights from '../../handler/semanticTokensHighlights/index'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let highlighter: SemanticTokensHighlights
let legend: SemanticTokensLegend = {
  tokenTypes: [
    "comment",
    "keyword",
    "string",
    "number",
    "regexp",
    "operator",
    "namespace",
    "type",
    "struct",
    "class",
    "interface",
    "enum",
    "enumMember",
    "typeParameter",
    "function",
    "method",
    "property",
    "macro",
    "variable",
    "parameter",
    "angle",
    "arithmetic",
    "attribute",
    "bitwise",
    "boolean",
    "brace",
    "bracket",
    "builtinType",
    "character",
    "colon",
    "comma",
    "comparison",
    "constParameter",
    "dot",
    "escapeSequence",
    "formatSpecifier",
    "generic",
    "label",
    "lifetime",
    "logical",
    "operator",
    "parenthesis",
    "punctuation",
    "selfKeyword",
    "semicolon",
    "typeAlias",
    "union",
    "unresolvedReference"
  ],
  tokenModifiers: [
    "documentation",
    "declaration",
    "definition",
    "static",
    "abstract",
    "deprecated",
    "readonly",
    "constant",
    "controlFlow",
    "injected",
    "mutable",
    "consuming",
    "async",
    "library",
    "public",
    "unsafe",
    "attribute",
    "trait",
    "callable",
    "intraDocLink"
  ]
}

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  highlighter = helper.plugin.getHandler().semanticHighlighter
})

afterAll(async () => {
  await helper.shutdown()
})

beforeEach(async () => {
  async function createBuffer(code: string): Promise<Buffer> {
    let buf = await nvim.buffer
    await nvim.command('setf rust')
    await buf.setLines(code.split('\n'), { start: 0, end: -1, strictIndexing: false })
    let doc = await workspace.document
    doc.forceSync()
    return buf
  }

  disposables.push(languages.registerDocumentSemanticTokensProvider([{ language: 'rust' }], {
    provideDocumentSemanticTokens: () => {
      return {
        resultId: '1',
        data: [
          0, 0, 2, 1, 0,
          0, 3, 4, 14, 2,
          0, 4, 1, 41, 0,
          0, 1, 1, 41, 0,
          0, 2, 1, 25, 0,
          1, 4, 8, 17, 0,
          0, 8, 1, 41, 0,
          0, 1, 3, 2, 0,
          0, 3, 1, 41, 0,
          0, 1, 1, 44, 0,
          1, 0, 1, 25, 0,
        ]
      }
    }
  }, legend))
  await createBuffer(`fn main() {
    println!("H");
}`)
})

afterEach(async () => {
  workspace.configurations.updateUserConfig({
    'coc.preferences.semanticTokensHighlights': true
  })
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

describe('semanticTokens', () => {
  describe('triggerSemanticTokens', () => {
    it('should be disabled', async () => {
      await helper.createDocument()
      workspace.configurations.updateUserConfig({
        'coc.preferences.semanticTokensHighlights': false
      })
      const curr = await highlighter.getCurrentItem()
      let err
      try {
        curr.checkState()
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
      expect(err.message).toMatch('disabled by configuration')
    })

    it('should get legend by API', async () => {
      const doc = await workspace.document
      const l = languages.getLegend(doc.textDocument)
      expect(l).toEqual(legend)
    })

    it('should get semanticTokens by API', async () => {
      // const doc = await workspace.document
      // const highlights = await highlighter.getHighlights(doc.bufnr)
      // expect(highlights.length).toBe(11)
      // expect(highlights[0].hlGroup).toBe('CocSem_keyword')
    })

    it('should doHighlight', async () => {
      const doc = await workspace.document
      await nvim.call('CocAction', 'semanticHighlight')
      const highlights = await nvim.call("coc#highlight#get_highlights", [doc.bufnr, 'semanticTokens'])
      expect(highlights.length).toBe(11)
      expect(highlights[0].hlGroup).toBe('CocSem_keyword')
    })
  })
})

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
    "Comment",
    "Keyword",
    "String",
    "Number",
    "Regexp",
    "Operator",
    "Namespace",
    "Type",
    "Struct",
    "Class",
    "Interface",
    "Enum",
    "EnumMember",
    "TypeParameter",
    "Function",
    "Method",
    "Property",
    "Macro",
    "Variable",
    "Parameter",
    "Angle",
    "Arithmetic",
    "Attribute",
    "Bitwise",
    "Boolean",
    "Brace",
    "Bracket",
    "BuiltinType",
    "Character",
    "Colon",
    "Comma",
    "Comparison",
    "ConstParameter",
    "Dot",
    "EscapeSequence",
    "FormatSpecifier",
    "Generic",
    "Label",
    "Lifetime",
    "Logical",
    "Operator",
    "Parenthesis",
    "Punctuation",
    "SelfKeyword",
    "Semicolon",
    "TypeAlias",
    "Union",
    "UnresolvedReference"
  ],
  tokenModifiers: [
    "Documentation",
    "Declaration",
    "Definition",
    "Static",
    "Abstract",
    "Deprecated",
    "Readonly",
    "Constant",
    "ControlFlow",
    "Injected",
    "Mutable",
    "Consuming",
    "Async",
    "Library",
    "Public",
    "Unsafe",
    "Attribute",
    "Trait",
    "Callable",
    "IntraDocLink"
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
    await doc.synchronize()
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
    'coc.preferences.semanticTokensFiletypes': []
  })
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

describe('semanticTokens', () => {
  describe('triggerSemanticTokens', () => {
    it('should be disabled by default', async () => {
      const curr = await highlighter.getCurrentItem()
      expect(curr.enabled).toBe(false)
    })

    it('should be enabled', async () => {
      workspace.configurations.updateUserConfig({
        'coc.preferences.semanticTokensFiletypes': ['rust']
      })
      const curr = await highlighter.getCurrentItem()
      expect(curr.enabled).toBe(true)
    })

    it('should get legend by API', async () => {
      const doc = await workspace.document
      const l = languages.getLegend(doc.textDocument)
      expect(l).toEqual(legend)
    })

    it('should doHighlight', async () => {
      workspace.configurations.updateUserConfig({
        'coc.preferences.semanticTokensFiletypes': ['rust']
      })
      const doc = await workspace.document
      await nvim.call('CocAction', 'semanticHighlight')
      const highlights = await nvim.call("coc#highlight#get_highlights", [doc.bufnr, 'semanticTokens'])
      expect(highlights.length).toBe(11)
      expect(highlights[0][0]).toBe('TSKeyword')
    })
  })
})

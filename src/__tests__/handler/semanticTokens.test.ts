import { Buffer, Neovim } from '@chemzqm/neovim'
import { Disposable, SemanticTokensLegend } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import SemanticTokensHighlights from '../../handler/semanticTokensHighlights/index'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import window from '../../window'
import commandManager from '../../commands'
import helper from '../helper'

let nvim: Neovim
let ns: number
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
  ns = await nvim.call('coc#highlight#create_namespace', ['semanticTokens'])
  highlighter = helper.plugin.getHandler().semanticHighlighter
})

afterAll(async () => {
  await helper.shutdown()
})

const defaultResult = {
  resultId: '1',
  data: [
    0, 0, 2, 1, 0,
    0, 3, 4, 14, 2,
    0, 4, 1, 41, 0,
    0, 1, 1, 41, 3,
    0, 2, 1, 25, 0,
    1, 4, 8, 17, 0,
    0, 8, 1, 41, 0,
    0, 1, 3, 2, 0,
    0, 3, 1, 41, 0,
    0, 1, 1, 44, 0,
    1, 0, 1, 25, 0,
  ]
}
beforeEach(async () => {
  workspace.configurations.updateUserConfig({
    'semanticTokens.filetypes': ['rust']
  })
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
      return defaultResult
    },
    provideDocumentSemanticTokensEdits: (_, previousResultId) => {
      if (previousResultId !== '1') return undefined
      return {
        resultId: '2',
        edits: [{
          start: 0,
          deleteCount: 0,
          data: [0, 0, 3, 1, 0]
        }]
      }
    }
  }, legend))
  await createBuffer(`fn main() {
    println!("H");
}`)
})

afterEach(async () => {
  workspace.configurations.updateUserConfig({
    'semanticTokens.filetypes': []
  })
  await helper.reset()
  disposeAll(disposables)
})

describe('semanticTokens', () => {
  describe('showHiglightInfo()', () => {
    it('should show error when buffer not attached', async () => {
      await nvim.command('h')
      await highlighter.showHiglightInfo()
      let line = await helper.getCmdline()
      expect(line).toMatch('not attached')
      await highlighter.inspectSemanticToken()
    })

    it('should show message when not enabled', async () => {
      await helper.edit('t.txt')
      await highlighter.showHiglightInfo()
      let buf = await nvim.buffer
      let lines = await buf.lines
      expect(lines[2]).toMatch('not enabled for current filetype')
    })

    it('should show semantic tokens info', async () => {
      await highlighter.highlightCurrent()
      await commandManager.executeCommand('semanticTokens.checkCurrent')
      let buf = await nvim.buffer
      let lines = await buf.lines
      let content = lines.join('\n')
      expect(content).toMatch('Semantic highlight groups used by current buffer')
    })
  })

  describe('highlightCurrent()', () => {
    it('should refresh highlights', async () => {
      await nvim.command('hi link CocSemDeclarationFunction MoreMsg')
      await nvim.command('hi link CocSemDocumentation Statement')
      await window.moveTo({ line: 0, character: 4 })
      await highlighter.highlightCurrent()
      await commandManager.executeCommand('semanticTokens.inspect')
      let win = await helper.getFloat()
      let buf = await win.buffer
      let lines = await buf.lines
      let content = lines.join('\n')
      expect(content).toMatch('CocSemDeclarationFunction')
    })

    it('should refresh highlights by command', async () => {
      await helper.edit()
      let err
      try {
        await commandManager.executeCommand('semanticTokens.refreshCurrent')
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
    })
  })

  describe('clear highlights', () => {
    it('should clear highlights of current buffer', async () => {
      await highlighter.highlightCurrent()
      let buf = await nvim.buffer
      let markers = await buf.getExtMarks(ns, 0, -1)
      expect(markers.length).toBeGreaterThan(0)
      await commandManager.executeCommand('semanticTokens.clearCurrent')
      markers = await buf.getExtMarks(ns, 0, -1)
      expect(markers.length).toBe(0)
    })

    it('should clear all highlights', async () => {
      await highlighter.highlightCurrent()
      let buf = await nvim.buffer
      await commandManager.executeCommand('semanticTokens.clearAll')
      let markers = await buf.getExtMarks(ns, 0, -1)
      expect(markers.length).toBe(0)
    })

    it('should clear highlight by api', async () => {
      let item = await highlighter.getCurrentItem()
      item.clearHighlight()
      await helper.wait(50)
      let buf = await nvim.buffer
      let markers = await buf.getExtMarks(ns, 0, -1)
      expect(markers.length).toBe(0)
    })
  })

  describe('triggerSemanticTokens', () => {
    it('should be disabled by default', async () => {
      workspace.configurations.updateUserConfig({
        'semanticTokens.filetypes': []
      })
      const curr = await highlighter.getCurrentItem()
      expect(curr.enabled).toBe(false)
    })

    it('should be enabled', async () => {
      const curr = await highlighter.getCurrentItem()
      expect(curr.enabled).toBe(true)
    })

    it('should get legend by API', async () => {
      const doc = await workspace.document
      const l = languages.getLegend(doc.textDocument)
      expect(l).toEqual(legend)
    })

    it('should doHighlight', async () => {
      const doc = await workspace.document
      await nvim.call('CocAction', 'semanticHighlight')
      const highlights = await nvim.call("coc#highlight#get_highlights", [doc.bufnr, 'semanticTokens'])
      expect(highlights.length).toBeGreaterThan(0)
      expect(highlights[0][0]).toBe('CocSemKeyword')
    })
  })

  describe('delta update', () => {
    it('should perform highlight update', async () => {
      let buf = await nvim.buffer
      await highlighter.highlightCurrent()
      await window.moveTo({ line: 0, character: 0 })
      let doc = await workspace.document
      await nvim.input('if')
      await doc.synchronize()
      let curr = await highlighter.getCurrentItem()
      await curr.forceHighlight()
      let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      expect(markers.length).toBeGreaterThan(0)
      expect(markers[0][3].end_col).toBe(3)
    })
  })
})

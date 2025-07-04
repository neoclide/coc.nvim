import { Buffer, Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { CancellationToken, CancellationTokenSource, Disposable, Position, Range, SemanticTokensLegend, TextEdit } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import commandManager from '../../commands'
import events from '../../events'
import SemanticTokensBuffer, { NAMESPACE, toHighlightPart } from '../../handler/semanticTokens/buffer'
import SemanticTokens from '../../handler/semanticTokens/index'
import languages from '../../languages'
import { disposeAll } from '../../util'
import { CancellationError } from '../../util/errors'
import window from '../../window'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

const tempDir = fs.mkdtempSync(path.join(tmpdir(), 'coc'))

let nvim: Neovim
let ns: number
let disposables: Disposable[] = []
let semanticTokens: SemanticTokens
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
  ns = await nvim.createNamespace('coc-semanticTokens')
  semanticTokens = helper.plugin.getHandler().semanticHighlighter
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
  semanticTokens.setStaticConfiguration()
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

async function waitRefresh(tokenBuffer: SemanticTokensBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => {
      disposable.dispose()
      reject(new Error(`Timeout after 500ms`))
    }, 500)
    let disposable = tokenBuffer.onDidRefresh(() => {
      disposable.dispose()
      clearTimeout(timer)
      resolve()
    })
  })
}

function registerRangeProvider(filetype: string, fn: (range: Range) => number[]): Disposable {
  return languages.registerDocumentRangeSemanticTokensProvider([{ language: filetype }], {
    provideDocumentRangeSemanticTokens: (_, range) => {
      return {
        data: fn(range)
      }
    }
  }, legend)
}

function registerProvider(): void {
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
}

async function createRustBuffer(enableProvider = true): Promise<Buffer> {
  helper.updateConfiguration('semanticTokens.filetypes', ['rust'])
  if (enableProvider) registerProvider()
  await helper.wait(2)
  let doc = await workspace.document
  let code = `fn main() {
    println!("H");
}`
  let buf = await nvim.buffer
  doc.setFiletype('rust')
  await buf.setLines(code.split('\n'), { start: 0, end: -1, strictIndexing: false })
  await doc.patchChange()
  return buf
}

describe('semanticTokens', () => {
  describe('toHighlightPart()', () => {
    it('should convert to highlight part', () => {
      expect(toHighlightPart('')).toBe('')
      expect(toHighlightPart('token')).toBe('Token')
      expect(toHighlightPart('is key word')).toBe('Is_key_word')
      expect(toHighlightPart('token')).toBe('Token')
    })
  })

  describe('Provider', () => {
    it('should not throw when buffer item not found', async () => {
      await events.fire('CursorMoved', [9])
      await events.fire('BufWinEnter', [9])
    })

    it('should return null when range provider not exists', async () => {
      let doc = await workspace.document
      let res = await languages.provideDocumentRangeSemanticTokens(doc.textDocument, Range.create(0, 0, 1, 0), CancellationToken.None)
      expect(res).toBeNull()
    })

    it('should return false when not hasSemanticTokensEdits', async () => {
      let doc = await workspace.document
      let res = languages.hasSemanticTokensEdits(doc.textDocument)
      expect(res).toBe(false)
    })

    it('should return null when semanticTokens provider not exists', async () => {
      let token = CancellationToken.None
      let doc = await workspace.document
      let res = await languages.provideDocumentSemanticTokens(doc.textDocument, token)
      expect(res).toBeNull()
      let r = await languages.provideDocumentSemanticTokensEdits(doc.textDocument, '', token)
      expect(r).toBeNull()
    })
  })

  describe('showHighlightInfo()', () => {
    it('should show error when not enabled', async () => {
      await nvim.command('enew')
      let doc = await workspace.document
      let winid = await nvim.call('win_getid') as number
      let item = semanticTokens.getItem(doc.bufnr)
      await item.onCursorHold(winid, 1)
      await semanticTokens.inspectSemanticToken()
      let line = await helper.getCmdline()
      expect(line).toMatch('not enabled')
    })

    it('should show error message for buffer not attached', async () => {
      await nvim.command(`edit +setl\\ buftype=nofile foo`)
      await helper.doAction('inspectSemanticToken')
      let msg = await helper.getCmdline()
      expect(msg).toMatch(/not attached/)
    })

    it('should show message when not enabled', async () => {
      await helper.edit('t.txt')
      await helper.doAction('showSemanticHighlightInfo')
      let buf = await nvim.buffer
      let lines = await buf.lines
      expect(lines[2]).toMatch('not enabled for current filetype')
    })

    it('should show semantic tokens info', async () => {
      await createRustBuffer()
      await semanticTokens.highlightCurrent()
      await commandManager.executeCommand('semanticTokens.checkCurrent')
      let buf = await nvim.buffer
      let lines = await buf.lines
      let content = lines.join('\n')
      expect(content).toMatch('Semantic highlight groups used by current buffer')
    })

    it('should show highlight info for empty legend', async () => {
      helper.updateConfiguration('semanticTokens.filetypes', ['*'])
      disposables.push(languages.registerDocumentRangeSemanticTokensProvider([{ language: '*' }], {
        provideDocumentRangeSemanticTokens: (_, range) => {
          return {
            data: []
          }
        }
      }, { tokenModifiers: [], tokenTypes: [] }))
      await semanticTokens.showHighlightInfo()
      let buf = await nvim.buffer
      let lines = await buf.lines
      let content = lines.join('\n')
      expect(content).toMatch('No token')
    })
  })

  describe('highlightCurrent()', () => {
    it('should only highlight limited range on update', async () => {
      helper.updateConfiguration('semanticTokens.filetypes', ['vim'])
      let doc = await helper.createDocument('t.vim')
      let called = false
      disposables.push(languages.registerDocumentSemanticTokensProvider([{ language: 'vim' }], {
        provideDocumentSemanticTokens: (doc, token) => {
          let text = doc.getText()
          if (!text.trim()) {
            return Promise.resolve({ resultId: '1', data: [] })
          }
          let lines = text.split('\n')
          let data = [0, 0, 1, 1, 0]
          for (let i = 0; i < lines.length; i++) {
            data.push(1, 0, 1, 1, 0)
          }
          return new Promise(resolve => {
            token.onCancellationRequested(() => {
              clearTimeout(timer)
              resolve(undefined)
            })
            let timer = setTimeout(() => {
              called = true
              resolve({ resultId: '1', data })
            }, 10)
          })
        }
      }, legend))
      let item = await semanticTokens.getCurrentItem()
      item['_dirty'] = true
      await item.doHighlight(false, 0)
      let newLine = 'l\n'
      await doc.applyEdits([{ range: Range.create(0, 0, 0, 0), newText: `${newLine.repeat(1000)}` }])
      await item.doHighlight(false, 0)
      await helper.waitValue(() => called, true)
      let buf = doc.buffer
      let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      let len = markers.length
      expect(len).toBeLessThan(400)
      await nvim.call('cursor', [1, 1])
      let winid = await nvim.call('win_getid') as number
      await item.onWinScroll(winid)
      await helper.waitValue(async () => {
        let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
        return markers.length > 100
      }, true)
      await nvim.call('cursor', [200, 1])
      await item.onWinScroll(winid)
      await helper.waitValue(async () => {
        let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
        return markers.length > 200
      }, true)
    })

    it('should refresh highlights', async () => {
      await createRustBuffer()
      await nvim.command('hi link CocSemDeclarationFunction MoreMsg')
      await nvim.command('hi link CocSemDocumentation Statement')
      await window.moveTo({ line: 0, character: 4 })
      await semanticTokens.highlightCurrent()
      await commandManager.executeCommand('semanticTokens.inspect')
      let win = await helper.getFloat()
      let buf = await win.buffer
      let lines = await buf.lines
      let content = lines.join('\n')
      expect(content).toMatch('Type: function\nModifiers: declaration\nHighlight group: CocSemTypeFunction')
      await window.moveTo({ line: 1, character: 0 })
      await commandManager.executeCommand('semanticTokens.inspect')
      win = await helper.getFloat()
      expect(win).toBeUndefined()
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

    it('should reuse exists tokens when version not changed', async () => {
      let doc = await helper.createDocument('t.vim')
      await doc.applyEdits([{ range: Range.create(0, 0, 0, 0), newText: 'let' }])
      let times = 0
      helper.updateConfiguration('semanticTokens.filetypes', ['vim'])
      disposables.push(languages.registerDocumentSemanticTokensProvider([{ language: 'vim' }], {
        provideDocumentSemanticTokens: () => {
          times++
          return new Promise(resolve => {
            resolve({
              resultId: '1',
              data: [0, 0, 3, 1, 0]
            })
          })
        }
      }, legend))
      let item = await semanticTokens.getCurrentItem()
      await helper.waitValue(() => {
        return times
      }, 1)
      await item.doHighlight(false, 0)
      await item.doHighlight(false, 0)
      expect(times).toBe(1)
    })

    it('should return null when request cancelled', async () => {
      let doc = await helper.createDocument('t.vim')
      let lines: string[] = []
      for (let i = 0; i < 2000; i++) {
        lines.push('foo')
      }
      await doc.applyEdits([{ range: Range.create(0, 0, 0, 0), newText: lines.join('\n') }])
      helper.updateConfiguration('semanticTokens.filetypes', [])
      let cancel = true
      let item = await semanticTokens.getCurrentItem()
      disposables.push(languages.registerDocumentSemanticTokensProvider([{ language: 'vim' }], {
        provideDocumentSemanticTokens: (doc, token) => {
          return new Promise(resolve => {
            if (cancel) {
              process.nextTick(() => {
                item.cancel()
              })
            }
            let data = []
            for (let i = 0; i < 2000; i++) {
              data.push(...[i == 0 ? 0 : 1, 0, 3, 1, 1])
            }
            resolve({
              resultId: '1',
              data
            })
          })
        }
      }, legend))
      helper.updateConfiguration('semanticTokens.filetypes', ['vim'])
      await item.doHighlight(false, 0)
      cancel = false
      let spy = jest.spyOn(window, 'diffHighlights').mockImplementation(() => {
        return Promise.resolve(null)
      })
      let winid = await nvim.call('win_getid') as number
      await item.doHighlight(false, 10, winid)
      await item.doHighlight(false, 0, winid)
      spy.mockRestore()
      expect(item.highlights).toBeDefined()
      await helper.edit('bar')
    })

    it('should highlight hidden buffer on shown', async () => {
      helper.updateConfiguration('semanticTokens.filetypes', ['rust'])
      registerProvider()
      await nvim.command('edit foo')
      let code = 'fn main() {\n  println!("H"); \n}'
      let filepath = path.join(tempDir, 'a.rs')
      fs.writeFileSync(filepath, code, 'utf8')
      let uri = URI.file(filepath).toString()
      await workspace.loadFile(uri, '')
      let doc = workspace.getDocument(uri)
      await nvim.command('b ' + doc.bufnr)
      let item = semanticTokens.getItem(doc.bufnr)
      let called = false
      item.onDidRefresh(() => {
        called = true
      })
      let buf = doc.buffer
      expect(doc.filetype).toBe('rust')
      await nvim.command(`b ${buf.id}`)
      await helper.waitValue(() => {
        return called
      }, true)
    })

    it('should no highlights when request cancelled', async () => {
      helper.updateConfiguration('semanticTokens.filetypes', [])
      let doc = await workspace.document
      let item = semanticTokens.getItem(doc.bufnr)
      disposables.push(languages.registerDocumentRangeSemanticTokensProvider([{ language: '*' }], {
        provideDocumentRangeSemanticTokens: () => {
          item.cancel()
          return null
        }
      }, legend))
      let disposable = languages.registerDocumentSemanticTokensProvider([{ language: '*' }], {
        provideDocumentSemanticTokens: (_, token) => {
          item.cancel()
          return null
        }
      }, legend)
      helper.updateConfiguration('semanticTokens.filetypes', ['*'])
      await item.doHighlight(true, 0)
      expect(item.highlights).toBeUndefined()
      disposable.dispose()
      let winid = await nvim.call('win_getid') as number
      await item.doHighlight(true)
      await item.onWinScroll(winid)
    })
  })

  describe('highlightRegions()', () => {
    it('should refresh when buffer visible', async () => {
      let buf = await createRustBuffer(false)
      let doc = await workspace.document
      let item = await semanticTokens.getCurrentItem()
      let winid = await nvim.call('win_getid') as number
      await item.highlightRegions(winid, CancellationToken.None)
      await doc.synchronize()
      expect(item.enabled).toBe(false)
      await nvim.command('edit bar')
      registerProvider()
      await helper.wait(10)
      expect(item.enabled).toBe(true)
      await nvim.command(`b ${buf.id}`)
      await waitRefresh(item)
      expect(item.highlights).toBeDefined()
      await item.highlightRegions(9999, CancellationToken.None)
    })

    it('should not highlight same region', async () => {
      let buf = await createRustBuffer()
      let item = semanticTokens.getItem(buf.id)
      let winid = await nvim.call('win_getid') as number
      await item.doHighlight(false, 0)
      await item.highlightRegions(winid, CancellationToken.None)
      await item.highlightRegions(winid, CancellationToken.None)
    })

    it('should highlight region on CursorHold', async () => {
      let buf = await createRustBuffer()
      let item = semanticTokens.getItem(buf.id)
      let winid = await nvim.call('win_getid') as number
      await item.doHighlight(true, 0, winid)
      buf.clearNamespace(NAMESPACE)
      await item.onCursorHold(winid, 1)
      let highlights = await buf.getHighlights(NAMESPACE)
      expect(highlights.length).toBeGreaterThan(0)
    })

    it('should cancel region highlight', async () => {
      let buf = await createRustBuffer()
      let item = semanticTokens.getItem(buf.id)
      await item.doHighlight(false, 0)
      let tokenSource = new CancellationTokenSource()
      let spy = jest.spyOn(window, 'diffHighlights').mockImplementation(() => {
        tokenSource.cancel()
        return Promise.resolve(null)
      })
      let winid = await nvim.call('win_getid') as number
      await item.highlightRegions(winid, tokenSource.token)
      spy.mockRestore()
    })
  })

  describe('requestRangeHighlights()', () => {
    it('should return null when canceled', async () => {
      let doc = await workspace.document
      let item = semanticTokens.getItem(doc.bufnr)
      let winid = await nvim.call('win_getid') as number
      let res = await item.requestRangeHighlights(winid, undefined, CancellationToken.Cancelled)
      expect(res).toBeNull()
      let tokenSource = new CancellationTokenSource()
      disposables.push(languages.registerDocumentRangeSemanticTokensProvider([{ language: '*' }], {
        provideDocumentRangeSemanticTokens: () => {
          tokenSource.cancel()
          return { data: [] }
        }
      }, legend))
      res = await item.requestRangeHighlights(winid, undefined, tokenSource.token)
      expect(res).toBeNull()
    })

    it('should return null when convert tokens canceled ', async () => {
      let doc = await workspace.document
      let item = semanticTokens.getItem(doc.bufnr)
      let tokenSource = new CancellationTokenSource()
      disposables.push(languages.registerDocumentRangeSemanticTokensProvider([{ language: '*' }], {
        provideDocumentRangeSemanticTokens: () => {
          return { data: [1, 0, 0, 1, 0] }
        }
      }, legend))
      let spy = jest.spyOn(item, 'getTokenRanges').mockImplementation(() => {
        return Promise.resolve(null)
      })
      let winid = await nvim.call('win_getid') as number
      let res = await item.requestRangeHighlights(winid, undefined, tokenSource.token)
      expect(res).toBeNull()
      spy.mockRestore()
    })
  })

  describe('clear highlights', () => {
    it('should clear highlights of current buffer', async () => {
      await createRustBuffer()
      await semanticTokens.highlightCurrent()
      let buf = await nvim.buffer
      let markers = await buf.getExtMarks(ns, 0, -1)
      expect(markers.length).toBeGreaterThan(0)
      await commandManager.executeCommand('semanticTokens.clearCurrent')
      markers = await buf.getExtMarks(ns, 0, -1)
      expect(markers.length).toBe(0)
    })

    it('should clear all highlights', async () => {
      await createRustBuffer()
      await semanticTokens.highlightCurrent()
      let buf = await nvim.buffer
      await commandManager.executeCommand('semanticTokens.clearAll')
      let markers = await buf.getExtMarks(ns, 0, -1)
      expect(markers.length).toBe(0)
    })
  })

  describe('doRangeHighlight()', () => {
    it('should invoke range provider first time when both kinds exist', async () => {
      let called = false
      disposables.push(registerRangeProvider('rust', () => {
        called = true
        return []
      }))
      let buf = await createRustBuffer()
      let item = semanticTokens.getItem(buf.id)
      await waitRefresh(item)
      expect(called).toBe(true)
    })

    it('should do range highlight first time', async () => {
      helper.updateConfiguration('semanticTokens.filetypes', ['vim'])
      let r: Range
      disposables.push(registerRangeProvider('vim', range => {
        r = range
        return [0, 0, 3, 1, 0]
      }))
      let filepath = await createTmpFile('let')
      fs.renameSync(filepath, filepath + '.vim')
      let doc = await helper.createDocument(filepath + '.vim')
      let item = await semanticTokens.getCurrentItem()
      await doc.synchronize()
      expect(doc.filetype).toBe('vim')
      await helper.waitValue(() => {
        return typeof r !== 'undefined'
      }, true)
      let winid = await nvim.call('win_getid') as number
      await item.onWinScroll(winid)
    })

    it('should do range highlight after cursor moved', async () => {
      helper.updateConfiguration('semanticTokens.filetypes', ['vim'])
      let doc = await helper.createDocument(`95cb98ca-df0a-4cac-9cd3-2459db259b71.vim`)
      await nvim.call('cursor', [1, 1])
      let r: Range
      expect(doc.filetype).toBe('vim')
      await nvim.call('setline', [2, (new Array(200).fill(''))])
      await doc.applyEdits([{ range: Range.create(0, 0, 0, 0), newText: 'let' }])
      disposables.push(registerRangeProvider('vim', range => {
        r = range
        return []
      }))
      let item = semanticTokens.getItem(doc.bufnr)
      item.cancel()
      nvim.call('cursor', [201, 1], true)
      await helper.waitValue(() => {
        return r && r.end.line > 200
      }, true)
    })

    it('should not throw when range request throws', async () => {
      helper.updateConfiguration('semanticTokens.filetypes', ['*'])
      let doc = await workspace.document
      let called = false
      disposables.push(languages.registerDocumentRangeSemanticTokensProvider([{ language: '*' }], {
        provideDocumentRangeSemanticTokens: (_, range) => {
          called = true
          throw new Error('custom error')
        }
      }, legend))
      await helper.wait(2)
      let item = semanticTokens.getItem(doc.bufnr)
      let winid = await nvim.call('win_getid') as number
      await item.doRangeHighlight(winid, undefined, CancellationToken.None)
      expect(called).toBe(true)
    })

    it('should only cancel range highlight request', async () => {
      let rangeCancelled = false
      disposables.push(languages.registerDocumentRangeSemanticTokensProvider([{ language: 'vim' }], {
        provideDocumentRangeSemanticTokens: (_, range, token) => {
          return new Promise(resolve => {
            token.onCancellationRequested(() => {
              clearTimeout(timeout)
              rangeCancelled = true
              resolve(null)
            })
            let timeout = setTimeout(() => {
              resolve({ data: [] })
            }, 500)
          })
        }
      }, legend))
      disposables.push(languages.registerDocumentSemanticTokensProvider([{ language: 'vim' }], {
        provideDocumentSemanticTokens: (_, token) => {
          return new Promise(resolve => {
            resolve({
              resultId: '1',
              data: [0, 0, 3, 1, 0]
            })
          })
        }
      }, legend))
      let doc = await helper.createDocument('t.vim')
      await doc.applyEdits([{ range: Range.create(0, 0, 0, 0), newText: 'let' }])
      let item = await semanticTokens.getCurrentItem()
      helper.updateConfiguration('semanticTokens.filetypes', ['vim'])
      item.cancel()
      let p = item.doHighlight(false, 0)
      await helper.wait(10)
      item.cancel(true)
      await p
      expect(rangeCancelled).toBe(true)
    })

    it('should do range highlight on CursorHold', async () => {
      helper.updateConfiguration('semanticTokens.filetypes', ['vim'])
      disposables.push(registerRangeProvider('vim', range => {
        return [0, 0, 3, 1, 0]
      }))
      await helper.wait(10)
      let doc = await helper.createDocument('t.vim')
      await nvim.call('cursor', [1, 1])
      await doc.applyEdits([{ range: Range.create(0, 0, 0, 0), newText: 'let' }])
      let item = semanticTokens.getItem(doc.bufnr)
      item.cancel()
      let winid = await nvim.call('win_getid') as number
      doc.buffer.clearNamespace(NAMESPACE)
      await item.onCursorHold(winid, 1)
      let highlights = await doc.buffer.getHighlights(NAMESPACE)
      expect(highlights.length).toBe(1)
    })
  })

  describe('triggerSemanticTokens', () => {
    it('should be disabled by default', async () => {
      helper.updateConfiguration('semanticTokens.filetypes', [])
      await workspace.document
      const curr = await semanticTokens.getCurrentItem()
      expect(curr.enabled).toBe(false)
    })

    it('should be enabled', async () => {
      await createRustBuffer()
      const curr = await semanticTokens.getCurrentItem()
      expect(curr.enabled).toBe(true)
    })

    it('should get legend by API', async () => {
      await createRustBuffer()
      const doc = await workspace.document
      const l = languages.getLegend(doc.textDocument)
      expect(l).toEqual(legend)
    })

    it('should doHighlight', async () => {
      await createRustBuffer()
      const doc = await workspace.document
      await nvim.call('CocAction', 'semanticHighlight')
      const highlights = await doc.buffer.getHighlights(NAMESPACE)
      expect(highlights.length).toBeGreaterThan(0)
      expect(highlights[0].hlGroup).toBe('CocSemTypeKeyword')
    })
  })

  describe('delta update', () => {
    it('should perform highlight update', async () => {
      await createRustBuffer()
      let buf = await nvim.buffer
      await semanticTokens.highlightCurrent()
      await window.moveTo({ line: 0, character: 0 })
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo')])
      let curr = await semanticTokens.getCurrentItem()
      await curr.requestAllHighlights(CancellationToken.None, false)
      let markers = await buf.getExtMarks(ns, 0, -1, {})
      expect(markers.length).toBeGreaterThan(0)
    })
  })

  describe('checkState', () => {
    it('should throw for invalid state', async () => {
      let doc = await workspace.document
      const toThrow = (cb: () => void) => {
        expect(cb).toThrow(Error)
      }
      let item = semanticTokens.getItem(doc.bufnr)
      toThrow(() => {
        item.checkState()
      })
      helper.updateConfiguration('semanticTokens.filetypes', ['*'])
      toThrow(() => {
        item.checkState()
      })
      toThrow(() => {
        item.checkState()
      })
      let enabled = item.enabled
      expect(enabled).toBe(false)
      expect(() => {
        item.checkState()
      }).toThrow('provider not found')
      registerProvider()
    })
  })

  describe('enabled', () => {
    it('should check if buffer enabled for semanticTokens', async () => {
      let doc = await workspace.document
      let item = semanticTokens.getItem(doc.bufnr)
      disposables.push(languages.registerDocumentRangeSemanticTokensProvider([{ language: '*' }], {
        provideDocumentRangeSemanticTokens: (_, range) => {
          return {
            data: []
          }
        }
      }, { tokenModifiers: [], tokenTypes: [] }))
      await helper.wait(2)
      let winid = await nvim.call('win_getid') as number
      await item.onShown(winid)
      expect(item.enabled).toBe(false)
      helper.updateConfiguration('semanticTokens.filetypes', ['vim'])
      expect(item.enabled).toBe(false)
      helper.updateConfiguration('semanticTokens.filetypes', ['*'])
      expect(item.enabled).toBe(true)
    })

    it('should toggle enable by configuration', async () => {
      helper.updateConfiguration('semanticTokens.enable', false)
      let buf = await createRustBuffer()
      let item = semanticTokens.getItem(buf.id)
      helper.updateConfiguration('semanticTokens.enable', true)
      await waitRefresh(item)
      let markers = await buf.getExtMarks(ns, 0, -1, {})
      expect(markers.length).toBeGreaterThan(0)
      helper.updateConfiguration('semanticTokens.enable', false)
      markers = await buf.getExtMarks(ns, 0, -1, {})
      expect(markers.length).toBe(0)
      helper.updateConfiguration('semanticTokens.enable', true)
    })
  })

  describe('Server cancelled', () => {
    beforeEach(() => {
      helper.updateConfiguration('semanticTokens.filetypes', ['*'])
    })

    it('should retrigger range request on server cancel', async () => {
      let times = 0
      disposables.push(languages.registerDocumentRangeSemanticTokensProvider([{ language: '*' }], {
        provideDocumentRangeSemanticTokens: () => {
          times++
          if (times == 1) {
            throw new CancellationError()
          }
          return {
            data: []
          }
        }
      }, { tokenModifiers: [], tokenTypes: [] }))
      await helper.waitValue(() => {
        return times > 1
      }, true)
    })

    it('should retrigger full request on server cancel', async () => {
      helper.updateConfiguration('semanticTokens.enable', true)
      await workspace.document
      let times = 0
      disposables.push(languages.registerDocumentSemanticTokensProvider([{ language: '*' }], {
        provideDocumentSemanticTokens: () => {
          times++
          if (times == 1) {
            throw new CancellationError()
          }
          return {
            data: []
          }
        }
      }, { tokenModifiers: [], tokenTypes: [] }))
      await helper.waitValue(() => {
        return times
      }, 2)
    })
  })
})

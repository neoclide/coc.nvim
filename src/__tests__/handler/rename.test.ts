import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import commands from '../../commands'
import Rename from '../../handler/rename'
import languages from '../../languages'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import type RenameType from '../../handler/rename'


let nvim: Neovim
let disposables: Disposable[] = []
let rename: RenameType

before(async () => {
  nvim = workspace.nvim
  rename = getCurrentPlugin().getHandler().rename
})

function getWordRangeAtPosition(doc: TextDocument, position: Position): Range | null {
  let lines = doc.getText().split(/\r?\n/)
  let line = lines[position.line]
  if (line.length == 0 || position.character >= line.length) return null
  if (!/\w/.test(line[position.character])) return null
  let start = position.character
  let end = position.character + 1
  if (!/\w/.test(line[start])) {
    return Range.create(position, { line: position.line, character: position.character + 1 })
  }
  while (start >= 0) {
    let ch = line[start - 1]
    if (!ch || !/\w/.test(ch)) break
    start = start - 1
  }
  while (end <= line.length) {
    let ch = line[end]
    if (!ch || !/\w/.test(ch)) break
    end = end + 1
  }
  return Range.create(position.line, start, position.line, end)
}

function getSymbolRanges(textDocument: TextDocument, word: string): Range[] {
  let res: Range[] = []
  let str = ''
  let content = textDocument.getText()
  for (let i = 0, l = content.length; i < l; i++) {
    let ch = content[i]
    if ('-' == ch && str.length == 0) {
      continue
    }
    let isKeyword = /\w/.test(ch)
    if (isKeyword) {
      str = str + ch
    }
    if (str.length > 0 && !isKeyword && str == word) {
      res.push(Range.create(textDocument.positionAt(i - str.length), textDocument.positionAt(i)))
    }
    if (!isKeyword) {
      str = ''
    }
  }
  return res
}

beforeEach(() => {
  disposables.push(languages.registerRenameProvider([{ language: 'javascript' }], {
    provideRenameEdits: (doc, position: Position, newName: string) => {
      let range = getWordRangeAtPosition(doc, position)
      if (range) {
        let word = doc.getText(range)
        if (word) {
          let ranges = getSymbolRanges(doc, word)
          return {
            changes: {
              [doc.uri]: ranges.map(o => TextEdit.replace(o, newName))
            }
          }
        }
      }
      return undefined
    },
    prepareRename: (doc, position) => {
      let range = getWordRangeAtPosition(doc, position)
      return range ? { range, placeholder: doc.getText(range) } : null
    }
  }))
})

afterEach(async () => {
  disposeAll(disposables)
  disposables = []
})

afterEach(editorReset)

describe('rename handler', () => {
  describe('getWordEdit', () => {
    it('should not throw when provider not found', async t => {
      await shared.edit()
      let res = await shared.doAction('getWordEdit')
      assert.strictEqual(res, null)
    })

    it('should use document symbols when prepare failed', async t => {
      let doc = await shared.createDocument('t.js')
      await nvim.setLine('a')
      await doc.synchronize()
      let res = await rename.getWordEdit()
      assert.strictEqual(res != null, true)
    })

    it('should return workspace edit', async t => {
      let doc = await shared.createDocument('t.js')
      await nvim.setLine('foo foo')
      await doc.synchronize()
      let res = await rename.getWordEdit()
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(res.changes[doc.uri].length, 2)
    })

    it('should extract words from buffer', async t => {
      let doc = await shared.createDocument('t')
      await nvim.setLine('你 你 你')
      await doc.synchronize()
      let res = await rename.getWordEdit()
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(res.changes[doc.uri].length, 3)
    })
  })

  describe('rename', () => {
    it('should throw when provider not found', async t => {
      await shared.edit()
      await assert.rejects(shared.doAction('rename', 'foo'), Error)
    })

    it('should return false for invalid position', async t => {
      let doc = await shared.createDocument('t.js')
      let res = await commands.executeCommand('editor.action.rename', [doc.uri, Position.create(0, 0)])
      assert.strictEqual(res, false)
    })

    it('should use newName from placeholder', async t => {
      let doc = await shared.createDocument('t.js')
      await nvim.setLine('foo foo foo')
      let p = commands.executeCommand('editor.action.rename', doc.uri, Position.create(0, 0))
      await shared.waitFloat()
      await nvim.input('<C-u>')
      await shared.wait(20)
      await nvim.input('bar')
      await nvim.input('<cr>')
      await p
      let line = await nvim.line
      assert.strictEqual(line, 'bar bar bar')
    })

    it('should renameCurrentWord by cursors', async t => {
      await commands.executeCommand('document.renameCurrentWord')
      let line = await shared.getCmdline()
      assert.match(line, new RegExp('Invalid position'))
      let doc = await shared.createDocument('t.js')
      await nvim.setLine('foo foo foo')
      await commands.executeCommand('document.renameCurrentWord')
      let ns = await nvim.createNamespace('coc-cursors')
      let markers = await doc.buffer.getExtMarks(ns, 0, -1)
      assert.strictEqual(markers.length, 3)
    })

    it('should return false for empty name', async t => {
      shared.updateConfiguration('coc.preferences.renameFillCurrent', false)
      await shared.createDocument('t.js')
      await nvim.setLine('foo foo foo')
      let p = rename.rename()
      await shared.waitFloat()
      await nvim.input('<C-u>')
      await shared.wait(20)
      await nvim.input('<cr>')
      let res = await p
      assert.strictEqual(res, false)
    })

    it('should not throw when provideRenameEdits throws', async t => {
      disposables.push(languages.registerRenameProvider([{ language: '*' }], {
        provideRenameEdits: () => {
          throw new Error('error')
        },
      }))
      let doc = await workspace.document
      let res = await languages.provideRenameEdits(doc.textDocument, Position.create(0, 0), 'newName', CancellationToken.None)
      assert.strictEqual(res, null)
    })

    it('should use newName from range', async t => {
      disposables.push(languages.registerRenameProvider([{ language: '*' }], {
        provideRenameEdits: (doc, position: Position, newName: string) => {
          let range = getWordRangeAtPosition(doc, position)
          if (range) {
            let word = doc.getText(range)
            if (word) {
              let ranges = getSymbolRanges(doc, word)
              return {
                changes: {
                  [doc.uri]: ranges.map(o => TextEdit.replace(o, newName))
                }
              }
            }
          }
          return undefined
        },
        prepareRename: (doc, position) => {
          let range = getWordRangeAtPosition(doc, position)
          return range ? range : null
        }
      }))
      await shared.createDocument()
      await nvim.setLine('foo foo foo')
      let p = rename.rename()
      await shared.waitFloat()
      await nvim.input('<C-u>')
      await shared.wait(20)
      await nvim.input('bar')
      await nvim.input('<cr>')
      let res = await p
      assert.strictEqual(res, true)
      await shared.waitFor('getline', ['.'], 'bar bar bar')
    })

    it('should use newName from cword', async t => {
      disposables.push(languages.registerRenameProvider([{ language: '*' }], {
        provideRenameEdits: (doc, position: Position, newName: string) => {
          let range = getWordRangeAtPosition(doc, position)
          if (range) {
            let word = doc.getText(range)
            if (word) {
              let ranges = getSymbolRanges(doc, word)
              return {
                changes: {
                  [doc.uri]: ranges.map(o => TextEdit.replace(o, newName))
                }
              }
            }
          }
          return undefined
        }
      }))
      await shared.createDocument()
      await nvim.setLine('foo foo foo')
      let p = rename.rename()
      await shared.waitFloat()
      await nvim.input('<C-u>')
      await shared.wait(20)
      await nvim.input('bar')
      await nvim.input('<cr>')
      let res = await p
      assert.strictEqual(res, true)
      let line = await nvim.getLine()
      assert.strictEqual(line, 'bar bar bar')
    })

    it('should return false when result is empty', async t => {
      disposables.push(languages.registerRenameProvider([{ language: '*' }], {
        provideRenameEdits: () => {
          return null
        }
      }))
      await shared.createDocument()
      await nvim.setLine('foo foo foo')
      let p = rename.rename()
      await shared.waitFloat()
      await nvim.input('<C-u>')
      await shared.wait(20)
      await nvim.input('bar')
      await nvim.input('<cr>')
      let res = await p
      assert.strictEqual(res, false)
    })
  })
})

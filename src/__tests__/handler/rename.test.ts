import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import commands from '../../commands'
import Rename from '../../handler/rename'
import languages from '../../languages'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let rename: Rename

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  rename = helper.plugin.getHandler().rename
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

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

describe('rename handler', () => {
  describe('getWordEdit', () => {
    it('should not throw when provider not found', async () => {
      await helper.edit()
      let res = await helper.doAction('getWordEdit')
      expect(res).toBe(null)
    })

    it('should use document symbols when prepare failed', async () => {
      let doc = await helper.createDocument('t.js')
      await nvim.setLine('a')
      await doc.synchronize()
      let res = await rename.getWordEdit()
      expect(res != null).toBe(true)
    })

    it('should return workspace edit', async () => {
      let doc = await helper.createDocument('t.js')
      await nvim.setLine('foo foo')
      await doc.synchronize()
      let res = await rename.getWordEdit()
      expect(res).toBeDefined()
      expect(res.changes[doc.uri].length).toBe(2)
    })

    it('should extract words from buffer', async () => {
      let doc = await helper.createDocument('t')
      await nvim.setLine('你 你 你')
      await doc.synchronize()
      let res = await rename.getWordEdit()
      expect(res).toBeDefined()
      expect(res.changes[doc.uri].length).toBe(3)
    })
  })

  describe('rename', () => {
    it('should throw when provider not found', async () => {
      await helper.edit()
      await expect(async () => {
        await helper.doAction('rename', 'foo')
      }).rejects.toThrow(Error)
    })

    it('should return false for invalid position', async () => {
      let doc = await helper.createDocument('t.js')
      let res = await commands.executeCommand('editor.action.rename', [doc.uri, Position.create(0, 0)])
      expect(res).toBe(false)
    })

    it('should use newName from placeholder', async () => {
      let doc = await helper.createDocument('t.js')
      await nvim.setLine('foo foo foo')
      let p = commands.executeCommand('editor.action.rename', doc.uri, Position.create(0, 0))
      await helper.waitFloat()
      await nvim.input('<C-u>')
      await helper.wait(10)
      await nvim.input('bar')
      await nvim.input('<cr>')
      await p
      let line = await nvim.line
      expect(line).toBe('bar bar bar')
    })

    it('should renameCurrentWord by cursors', async () => {
      await commands.executeCommand('document.renameCurrentWord')
      let line = await helper.getCmdline()
      expect(line).toMatch('Invalid position')
      let doc = await helper.createDocument('t.js')
      await nvim.setLine('foo foo foo')
      await commands.executeCommand('document.renameCurrentWord')
      let ns = await nvim.createNamespace('coc-cursors')
      let markers = await doc.buffer.getExtMarks(ns, 0, -1)
      expect(markers.length).toBe(3)
    })

    it('should return false for empty name', async () => {
      helper.updateConfiguration('coc.preferences.renameFillCurrent', false)
      await helper.createDocument('t.js')
      await nvim.setLine('foo foo foo')
      let p = rename.rename()
      await helper.waitFloat()
      await nvim.input('<C-u>')
      await helper.wait(10)
      await nvim.input('<cr>')
      let res = await p
      expect(res).toBe(false)
    })

    it('should not throw when provideRenameEdits throws', async () => {
      disposables.push(languages.registerRenameProvider([{ language: '*' }], {
        provideRenameEdits: () => {
          throw new Error('error')
        },
      }))
      let doc = await workspace.document
      let res = await languages.provideRenameEdits(doc.textDocument, Position.create(0, 0), 'newName', CancellationToken.None)
      expect(res).toBeNull()
    })

    it('should use newName from range', async () => {
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
      await helper.createDocument()
      await nvim.setLine('foo foo foo')
      let p = rename.rename()
      await helper.waitFloat()
      await nvim.input('<C-u>')
      await helper.wait(10)
      await nvim.input('bar')
      await nvim.input('<cr>')
      let res = await p
      expect(res).toBe(true)
      await helper.waitFor('getline', ['.'], 'bar bar bar')
    })

    it('should use newName from cword', async () => {
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
      await helper.createDocument()
      await nvim.setLine('foo foo foo')
      let p = rename.rename()
      await helper.waitFloat()
      await nvim.input('<C-u>')
      await helper.wait(10)
      await nvim.input('bar')
      await nvim.input('<cr>')
      let res = await p
      expect(res).toBe(true)
      let line = await nvim.getLine()
      expect(line).toBe('bar bar bar')
    })

    it('should return false when result is empty', async () => {
      disposables.push(languages.registerRenameProvider([{ language: '*' }], {
        provideRenameEdits: () => {
          return null
        }
      }))
      await helper.createDocument()
      await nvim.setLine('foo foo foo')
      let p = rename.rename()
      await helper.waitFloat()
      await nvim.input('<C-u>')
      await helper.wait(10)
      await nvim.input('bar')
      await nvim.input('<cr>')
      let res = await p
      expect(res).toBe(false)
    })
  })
})

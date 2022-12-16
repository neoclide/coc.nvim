import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Color, ColorInformation, ColorPresentation, Disposable, Position, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import commands from '../../commands'
import { toHexString } from '../../util/color'
import Colors from '../../handler/colors/index'
import languages from '../../languages'
import { ProviderResult } from '../../provider'
import { disposeAll } from '../../util'
import path from 'path'
import helper from '../helper'
import workspace from '../../workspace'
import events from '../../events'

let nvim: Neovim
let state = 'normal'
let colors: Colors
let disposables: Disposable[] = []
let colorPresentations: ColorPresentation[] = []
let disposable: Disposable
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  await nvim.command(`source ${path.join(process.cwd(), 'autoload/coc/color.vim')}`)
  colors = helper.plugin.getHandler().colors
  disposable = languages.registerDocumentColorProvider([{ language: '*' }], {
    provideColorPresentations: (
      _color: Color,
      _context: { document: TextDocument; range: Range },
      _token: CancellationToken
    ): ColorPresentation[] => colorPresentations,
    provideDocumentColors: (
      document: TextDocument,
      _token: CancellationToken
    ): ProviderResult<ColorInformation[]> => {
      if (state == 'empty') return []
      if (state == 'error') return Promise.reject(new Error('no color'))
      let matches = Array.from((document.getText() as any).matchAll(/#\w{6}/g)) as any
      return matches.map(o => {
        let start = document.positionAt(o.index)
        let end = document.positionAt(o.index + o[0].length)
        return {
          range: Range.create(start, end),
          color: getColor(255, 255, 255)
        }
      })
    }
  })
})

beforeEach(() => {
  helper.updateConfiguration('colors.filetypes', ['*'])
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  state = 'normal'
  colorPresentations = []
  disposeAll(disposables)
  await helper.reset()
})

function getColor(r: number, g: number, b: number): Color {
  return { red: r / 255, green: g / 255, blue: b / 255, alpha: 1 }
}

describe('Colors', () => {
  describe('utils', () => {
    it('should get hex string', () => {
      let color = getColor(255, 255, 255)
      let hex = toHexString(color)
      expect(hex).toBe('ffffff')
    })
  })

  describe('configuration', () => {
    it('should toggle enable state on configuration change', async () => {
      let doc = await helper.createDocument()
      helper.updateConfiguration('colors.filetypes', [])
      let enabled = colors.isEnabled(doc.bufnr)
      expect(enabled).toBe(false)
      helper.updateConfiguration('colors.enable', true)
      enabled = colors.isEnabled(doc.bufnr)
      expect(enabled).toBe(true)
      helper.updateConfiguration('colors.enable', false)
      enabled = colors.isEnabled(doc.bufnr)
      expect(enabled).toBe(false)
    })
  })

  describe('commands', () => {
    it('should register editor.action.pickColor command', async () => {
      await helper.mockFunction('coc#color#pick_color', [0, 0, 0])
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      doc.forceSync()
      await colors.doHighlight(doc.bufnr)
      await commands.executeCommand('editor.action.pickColor')
      let line = await nvim.getLine()
      expect(line).toBe('#000000')
    })

    it('should register editor.action.colorPresentation command', async () => {
      colorPresentations = [ColorPresentation.create('red'), ColorPresentation.create('#ff0000')]
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      await doc.synchronize()
      await colors.doHighlight(doc.bufnr)
      let p = commands.executeCommand('editor.action.colorPresentation')
      await helper.waitPrompt()
      await nvim.input('1')
      await p
      let line = await nvim.getLine()
      expect(line).toBe('red')
    })

    it('should register document.toggleColors command', async () => {
      helper.updateConfiguration('colors.filetypes', [])
      helper.updateConfiguration('colors.enable', true)
      let doc = await workspace.document
      await events.fire('BufUnload', [doc.bufnr])
      await expect(async () => {
        await commands.executeCommand('document.toggleColors')
      }).rejects.toThrow(Error)
      doc = await helper.createDocument()
      expect(colors.isEnabled(doc.bufnr)).toBe(true)
      await commands.executeCommand('document.toggleColors')
      let enabled = colors.isEnabled(doc.bufnr)
      expect(enabled).toBe(false)
      await commands.executeCommand('document.toggleColors')
      enabled = colors.isEnabled(doc.bufnr)
      expect(enabled).toBe(true)
    })
  })

  describe('doHighlight', () => {
    it('should merge colors of providers', async () => {
      disposables.push(languages.registerDocumentColorProvider([{ language: '*' }], {
        provideColorPresentations: (): ColorPresentation[] => colorPresentations,
        provideDocumentColors: (
        ): ProviderResult<ColorInformation[]> => {
          return [{
            range: Range.create(0, 0, 1, 0),
            color: getColor(0, 0, 0)
          }, {
            range: Range.create(0, 0, 0, 7),
            color: getColor(1, 1, 1)
          }]
        }
      }))
      disposables.push(languages.registerDocumentColorProvider([{ language: '*' }], {
        provideColorPresentations: (): ColorPresentation[] => colorPresentations,
        provideDocumentColors: (
        ): ProviderResult<ColorInformation[]> => {
          return null
        }
      }))
      let doc = await workspace.document
      await nvim.setLine('#ffffff #ff0000')
      await doc.synchronize()
      let colors = await languages.provideDocumentColors(doc.textDocument, CancellationToken.None)
      expect(colors.length).toBe(3)
      let color = ColorInformation.create(Range.create(0, 0, 1, 0), getColor(0, 0, 0))
      let presentation = await languages.provideColorPresentations(color, doc.textDocument, CancellationToken.None)
      expect(presentation).toEqual([])
    })

    it('should clearHighlight on empty result', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      state = 'empty'
      await colors.doHighlight(doc.bufnr)
      let res = colors.hasColor(doc.bufnr)
      expect(res).toBe(false)
    })

    it('should highlight after ColorScheme event', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff #ff0000')
      await doc.synchronize()
      await colors.doHighlight(doc.bufnr)
      await events.fire('ColorScheme', [])
      expect(colors.hasColor(doc.bufnr)).toBe(true)
    })

    it('should not throw on error result', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      state = 'error'
      let err
      try {
        await colors.doHighlight(doc.bufnr)
      } catch (e) {
        err = e
      }
      expect(err).toBeUndefined()
    })

    it('should highlight after document changed', async () => {
      let doc = await helper.createDocument()
      await colors.doHighlight(doc.bufnr)
      expect(colors.hasColor(doc.bufnr)).toBe(false)
      expect(colors.hasColorAtPosition(doc.bufnr, Position.create(0, 1))).toBe(false)
      await nvim.setLine('#ffffff #ff0000')
      await doc.synchronize()
      await helper.waitValue(() => {
        return colors.hasColorAtPosition(doc.bufnr, Position.create(0, 1))
      }, true)
      expect(colors.hasColor(doc.bufnr)).toBe(true)
    })

    it('should clearHighlight on clearHighlight', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff #ff0000')
      await doc.synchronize()
      await colors.doHighlight(doc.bufnr)
      expect(colors.hasColor(doc.bufnr)).toBe(true)
      colors.clearHighlight(doc.bufnr)
      expect(colors.hasColor(doc.bufnr)).toBe(false)
    })

    it('should highlight colors', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      await colors.doHighlight(doc.bufnr)
      let exists = await nvim.call('hlexists', 'BGffffff')
      expect(exists).toBe(1)
    })
  })

  describe('hasColor()', () => {
    it('should return false when bufnr does not exist', async () => {
      let res = colors.hasColor(99)
      colors.clearHighlight(99)
      expect(res).toBe(false)
    })
  })

  describe('getColorInformation()', () => {
    it('should return null when highlighter does not exist', async () => {
      let res = await colors.getColorInformation(99)
      expect(res).toBe(null)
    })

    it('should return null when color not found', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff foo ')
      doc.forceSync()
      await colors.doHighlight(doc.bufnr)
      await nvim.call('cursor', [1, 12])
      let res = await colors.getColorInformation(doc.bufnr)
      expect(res).toBe(null)
    })
  })

  describe('hasColorAtPosition()', () => {
    it('should return false when bufnr does not exist', async () => {
      let res = colors.hasColorAtPosition(99, Position.create(0, 0))
      expect(res).toBe(false)
    })
  })

  describe('pickPresentation()', () => {
    it('should show warning when color does not exist', async () => {
      await helper.createDocument()
      await colors.pickPresentation()
      let msg = await helper.getCmdline()
      expect(msg).toMatch('Color not found')
    })

    it('should not throw when presentations do not exist', async () => {
      colorPresentations = []
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      doc.forceSync()
      await colors.doHighlight(99)
      await colors.doHighlight(doc.bufnr)
      await helper.doAction('colorPresentation')
    })

    it('should pick presentations', async () => {
      colorPresentations = [ColorPresentation.create('red'), ColorPresentation.create('#ff0000')]
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      doc.forceSync()
      await colors.doHighlight(doc.bufnr)
      let p = helper.doAction('colorPresentation')
      await helper.waitPrompt()
      await nvim.input('1')
      await p
      let line = await nvim.getLine()
      expect(line).toBe('red')
    })
  })

  describe('pickColor()', () => {
    it('should show warning when color does not exist', async () => {
      await helper.createDocument()
      await colors.pickColor()
      let msg = await helper.getCmdline()
      expect(msg).toMatch('not found')
    })

    it('should pickColor', async () => {
      await helper.mockFunction('coc#color#pick_color', [0, 0, 0])
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      doc.forceSync()
      await colors.doHighlight(doc.bufnr)
      await helper.doAction('pickColor')
      let line = await nvim.getLine()
      expect(line).toBe('#000000')
    })

    it('should not throw when pick color return 0', async () => {
      await helper.mockFunction('coc#color#pick_color', 0)
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      doc.forceSync()
      await colors.doHighlight(doc.bufnr)
      await helper.doAction('pickColor')
      let line = await nvim.getLine()
      expect(line).toBe('#ffffff')
    })

    it('should return null when provider not exists', async () => {
      disposable.dispose()
      let doc = await workspace.document
      let color = ColorInformation.create(Range.create(0, 0, 0, 6), Color.create(100, 100, 100, 0))
      let res = await languages.provideColorPresentations(color, doc.textDocument, CancellationToken.None)
      expect(res).toBeNull()
    })
  })
})

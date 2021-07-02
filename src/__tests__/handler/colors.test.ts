import helper from '../helper'
import { Neovim } from '@chemzqm/neovim'
import { Color, Range, CancellationToken, ColorInformation, Position, ColorPresentation, Disposable } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import Colors from '../../handler/colors/index'
import { toHexString } from '../../handler/colors/colorBuffer'
import languages from '../../languages'
import commands from '../../commands'
import { ProviderResult } from '../../provider'
import { disposeAll } from '../../util'

let nvim: Neovim
let state = 'normal'
let colors: Colors
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  colors = (helper.plugin as any).handler.colors

  disposables.push(languages.registerDocumentColorProvider([{ language: '*' }], {
    provideColorPresentations: (
      _color: Color,
      _context: { document: TextDocument; range: Range },
      _token: CancellationToken
    ): ColorPresentation[] => [ColorPresentation.create('red'), ColorPresentation.create('#ff0000')],
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
  }))
})

afterAll(async () => {
  disposeAll(disposables)
  await helper.shutdown()
})

afterEach(async () => {
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
    it('should toggle enable state on configuration change', () => {
      helper.updateConfiguration('coc.preferences.colorSupport', false)
      expect(colors.enabled).toBe(false)
      helper.updateConfiguration('coc.preferences.colorSupport', true)
      expect(colors.enabled).toBe(true)
    })
  })

  describe('commands', () => {
    it('should register editor.action.pickColor command', async () => {
      await helper.mockFunction('coc#util#pick_color', [0, 0, 0])
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      doc.forceSync()
      await colors.doHighlight(doc.bufnr)
      await commands.executeCommand('editor.action.pickColor')
      let line = await nvim.getLine()
      expect(line).toBe('#000000')
    })

    it('should register editor.action.colorPresentation command', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      doc.forceSync()
      await colors.doHighlight(doc.bufnr)
      let p = commands.executeCommand('editor.action.colorPresentation')
      await helper.wait(100)
      await nvim.input('1<enter>')
      await p
      let line = await nvim.getLine()
      expect(line).toBe('red')
    })
  })

  describe('doHighlight', () => {
    it('should clearHighlight on empty result', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      state = 'empty'
      await colors.doHighlight(doc.bufnr)
      let res = colors.hasColor(doc.bufnr)
      expect(res).toBe(false)
      state = 'normal'
    })

    it('should not highlight on error result', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      state = 'error'
      await colors.doHighlight(doc.bufnr)
      let res = colors.hasColor(doc.bufnr)
      expect(res).toBe(false)
      state = 'normal'
    })

    it('should highlight after document changed', async () => {
      let doc = await helper.createDocument()
      doc.forceSync()
      await colors.doHighlight(doc.bufnr)
      expect(colors.hasColor(doc.bufnr)).toBe(false)
      expect(colors.hasColorAtPosition(doc.bufnr, Position.create(0, 1))).toBe(false)
      await nvim.setLine('#ffffff #ff0000')
      doc.forceSync()
      await helper.wait(300)
      expect(colors.hasColorAtPosition(doc.bufnr, Position.create(0, 1))).toBe(true)
      expect(colors.hasColor(doc.bufnr)).toBe(true)
    })

    it('should clearHighlight on clearHighlight', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff #ff0000')
      doc.forceSync()
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

  describe('pickPresentation', () => {
    it('should pick presentations', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      doc.forceSync()
      await colors.doHighlight(doc.bufnr)
      let p = helper.doAction('colorPresentation')
      await helper.wait(100)
      await nvim.input('1<enter>')
      await p
      let line = await nvim.getLine()
      expect(line).toBe('red')
    })
  })

  describe('pickColor', () => {
    it('should pickColor', async () => {
      await helper.mockFunction('coc#util#pick_color', [0, 0, 0])
      let doc = await helper.createDocument()
      await nvim.setLine('#ffffff')
      doc.forceSync()
      await colors.doHighlight(doc.bufnr)
      await helper.doAction('pickColor')
      let line = await nvim.getLine()
      expect(line).toBe('#000000')
    })
  })
})

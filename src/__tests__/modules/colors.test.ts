import helper from '../helper'
import { Neovim } from '@chemzqm/neovim'
import { Color, Range, TextDocument, CancellationToken, ColorInformation, ColorPresentation, Disposable } from 'vscode-languageserver-protocol'
import Colors from '../../handler/colors'
import { toHexString } from '../../handler/highlighter'
import languages from '../../languages'
import { ProviderResult } from '../../provider'
import { disposeAll } from '../../util'

let nvim: Neovim
let state = 'normal'
let colors: Colors
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  await helper.wait(500)
  nvim = helper.nvim
  colors = (helper.plugin as any).handler.colors

  disposables.push(languages.registerDocumentColorProvider([{ language: '*' }], {
    provideColorPresentations: (
      _color: Color,
      _context: { document: TextDocument; range: Range },
      _token: CancellationToken
    ): ColorPresentation[] => {
      return [ColorPresentation.create('red'), ColorPresentation.create('#ff0000')]
    },
    provideDocumentColors: (
      _document: TextDocument,
      _token: CancellationToken
    ): ProviderResult<ColorInformation[]> => {
      if (state == 'empty') return []
      if (state == 'error') return Promise.reject(new Error('no color'))
      return [{
        range: Range.create(0, 0, 0, 7),
        color: getColor(255, 255, 255)
      }]
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

  it('should get hex string', () => {
    let color = getColor(255, 255, 255)
    let hex = toHexString(color)
    expect(hex).toBe('ffffff')
  })

  it('should toggle enable state on configuration change', () => {
    helper.updateConfiguration('coc.preferences.colorSupport', false)
    expect(colors.enabled).toBe(false)
    helper.updateConfiguration('coc.preferences.colorSupport', true)
    expect(colors.enabled).toBe(true)
  })

  it('should clearHighlight on empty result', async () => {
    let doc = await helper.createDocument()
    await nvim.setLine('#ffffff')
    state = 'empty'
    await colors.highlightColors(doc, true)
    let res = colors.hasColor(doc.bufnr)
    expect(res).toBe(false)
    state = 'normal'
  })

  it('should not highlight on error result', async () => {
    let doc = await helper.createDocument()
    await nvim.setLine('#ffffff')
    state = 'error'
    await colors.highlightColors(doc, true)
    let res = colors.hasColor(doc.bufnr)
    expect(res).toBe(false)
    state = 'normal'
  })

  it('should clearHighlight on clearHighlight', async () => {
    let doc = await helper.createDocument()
    await nvim.setLine('#ffffff')
    await colors.highlightColors(doc)
    expect(colors.hasColor(doc.bufnr)).toBe(true)
    colors.clearHighlight(doc.bufnr)
    expect(colors.hasColor(doc.bufnr)).toBe(false)
  })

  it('should highlight colors', async () => {
    let doc = await helper.createDocument()
    await nvim.setLine('#ffffff')
    await colors.highlightColors(doc, true)
    let exists = await nvim.call('hlexists', 'BGffffff')
    expect(exists).toBe(1)
  })

  it('should pick presentations', async () => {
    let doc = await helper.createDocument()
    await nvim.setLine('#ffffff')
    await colors.highlightColors(doc, true)
    let p = colors.pickPresentation()
    await helper.wait(100)
    let m = await nvim.mode
    expect(m.blocking).toBe(true)
    await nvim.input('1<enter>')
    await p
    let line = await nvim.getLine()
    expect(line).toBe('red')
  })

  it('should pickColor', async () => {
    await helper.mockFunction('coc#util#pick_color', [0, 0, 0])
    let doc = await helper.createDocument()
    await nvim.setLine('#ffffff')
    await colors.highlightColors(doc)
    await colors.pickColor()
    let line = await nvim.getLine()
    expect(line).toBe('#000000')
  })
})

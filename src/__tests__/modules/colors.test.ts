import helper from '../helper'
import { Neovim } from '@chemzqm/neovim'
import { Color, Range, TextDocument, CancellationToken, ColorInformation, ColorPresentation } from 'vscode-languageserver-protocol'
import Colors from '../../colors'
import languages from '../../languages'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim

  languages.registerDocumentColorProvider([{ language: '*' }], {
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
    ): ColorInformation[] => {
      return [{
        range: Range.create(0, 0, 0, 7),
        color: getColor(255, 255, 255)
      }]
    }
  })
})

afterAll(async () => {
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
    let colors = new Colors(nvim)
    let hex = colors.toHexString(color)
    expect(hex).toBe('ffffff')
  })

  it('should toggle enable state on configuration change', () => {
    helper.updateDefaults('coc.preferences.colorSupport', false)
    let colors = new Colors(nvim)
    expect(colors.enabled).toBe(false)
    helper.updateDefaults('coc.preferences.colorSupport', true)
    expect(colors.enabled).toBe(true)
  })

  it('should highlight colors', async () => {
    let doc = await helper.createDocument('test')
    await nvim.setLine('#ffffff')
    let colors = new Colors(nvim)
    let colorSet = false
    helper.on('highlight_set', args => {
      let color = args[0][0]
      if (color.foreground == 0 && color.background == 16777215) {
        colorSet = true
      }
    })
    await colors.highlightColors(doc)
    let exists = await nvim.call('hlexists', 'BGffffff')
    expect(exists).toBe(1)
    expect(colorSet).toBe(true)
  })

  it('should pick presentations', async () => {
    let doc = await helper.createDocument('test')
    await nvim.setLine('#ffffff')
    let colors = new Colors(nvim)
    await colors.highlightColors(doc)
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
    let doc = await helper.createDocument('test')
    await nvim.setLine('#ffffff')
    let colors = new Colors(nvim)
    await colors.highlightColors(doc)
    await colors.pickColor()
    let line = await nvim.getLine()
    expect(line).toBe('#000000')
  })

  it('should dispose', async () => {
    await helper.createDocument('test')
    let colors = new Colors(nvim)
    let err = null
    try {
      colors.dispose()
    } catch (e) {
      err = e
    }
    expect(err).toBeNull()
  })
})

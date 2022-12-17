import { Neovim } from '@chemzqm/neovim'
import Highlighter from '../../model/highligher'
import helper from '../helper'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

describe('Highlighter', () => {

  let highligher: Highlighter
  beforeEach(() => {
    highligher = new Highlighter()
  })

  it('should add line', () => {
    highligher.addLine('foo', 'Comment')
    expect(highligher.getline(0)).toBe('foo')
    expect(highligher.getline(2)).toBe('')
    expect(highligher.highlights).toEqual([{ lnum: 0, colStart: 0, colEnd: 3, hlGroup: 'Comment' }])
    expect(highligher.content).toBe('foo')
  })

  it('should add lines', () => {
    highligher.addLines(['foo', 'bar'])
    expect(highligher.content).toBe('foo\nbar')
  })

  it('should parse ansi highlights', () => {
    const redOpen = '\x1B[31m'
    const redClose = '\x1B[39m'
    highligher.addLine(redOpen + 'foo' + redClose + 'bar' + redOpen + redClose)
    expect(highligher.content).toBe('foobar')
  })

  it('should add texts', () => {
    highligher.addTexts([{ text: 'foo' }, { text: 'bar', hlGroup: 'Comment' }])
    highligher.addText('')
    highligher.addText(undefined)
    expect(highligher.highlights).toEqual([{ lnum: 0, colStart: 3, colEnd: 6, hlGroup: 'Comment' }])
    expect(highligher.content).toBe('foobar')
  })

  it('should render to buffer', async () => {
    let buf = await nvim.createNewBuffer(true, true)
    highligher.addLine('foo', 'Comment')
    highligher.addLine('bar')
    nvim.pauseNotification()
    highligher.render(buf)
    await nvim.resumeNotification()
    let lines = await buf.lines
    expect(lines).toEqual(['foo', 'bar'])
  })
})

